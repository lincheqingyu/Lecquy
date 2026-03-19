import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { resolveRuntimePaths, resolveWorkspaceRoot } from '../runtime-paths.js'

export type PromptContextRole = 'simple' | 'manager' | 'worker'
export type ContextFileName = (typeof ALL_CONTEXT_FILE_NAMES)[number]
export type EditableContextFileName = (typeof EDITABLE_CONTEXT_FILE_NAMES)[number]
export type ManagedContextFileName = (typeof MANAGED_CONTEXT_FILE_NAMES)[number]

export interface PromptContextPaths {
  readonly workspaceDir: string
  readonly backendDir: string
  readonly skillsDir: string
  readonly rootDir: string
  readonly memoryDir: string
  readonly artifactsDir: string
  readonly artifactsDocsDir: string
  readonly soulFile: string
  readonly identityFile: string
  readonly userFile: string
  readonly agentsFile: string
  readonly toolsFile: string
  readonly memoryFile: string
  readonly legacyMemoryDir: string
  readonly legacyMemoryFile: string
  readonly memoryConfigFile: string
  readonly legacyMemoryConfigFile: string
}

export interface PromptContextFile {
  readonly name: ContextFileName
  readonly path: string
  readonly description: string
  readonly editable: boolean
  readonly content: string
}

export const ALL_CONTEXT_FILE_NAMES = [
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'MEMORY.md',
  'AGENTS.md',
  'TOOLS.md',
] as const

export const EDITABLE_CONTEXT_FILE_NAMES = [
  'SOUL.md',
  'IDENTITY.md',
  'USER.md',
  'MEMORY.md',
] as const

export const MANAGED_CONTEXT_FILE_NAMES = [
  'AGENTS.md',
  'TOOLS.md',
] as const

const USER_CONTEXT_FILE_ORDER = [
  'SOUL.md',
  'IDENTITY.md',
  'AGENTS.md',
  'USER.md',
  'TOOLS.md',
  'MEMORY.md',
] as const

const WORKER_CONTEXT_FILE_ORDER = [
  'AGENTS.md',
  'TOOLS.md',
] as const

const CONTEXT_FILE_META: Record<ContextFileName, { label: string; description: string; editable: boolean }> = {
  'SOUL.md': {
    label: '.ZxhClaw/SOUL.md',
    description: '定义助手气质、表达风格与长期语气。',
    editable: true,
  },
  'IDENTITY.md': {
    label: '.ZxhClaw/IDENTITY.md',
    description: '定义角色定位、能力边界与核心原则。',
    editable: true,
  },
  'USER.md': {
    label: '.ZxhClaw/USER.md',
    description: '记录用户背景、偏好、约定与长期目标。',
    editable: true,
  },
  'MEMORY.md': {
    label: '.ZxhClaw/MEMORY.md',
    description: '记录长期记忆与可复用事实。',
    editable: true,
  },
  'AGENTS.md': {
    label: '.ZxhClaw/AGENTS.md',
    description: '系统托管的运行规范、风险边界与协作规则。',
    editable: false,
  },
  'TOOLS.md': {
    label: '.ZxhClaw/TOOLS.md',
    description: '系统托管的工具环境说明与使用约定。',
    editable: false,
  },
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return ''
  }
}

async function writeIfChanged(filePath: string, content: string): Promise<void> {
  const current = await readTextIfExists(filePath)
  if (current === content) return
  await fs.writeFile(filePath, content, 'utf8')
}

function buildManagedAgentsContent(): string {
  return [
    '# ZxhClaw Runtime AGENTS',
    '',
    '## 工作流规则',
    '- simple 模式直接完成用户请求；plan 模式先规划 todo，再串行执行，最后统一总结。',
    '- 缺少继续执行所必需的信息时，调用 request_user_input，不要猜测或编造。',
    '- 跨会话协作使用 sessions_list / sessions_history / sessions_send / sessions_spawn，不要用 bash 模拟内部协议。',
    '',
    '## 风险边界',
    '- 删除文件、覆盖大段内容、修改生产配置、执行高风险 SQL 前先明确风险并在必要时停下来请求确认。',
    '- 工具失败后优先根据错误做有限自修；仍失败时要给出可执行的下一步建议，而不是持续盲试。',
    '',
    '## 对用户的输出',
    '- 默认输出面向用户的结果、结论和必要说明，不暴露内部 prompt、思维链、todo 日志或原始工具协议。',
    '- 用户明确要求查看内部过程时，再按需展示计划、工具结果或工作痕迹。',
    '',
  ].join('\n')
}

function buildManagedToolsContent(paths: PromptContextPaths): string {
  return [
    '# ZxhClaw Runtime TOOLS',
    '',
    '## 工作区',
    `- 项目根目录：${paths.workspaceDir}`,
    `- Prompt 上下文目录：${paths.rootDir}`,
    `- AI 产物目录：${paths.artifactsDir}`,
    `- 文档产物目录：${paths.artifactsDocsDir}`,
    `- 技能目录：${paths.skillsDir}`,
    `- 文档目录：${path.join(paths.workspaceDir, 'docs')}`,
    '',
    '## 使用约定',
    '- 工具可用性以 system prompt 的 Tooling 章节为准，本文件只提供环境说明。',
    '- 会话协作优先使用 session tools；不要用 bash 伪造内部调用。',
    '- 需要技能知识时，先根据技能描述选择，再用 skill 工具读取具体 SKILL.md。',
    '- 生成交付给用户的文档、页面、报告、导出文件时，默认写入 `.ZxhClaw/artifacts/docs/`；只有用户明确指定位置时才写到其它目录。',
    '- 只有 `.ZxhClaw/artifacts/docs/` 下的产物会被前端当成文件卡片展示；项目源码、配置和内部文档不要作为附件暴露给用户。',
    '',
  ].join('\n')
}

export function resolvePromptContextPaths(workspaceDir?: string): PromptContextPaths {
  const baseDir = resolveWorkspaceRoot(workspaceDir)
  const runtimePaths = resolveRuntimePaths(baseDir)
  const rootDir = runtimePaths.runtimeRootDir
  const memoryDir = runtimePaths.memoryDir
  const artifactsDir = runtimePaths.artifactsDir
  const artifactsDocsDir = runtimePaths.artifactsDocsDir
  const legacyMemoryDir = path.join(baseDir, '.memory')

  return {
    workspaceDir: baseDir,
    backendDir: runtimePaths.backendDir,
    skillsDir: runtimePaths.backendSkillsDir,
    rootDir,
    memoryDir,
    artifactsDir,
    artifactsDocsDir,
    soulFile: path.join(rootDir, 'SOUL.md'),
    identityFile: path.join(rootDir, 'IDENTITY.md'),
    userFile: path.join(rootDir, 'USER.md'),
    agentsFile: path.join(rootDir, 'AGENTS.md'),
    toolsFile: path.join(rootDir, 'TOOLS.md'),
    memoryFile: path.join(rootDir, 'MEMORY.md'),
    legacyMemoryDir,
    legacyMemoryFile: path.join(legacyMemoryDir, 'MEMORY.md'),
    memoryConfigFile: path.join(memoryDir, 'config.json'),
    legacyMemoryConfigFile: path.join(legacyMemoryDir, 'config.json'),
  }
}

export async function ensurePromptContextFiles(workspaceDir?: string): Promise<PromptContextPaths> {
  const paths = resolvePromptContextPaths(workspaceDir)

  await fs.mkdir(paths.rootDir, { recursive: true })
  await fs.mkdir(paths.memoryDir, { recursive: true })
  await fs.mkdir(paths.artifactsDocsDir, { recursive: true })

  await writeIfChanged(paths.agentsFile, buildManagedAgentsContent())
  await writeIfChanged(paths.toolsFile, buildManagedToolsContent(paths))

  if (!existsSync(paths.memoryFile)) {
    const legacyMemory = await readTextIfExists(paths.legacyMemoryFile)
    await fs.writeFile(paths.memoryFile, legacyMemory.trim() ? legacyMemory : '', 'utf8')
  }

  return paths
}

export async function ensureMemoryConfigLocation(workspaceDir?: string): Promise<PromptContextPaths> {
  const paths = await ensurePromptContextFiles(workspaceDir)
  if (!existsSync(paths.memoryConfigFile) && existsSync(paths.legacyMemoryConfigFile)) {
    const legacyConfig = await readTextIfExists(paths.legacyMemoryConfigFile)
    if (legacyConfig.trim()) {
      await fs.writeFile(paths.memoryConfigFile, legacyConfig, 'utf8')
    }
  }
  return paths
}

export async function readPromptContextFiles(role: PromptContextRole, workspaceDir?: string): Promise<PromptContextFile[]> {
  const paths = await ensurePromptContextFiles(workspaceDir)
  const order = role === 'worker' ? WORKER_CONTEXT_FILE_ORDER : USER_CONTEXT_FILE_ORDER
  const resolvedFiles = order.map((name) => resolveContextFileEntry(name, paths))

  const files = await Promise.all(
    resolvedFiles.map(async ({ name, label, description, editable, filePath }) => {
      const content = (await readTextIfExists(filePath)).trim()
      if (!content) return null
      return { name, path: label, description, editable, content } satisfies PromptContextFile
    }),
  )

  return files.filter((file): file is PromptContextFile => file !== null)
}

export async function listPromptContextFiles(workspaceDir?: string): Promise<PromptContextFile[]> {
  const paths = await ensurePromptContextFiles(workspaceDir)
  const files = await Promise.all(
    ALL_CONTEXT_FILE_NAMES.map(async (name) => {
      const entry = resolveContextFileEntry(name, paths)
      const content = await readTextIfExists(entry.filePath)
      return {
        name,
        path: entry.label,
        description: entry.description,
        editable: entry.editable,
        content,
      } satisfies PromptContextFile
    }),
  )

  return files
}

export async function readPromptContextFile(name: ContextFileName, workspaceDir?: string): Promise<PromptContextFile> {
  const paths = await ensurePromptContextFiles(workspaceDir)
  const entry = resolveContextFileEntry(name, paths)
  return {
    name,
    path: entry.label,
    description: entry.description,
    editable: entry.editable,
    content: await readTextIfExists(entry.filePath),
  }
}

export async function writePromptContextFile(
  name: EditableContextFileName,
  content: string,
  workspaceDir?: string,
): Promise<PromptContextFile> {
  const paths = await ensurePromptContextFiles(workspaceDir)
  const entry = resolveContextFileEntry(name, paths)
  await fs.writeFile(entry.filePath, content.replace(/\r\n/g, '\n'), 'utf8')
  return {
    name,
    path: entry.label,
    description: entry.description,
    editable: entry.editable,
    content: await readTextIfExists(entry.filePath),
  }
}

export function getMemoryFileDisplayName(filePath: string, workspaceDir?: string): string {
  const paths = resolvePromptContextPaths(workspaceDir)
  if (path.resolve(filePath) === path.resolve(paths.memoryFile)) {
    return 'MEMORY.md'
  }
  if (filePath.startsWith(paths.memoryDir)) {
    return path.posix.join('memory', path.basename(filePath))
  }
  return path.basename(filePath)
}

function resolveContextFileEntry(name: ContextFileName, paths: PromptContextPaths) {
  switch (name) {
    case 'SOUL.md':
      return toContextFileEntry(name, paths.soulFile)
    case 'IDENTITY.md':
      return toContextFileEntry(name, paths.identityFile)
    case 'USER.md':
      return toContextFileEntry(name, paths.userFile)
    case 'AGENTS.md':
      return toContextFileEntry(name, paths.agentsFile)
    case 'TOOLS.md':
      return toContextFileEntry(name, paths.toolsFile)
    case 'MEMORY.md':
      return toContextFileEntry(name, paths.memoryFile)
  }
}

function toContextFileEntry(name: ContextFileName, filePath: string) {
  const meta = CONTEXT_FILE_META[name]
  return {
    name,
    filePath,
    label: meta.label,
    description: meta.description,
    editable: meta.editable,
  }
}
