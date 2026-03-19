import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_WORKSPACE_DIR = path.resolve(MODULE_DIR, '../../../')

export const GENERATED_ARTIFACT_DOCS_DIR = '.ZxhClaw/artifacts/docs'
export const DEFAULT_SESSION_STORE_DIR = '.ZxhClaw/sessions/v3'

export interface RuntimePaths {
  readonly workspaceDir: string
  readonly backendDir: string
  readonly backendSkillsDir: string
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

export function resolveWorkspaceRoot(workspaceDir?: string): string {
  return path.resolve(workspaceDir ?? DEFAULT_WORKSPACE_DIR)
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
