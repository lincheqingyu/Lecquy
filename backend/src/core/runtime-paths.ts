import fs from 'node:fs'
import path from 'node:path'
import { isSea } from 'node:sea'

export const GENERATED_ARTIFACT_DOCS_DIR = '.ZxhClaw/artifacts/docs'
export const DEFAULT_SESSION_STORE_DIR = '.ZxhClaw/sessions/v3'

export interface RuntimePaths {
  readonly workspaceDir: string
  readonly backendDir: string
  readonly backendSkillsDir: string
  readonly runtimeSkillsDir: string
  readonly runtimeRootDir: string
  readonly memoryDir: string
  readonly memoryFile: string
  readonly memoryConfigFile: string
  readonly artifactsDir: string
  readonly artifactsDocsDir: string
  readonly artifactsLegacyDocsDir: string
  readonly systemPromptDir: string
  readonly sessionStoreDir: string
  readonly sessionStoreIndexFile: string
  readonly sessionStoreSessionsDir: string
  readonly legacyRootSessionStoreDir: string
  readonly legacyRootSessionStoreIndexFile: string
  readonly legacyRootSessionStoreSessionsDir: string
  readonly legacyBackendSessionStoreDir: string
  readonly legacyBackendSessionStoreIndexFile: string
  readonly legacyBackendSessionStoreSessionsDir: string
  readonly legacyBackendSessionStoreV2Dir: string
  readonly legacyBackendMemoryDir: string
  readonly legacyBackendMemoryFile: string
  readonly legacyBackendDocsDir: string
  readonly legacyBackendRuntimeRootDir: string
}

function looksLikeWorkspaceRoot(candidateDir: string): boolean {
  return (
    fs.existsSync(path.join(candidateDir, 'backend')) ||
    fs.existsSync(path.join(candidateDir, 'frontend')) ||
    fs.existsSync(path.join(candidateDir, 'pnpm-workspace.yaml')) ||
    fs.existsSync(path.join(candidateDir, '.ZxhClaw')) ||
    fs.existsSync(path.join(candidateDir, '.env'))
  )
}

function detectWorkspaceRootFromBackendDir(backendDir: string): string | null {
  if (path.basename(backendDir) !== 'backend') {
    return null
  }

  const parentDir = path.dirname(backendDir)
  const looksLikeParentWorkspace = (
    fs.existsSync(path.join(parentDir, 'frontend')) ||
    fs.existsSync(path.join(parentDir, 'pnpm-workspace.yaml')) ||
    fs.existsSync(path.join(parentDir, '.env')) ||
    fs.existsSync(path.join(parentDir, '.env.example')) ||
    fs.existsSync(path.join(parentDir, '.ZxhClaw'))
  )

  return looksLikeParentWorkspace ? parentDir : null
}

function detectWorkspaceRootFromCwd(): string {
  const cwd = path.resolve(process.cwd())
  const backendParentRoot = detectWorkspaceRootFromBackendDir(cwd)
  if (backendParentRoot) {
    return backendParentRoot
  }

  if (looksLikeWorkspaceRoot(cwd)) {
    return cwd
  }

  return cwd
}

export function resolveWorkspaceRoot(workspaceDir?: string): string {
  if (workspaceDir) {
    return path.resolve(workspaceDir)
  }

  const envWorkspaceRoot = process.env.WEBCLAW_WORKSPACE_ROOT?.trim()
  if (envWorkspaceRoot) {
    return path.resolve(envWorkspaceRoot)
  }

  if (isSea()) {
    return path.dirname(process.execPath)
  }

  return detectWorkspaceRootFromCwd()
}

export function normalizeWorkspaceRelativePath(filePath: string): string {
  return filePath.trim().replace(/\\/g, '/').replace(/^\.\//, '')
}

export function isWithinRoot(rootDir: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(rootDir), path.resolve(candidatePath))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

export function resolvePathWithinRoot(rootDir: string, targetPath: string): string {
  const resolved = path.resolve(rootDir, targetPath)
  if (!isWithinRoot(rootDir, resolved)) {
    throw new Error(`路径逃逸工作空间: ${targetPath}`)
  }
  return resolved
}

export function resolveRuntimePaths(workspaceDir?: string, sessionStoreDir = DEFAULT_SESSION_STORE_DIR): RuntimePaths {
  const workspaceDirAbs = resolveWorkspaceRoot(workspaceDir)
  const backendDir = path.join(workspaceDirAbs, 'backend')
  const runtimeRootDir = path.join(workspaceDirAbs, '.ZxhClaw')
  const memoryDir = path.join(runtimeRootDir, 'memory')
  const artifactsDir = path.join(runtimeRootDir, 'artifacts')
  const artifactsDocsDir = path.join(artifactsDir, 'docs')
  const sessionStoreRoot = resolvePathWithinRoot(workspaceDirAbs, sessionStoreDir)

  return {
    workspaceDir: workspaceDirAbs,
    backendDir,
    backendSkillsDir: path.join(backendDir, 'skills'),
    runtimeSkillsDir: path.join(runtimeRootDir, 'skills'),
    runtimeRootDir,
    memoryDir,
    memoryFile: path.join(runtimeRootDir, 'MEMORY.md'),
    memoryConfigFile: path.join(memoryDir, 'config.json'),
    artifactsDir,
    artifactsDocsDir,
    artifactsLegacyDocsDir: path.join(artifactsDocsDir, 'legacy'),
    systemPromptDir: path.join(runtimeRootDir, 'system-prompt'),
    sessionStoreDir: sessionStoreRoot,
    sessionStoreIndexFile: path.join(sessionStoreRoot, 'sessions.json'),
    sessionStoreSessionsDir: path.join(sessionStoreRoot, 'sessions'),
    legacyRootSessionStoreDir: path.join(workspaceDirAbs, '.sessions-v3'),
    legacyRootSessionStoreIndexFile: path.join(workspaceDirAbs, '.sessions-v3', 'sessions.json'),
    legacyRootSessionStoreSessionsDir: path.join(workspaceDirAbs, '.sessions-v3', 'sessions'),
    legacyBackendSessionStoreDir: path.join(backendDir, '.sessions-v3'),
    legacyBackendSessionStoreIndexFile: path.join(backendDir, '.sessions-v3', 'sessions.json'),
    legacyBackendSessionStoreSessionsDir: path.join(backendDir, '.sessions-v3', 'sessions'),
    legacyBackendSessionStoreV2Dir: path.join(backendDir, '.sessions-v2'),
    legacyBackendMemoryDir: path.join(backendDir, '.memory'),
    legacyBackendMemoryFile: path.join(backendDir, '.memory', 'MEMORY.md'),
    legacyBackendDocsDir: path.join(backendDir, 'docs'),
    legacyBackendRuntimeRootDir: path.join(backendDir, '.ZxhClaw'),
  }
}
