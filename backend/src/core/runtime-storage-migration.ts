import { existsSync, statSync } from 'node:fs'
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import type { GeneratedFileArtifact } from '@webclaw/shared'
import { logger } from '../utils/logger.js'
import {
  GENERATED_ARTIFACT_DOCS_DIR,
  type RuntimePaths,
  normalizeWorkspaceRelativePath,
  resolvePathWithinRoot,
  resolveRuntimePaths,
} from './runtime-paths.js'

interface SessionIndexShape {
  entries: Record<string, unknown>
}

function inferMimeType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
    case '.htm':
      return 'text/html'
    case '.md':
    case '.markdown':
      return 'text/markdown'
    case '.json':
      return 'application/json'
    case '.csv':
      return 'text/csv'
    case '.xml':
      return 'application/xml'
    case '.css':
      return 'text/css'
    case '.js':
      return 'text/javascript'
    case '.py':
      return 'text/x-python'
    case '.ts':
      return 'text/typescript'
    default:
      return 'text/plain'
  }
}

function createLegacyArtifactId(filePath: string, timestamp: number): string {
  let hash = 0
  const seed = `${filePath}:${timestamp}`
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(index)
    hash |= 0
  }
  return `artifact_legacy_${timestamp}_${Math.abs(hash).toString(16)}`
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath)
    return true
  } catch {
    return false
  }
}

async function readJsonOrFallback<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, 'utf8')
    const trimmed = raw.trim()
    if (!trimmed) return fallback
    return JSON.parse(trimmed) as T
  } catch {
    return fallback
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}_${Math.random().toString(16).slice(2, 8)}.tmp`
  await writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8')
  try {
    await rename(tmpPath, filePath)
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined)
    throw error
  }
}

async function ensureCanonicalRuntimeDirs(paths: RuntimePaths): Promise<void> {
  await mkdir(paths.runtimeRootDir, { recursive: true })
  await mkdir(paths.memoryDir, { recursive: true })
  await mkdir(paths.artifactsDocsDir, { recursive: true })
  await mkdir(paths.artifactsLegacyDocsDir, { recursive: true })
  await mkdir(paths.sessionStoreSessionsDir, { recursive: true })
}

async function listFilesRecursive(rootDir: string): Promise<string[]> {
  if (!existsSync(rootDir)) return []
  const entries = await readdir(rootDir, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const fullPath = path.join(rootDir, entry.name)
    if (entry.isDirectory()) {
      return await listFilesRecursive(fullPath)
    }
    if (entry.isFile()) {
      return [fullPath]
    }
    return []
  }))
  return files.flat()
}

async function mergeSessionIndexFile(sourceIndexFile: string, targetEntries: Record<string, unknown>): Promise<boolean> {
  const sourceIndex = await readJsonOrFallback<SessionIndexShape>(sourceIndexFile, { entries: {} })
  let changed = false

  for (const [key, entry] of Object.entries(sourceIndex.entries ?? {})) {
    if (key in targetEntries) {
      logger.info('迁移会话索引时跳过重复 session key', { sessionKey: key, sourceIndexFile })
      continue
    }
    targetEntries[key] = entry
    changed = true
  }

  return changed
}

async function mergeSessionStoreDirectory(
  sourceStoreDir: string,
  targetEntries: Record<string, unknown>,
  targetSessionsDir: string,
): Promise<boolean> {
  if (!existsSync(sourceStoreDir)) return false

  let changed = false
  const sourceIndexFile = path.join(sourceStoreDir, 'sessions.json')
  if (await pathExists(sourceIndexFile)) {
    changed = await mergeSessionIndexFile(sourceIndexFile, targetEntries) || changed
  }

  const sourceSessionsDir = path.join(sourceStoreDir, 'sessions')
  if (await pathExists(sourceSessionsDir)) {
    const sessionFiles = await readdir(sourceSessionsDir, { withFileTypes: true })
    for (const entry of sessionFiles) {
      if (!entry.isFile()) continue
      const sourceFile = path.join(sourceSessionsDir, entry.name)
      const targetFile = path.join(targetSessionsDir, entry.name)
      if (await pathExists(targetFile)) {
        logger.info('迁移 session jsonl 时跳过已存在文件', { sourceFile, targetFile })
        continue
      }
      await mkdir(path.dirname(targetFile), { recursive: true })
      await copyFile(sourceFile, targetFile)
      changed = true
    }
  }

  return changed
}

function normalizeArtifactFilePath(
  filePath: string,
  legacyDocsMap: ReadonlyMap<string, string>,
): string {
  const normalized = normalizeWorkspaceRelativePath(filePath)
  const mapped = legacyDocsMap.get(normalized)
  if (mapped) return mapped

  if (normalized === GENERATED_ARTIFACT_DOCS_DIR || normalized.startsWith(`${GENERATED_ARTIFACT_DOCS_DIR}/`)) {
    return normalized
  }

  if (normalized.startsWith('docs/') || normalized.startsWith('backend/docs/')) {
    return path.posix.join(GENERATED_ARTIFACT_DOCS_DIR, 'legacy', path.posix.basename(normalized))
  }

  return normalized
}

function normalizeGeneratedArtifactCandidate(
  candidate: unknown,
  fallbackTimestamp: number,
  legacyDocsMap: ReadonlyMap<string, string>,
  paths: RuntimePaths,
): GeneratedFileArtifact | null {
  if (!candidate || typeof candidate !== 'object') return null

  const filePath = 'filePath' in candidate ? (candidate as { filePath?: unknown }).filePath : undefined
  if (typeof filePath !== 'string' || !filePath.trim()) return null

  const normalizedFilePath = normalizeArtifactFilePath(filePath, legacyDocsMap)
  const attachment = 'attachment' in candidate && candidate.attachment && typeof candidate.attachment === 'object'
    ? candidate.attachment as Record<string, unknown>
    : undefined

  const fullPath = (() => {
    try {
      return resolvePathWithinRoot(paths.workspaceDir, normalizedFilePath)
    } catch {
      return null
    }
  })()
  const stats = fullPath && existsSync(fullPath)
    ? (() => {
        try {
          return statSync(fullPath)
        } catch {
          return null
        }
      })()
    : null

  const createdAt = typeof (candidate as { createdAt?: unknown }).createdAt === 'number'
    ? (candidate as { createdAt: number }).createdAt
    : fallbackTimestamp
  const updatedAt = typeof (candidate as { updatedAt?: unknown }).updatedAt === 'number'
    ? (candidate as { updatedAt: number }).updatedAt
    : stats?.mtimeMs ?? createdAt
  const sizeFromAttachment = typeof attachment?.size === 'number'
    ? attachment.size
    : typeof attachment?.text === 'string'
      ? Buffer.byteLength(attachment.text, 'utf8')
      : 0
  const size = stats?.size
    ?? (typeof (candidate as { size?: unknown }).size === 'number' ? (candidate as { size: number }).size : sizeFromAttachment)
  const name = typeof (candidate as { name?: unknown }).name === 'string'
    ? (candidate as { name: string }).name
    : typeof attachment?.name === 'string'
      ? attachment.name
      : path.basename(normalizedFilePath)
  const mimeType = typeof (candidate as { mimeType?: unknown }).mimeType === 'string'
    ? (candidate as { mimeType: string }).mimeType
    : typeof attachment?.mimeType === 'string'
      ? attachment.mimeType
      : inferMimeType(normalizedFilePath)
  const artifactId = typeof (candidate as { artifactId?: unknown }).artifactId === 'string'
    ? (candidate as { artifactId: string }).artifactId
    : createLegacyArtifactId(normalizedFilePath, createdAt)

  return {
    artifactId,
    filePath: normalizedFilePath,
    name,
    mimeType,
    size,
    createdAt,
    updatedAt,
  }
}

function normalizeSessionEntryLine(
  line: string,
  legacyDocsMap: ReadonlyMap<string, string>,
  paths: RuntimePaths,
): { readonly changed: boolean; readonly line: string } {
  const trimmed = line.trim()
  if (!trimmed) return { changed: false, line }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return { changed: false, line }
  }

  let changed = false
  let nextEntry = parsed

  if (parsed.type === 'session' && parsed.cwd !== paths.workspaceDir) {
    nextEntry = {
      ...nextEntry,
      cwd: paths.workspaceDir,
    }
    changed = true
  }

  if (
    parsed.type === 'custom'
    && parsed.customType === 'generated_files'
    && parsed.data
    && typeof parsed.data === 'object'
  ) {
    const data = parsed.data as Record<string, unknown>
    const fallbackTimestamp = typeof parsed.timestamp === 'string'
      ? (Date.parse(parsed.timestamp) || Date.now())
      : Date.now()
    const currentArtifacts = Array.isArray(data.generatedArtifacts)
      ? data.generatedArtifacts
        .map((candidate) => normalizeGeneratedArtifactCandidate(candidate, fallbackTimestamp, legacyDocsMap, paths))
        .filter((candidate): candidate is GeneratedFileArtifact => candidate !== null)
      : []
    const legacyArtifacts = Array.isArray(data.generatedFiles)
      ? data.generatedFiles
        .map((candidate) => normalizeGeneratedArtifactCandidate(candidate, fallbackTimestamp, legacyDocsMap, paths))
        .filter((candidate): candidate is GeneratedFileArtifact => candidate !== null)
      : []

    const mergedArtifacts = new Map<string, GeneratedFileArtifact>()
    for (const artifact of [...currentArtifacts, ...legacyArtifacts]) {
      mergedArtifacts.set(artifact.filePath, artifact)
    }

    const nextArtifacts = Array.from(mergedArtifacts.values())
    const currentArtifactsJson = JSON.stringify(data.generatedArtifacts ?? [])
    const nextArtifactsJson = JSON.stringify(nextArtifacts)

    if (nextArtifacts.length > 0 && currentArtifactsJson !== nextArtifactsJson) {
      nextEntry = {
        ...nextEntry,
        data: {
          ...data,
          generatedArtifacts: nextArtifacts,
        },
      }
      changed = true
    }
  }

  return {
    changed,
    line: changed ? JSON.stringify(nextEntry) : line,
  }
}

async function normalizeSessionStoreFiles(
  paths: RuntimePaths,
  legacyDocsMap: ReadonlyMap<string, string>,
): Promise<void> {
  if (!existsSync(paths.sessionStoreSessionsDir)) return
  const entries = await readdir(paths.sessionStoreSessionsDir, { withFileTypes: true })

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue
    const filePath = path.join(paths.sessionStoreSessionsDir, entry.name)
    const raw = await readFile(filePath, 'utf8')
    const hasTrailingNewline = raw.endsWith('\n')
    const lines = raw.split('\n')
    let changed = false
    const nextLines = lines.map((line) => {
      const normalized = normalizeSessionEntryLine(line, legacyDocsMap, paths)
      changed = changed || normalized.changed
      return normalized.line
    })
    if (!changed) continue
    const nextContent = nextLines.join('\n')
    await writeFile(filePath, hasTrailingNewline && !nextContent.endsWith('\n') ? `${nextContent}\n` : nextContent, 'utf8')
  }
}

async function chooseLegacyArtifactTarget(sourceFile: string, paths: RuntimePaths): Promise<string> {
  const sourceBase = path.basename(sourceFile)
  const parsed = path.parse(sourceBase)
  let attempt = path.join(paths.artifactsLegacyDocsDir, sourceBase)
  let counter = 0
  while (await pathExists(attempt)) {
    counter += 1
    const suffix = `${Date.now()}-${counter}`
    attempt = path.join(paths.artifactsLegacyDocsDir, `${parsed.name}-${suffix}${parsed.ext}`)
  }
  return attempt
}

async function migrateLegacyDocs(paths: RuntimePaths): Promise<Map<string, string>> {
  const docsPathMap = new Map<string, string>()
  if (!existsSync(paths.legacyBackendDocsDir)) return docsPathMap

  const files = await listFilesRecursive(paths.legacyBackendDocsDir)
  for (const sourceFile of files) {
    const targetFile = await chooseLegacyArtifactTarget(sourceFile, paths)
    await mkdir(path.dirname(targetFile), { recursive: true })
    await copyFile(sourceFile, targetFile)

    const relativeSourceFromWorkspace = normalizeWorkspaceRelativePath(path.relative(paths.workspaceDir, sourceFile))
    const relativeTargetFromWorkspace = normalizeWorkspaceRelativePath(path.relative(paths.workspaceDir, targetFile))
    docsPathMap.set(relativeSourceFromWorkspace, relativeTargetFromWorkspace)
    if (relativeSourceFromWorkspace.startsWith('backend/')) {
      docsPathMap.set(relativeSourceFromWorkspace.slice('backend/'.length), relativeTargetFromWorkspace)
    }
  }

  await rm(paths.legacyBackendDocsDir, { recursive: true, force: true })
  logger.info('已迁移 backend/docs 到 .ZxhClaw/artifacts/docs/legacy', { fileCount: files.length })
  return docsPathMap
}

async function mergeDirectoryContents(sourceDir: string, targetDir: string): Promise<number> {
  if (!existsSync(sourceDir)) return 0
  const entries = await readdir(sourceDir, { withFileTypes: true })
  let copiedCount = 0

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name)
    const targetPath = path.join(targetDir, entry.name)

    if (entry.isDirectory()) {
      await mkdir(targetPath, { recursive: true })
      copiedCount += await mergeDirectoryContents(sourcePath, targetPath)
      continue
    }

    if (!entry.isFile()) continue
    if (await pathExists(targetPath)) continue
    await mkdir(path.dirname(targetPath), { recursive: true })
    await copyFile(sourcePath, targetPath)
    copiedCount += 1
  }

  return copiedCount
}

async function migrateLegacyRuntimeRoot(paths: RuntimePaths): Promise<void> {
  if (!existsSync(paths.legacyBackendRuntimeRootDir)) return
  const copiedCount = await mergeDirectoryContents(paths.legacyBackendRuntimeRootDir, paths.runtimeRootDir)
  await rm(paths.legacyBackendRuntimeRootDir, { recursive: true, force: true })
  logger.info('已迁移 backend/.ZxhClaw 到根 .ZxhClaw', { copiedCount })
}

async function migrateLegacyMemory(paths: RuntimePaths): Promise<void> {
  if (!existsSync(paths.legacyBackendMemoryFile)) return
  const currentMemory = await readFile(paths.memoryFile, 'utf8').catch(() => '')
  if (currentMemory.trim()) {
    await rm(paths.legacyBackendMemoryDir, { recursive: true, force: true })
    logger.info('检测到根 .ZxhClaw/MEMORY.md 已存在，跳过 backend/.memory/MEMORY.md 导入')
    return
  }

  const legacyMemory = await readFile(paths.legacyBackendMemoryFile, 'utf8').catch(() => '')
  if (legacyMemory.trim()) {
    await mkdir(path.dirname(paths.memoryFile), { recursive: true })
    await writeFile(paths.memoryFile, legacyMemory, 'utf8')
  }

  await rm(paths.legacyBackendMemoryDir, { recursive: true, force: true })
  logger.info('已迁移 backend/.memory/MEMORY.md 到根 .ZxhClaw/MEMORY.md')
}

async function discardLegacySessionStoreV2(paths: RuntimePaths): Promise<void> {
  if (!existsSync(paths.legacyBackendSessionStoreV2Dir)) return
  await rm(paths.legacyBackendSessionStoreV2Dir, { recursive: true, force: true })
  logger.info('已丢弃废弃的 backend/.sessions-v2 目录')
}

async function migrateLegacySessionStores(paths: RuntimePaths): Promise<void> {
  const targetIndex = await readJsonOrFallback<SessionIndexShape>(paths.sessionStoreIndexFile, { entries: {} })
  const targetEntries = { ...(targetIndex.entries ?? {}) }

  const changedFromRoot = await mergeSessionStoreDirectory(
    paths.legacyRootSessionStoreDir,
    targetEntries,
    paths.sessionStoreSessionsDir,
  )
  const changedFromBackend = await mergeSessionStoreDirectory(
    paths.legacyBackendSessionStoreDir,
    targetEntries,
    paths.sessionStoreSessionsDir,
  )

  if (changedFromRoot || changedFromBackend || !(await pathExists(paths.sessionStoreIndexFile))) {
    await writeJsonAtomic(paths.sessionStoreIndexFile, { entries: targetEntries } satisfies SessionIndexShape)
  }

  if (existsSync(paths.legacyRootSessionStoreDir)) {
    await rm(paths.legacyRootSessionStoreDir, { recursive: true, force: true })
  }
  if (existsSync(paths.legacyBackendSessionStoreDir)) {
    await rm(paths.legacyBackendSessionStoreDir, { recursive: true, force: true })
  }
}

export async function migrateLegacyRuntimeStorage(workspaceDir?: string, sessionStoreDir?: string): Promise<RuntimePaths> {
  const paths = resolveRuntimePaths(workspaceDir, sessionStoreDir)
  await ensureCanonicalRuntimeDirs(paths)
  await migrateLegacySessionStores(paths)
  await migrateLegacyMemory(paths)
  const legacyDocsMap = await migrateLegacyDocs(paths)
  await migrateLegacyRuntimeRoot(paths)
  await discardLegacySessionStoreV2(paths)
  await normalizeSessionStoreFiles(paths, legacyDocsMap)
  return paths
}
