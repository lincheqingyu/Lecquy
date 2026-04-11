import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { buildCapabilityBlock } from './capability-block.js'
import {
  type AgentRole,
  type CapabilityBlock,
  LAYER_TAGS,
  type LayerSlice,
  PromptLayer,
  STARTUP_BUDGETS,
  type UserMdSlices,
} from './prompt-layer-types.js'
import { estimateTokens } from './prompt-serializer.js'
import { parseUserMd } from './user-md-parser.js'
import { resolveRuntimePaths, resolveWorkspaceRoot } from '../runtime-paths.js'

export type PromptContextRole = 'simple' | 'manager' | 'worker'
export type ContextFileName = (typeof ALL_CONTEXT_FILE_NAMES)[number]
export type EditableContextFileName = (typeof EDITABLE_CONTEXT_FILE_NAMES)[number]
export type ManagedContextFileName = (typeof MANAGED_CONTEXT_FILE_NAMES)[number]

export interface PromptContextPaths {
  readonly workspaceDir: string
  readonly backendDir: string
  readonly skillsDir: string
  readonly bundledSkillsDirLabel: string
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
  readonly memorySummaryFile: string
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
    label: '.lecquy/SOUL.md',
    description: '定义助手气质、表达风格与长期语气。',
    editable: true,
  },
  'IDENTITY.md': {
    label: '.lecquy/IDENTITY.md',
    description: '定义角色定位、能力边界与核心原则。',
    editable: true,
  },
  'USER.md': {
    label: '.lecquy/USER.md',
    description: '记录用户背景、偏好、约定与长期目标。',
    editable: true,
  },
  'MEMORY.md': {
    label: '.lecquy/MEMORY.md',
    description: '记录长期记忆与可复用事实。',
    editable: true,
  },
  'AGENTS.md': {
    label: '.lecquy/AGENTS.md',
    description: '系统托管的运行规范、风险边界与协作规则。',
    editable: false,
  },
  'TOOLS.md': {
    label: '.lecquy/TOOLS.md',
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

function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex')
}

function createLayerSlice(
  layer: PromptLayer,
  content: string,
  attributes?: Record<string, string>,
): LayerSlice {
  return {
    layer,
    tag: LAYER_TAGS[layer],
    content,
    contentHash: hashContent(content),
    tokenEstimate: estimateTokens(content),
    attributes,
  }
}

function truncateToTokenBudget(content: string, tokenBudget: number): string {
  const normalized = content.trim()
  if (!normalized || estimateTokens(normalized) <= tokenBudget) {
    return normalized
  }

  const maxChars = Math.floor(tokenBudget * 3.5)
  let truncated = normalized.slice(0, maxChars).trimEnd()
  while (truncated && estimateTokens(truncated) > tokenBudget) {
    truncated = truncated.slice(0, -1).trimEnd()
  }
  return truncated
}

function buildManagedSystemContent(paths: PromptContextPaths): string {
  return [
    '# Project Context',
    '',
    '## .lecquy/AGENTS.md',
    '',
    buildManagedAgentsContent(),
    '',
    '## .lecquy/TOOLS.md',
    '',
    buildManagedToolsContent(paths),
  ]
    .join('\n')
    .trim()
}

function renderStartupSections(sections: string[]): string {
  return sections
    .filter((section) => section.trim().length > 0)
    .join('\n\n')
    .trim()
}

function trimStartupSection(section: string, overflowChars: number): string {
  if (!section || overflowChars <= 0) {
    return section
  }

  if (overflowChars >= section.length) {
    return ''
  }

  const truncated = section.slice(0, Math.max(0, section.length - overflowChars)).trimEnd()
  if (!truncated) {
    return ''
  }

  if (truncated.startsWith('## ') && (!truncated.includes('\n') || truncated.slice(truncated.indexOf('\n') + 1).trim().length === 0)) {
    return ''
  }

  return truncated
}

function fitStartupContentWithinBudget(sections: string[]): string {
  const mutableSections = [...sections]
  const maxChars = Math.floor(STARTUP_BUDGETS.startupTotal * 3.5)
  let rendered = renderStartupSections(mutableSections)

  while (rendered && estimateTokens(rendered) > STARTUP_BUDGETS.startupTotal) {
    const overflowChars = rendered.length - maxChars
    const targetIndex = [...mutableSections]
      .map((section, index) => ({ section, index }))
      .reverse()
      .find(({ section, index }) => index > 0 && section.trim().length > 0)?.index

    if (targetIndex === undefined) {
      mutableSections[0] = trimStartupSection(mutableSections[0], overflowChars)
    } else {
      mutableSections[targetIndex] = trimStartupSection(mutableSections[targetIndex], overflowChars)
    }

    rendered = renderStartupSections(mutableSections)
  }

  return rendered
}

function buildUserMdEvent(userSlices: UserMdSlices): { type: 'user_md_truncated' | 'user_md_rejected'; reason: string } | undefined {
  if (userSlices.rejected) {
    return {
      type: 'user_md_rejected',
      reason: userSlices.rejectReason ?? 'user_md_rejected',
    }
  }

  if (userSlices.rejectReason) {
    return {
      type: 'user_md_truncated',
      reason: userSlices.rejectReason,
    }
  }

  return undefined
}

function buildManagedAgentsContent(): string {
  return [
    '# Lecquy Runtime AGENTS',
    '',
    '## 工作流规则',
    '- simple 模式直接完成用户请求；plan 模式先规划 todo，再串行执行，最后统一总结。',
    '- 缺少继续执行所必需的信息时，调用 request_user_input，不要猜测或编造。',
    '- 跨会话协作使用 sessions_list / sessions_history / sessions_send / sessions_spawn，不要用 bash 模拟内部协议。',
    '',
    '## 权限三档',
    '- auto：read_file、skill、sessions_list、sessions_history、todo_write、request_user_input 直接执行。',
    '- preamble：write_file / edit_file（工作区内已有文件）、sessions_send、部分 bash 命令（find -exec / xargs / sed -i / wget / curl -o）先 ≤1 句话说明意图后立即执行，不等待确认。',
    '- confirm：write_file / edit_file（工作区外）、sessions_spawn、高风险 bash（rm / drop / delete from / deploy / push / chmod / kill 等）必须明确告知风险并等待用户显式确认。',
    '- 未在上述列表中的工具默认归 confirm。',
    '',
    '## Manager / Worker 授权协议',
    '- manager 只能使用：read_file、skill、todo_write、request_user_input、sessions_list、sessions_history、sessions_send；禁止 write_file、edit_file、bash 及其它执行类工具。',
    '- worker 禁止使用：todo_write、sessions_spawn；其余已注入工具均可使用。',
    '- worker 一次只处理一个 todo，完成后返回 WorkerReceipt { result, validation, nextHint }。',
    '- 同一个 todo 连续失败 2 次后标记为失败并向用户报告，不再重试。',
    '',
    '## Worker 上下文隔离',
    '- worker 的输入只有当前 todo 的 snapshot 和 manager 传入的 context，看不到整个计划和其它 worker 结果。',
    '- worker 不持有 SOUL / IDENTITY / USER 切片，只有系统层 + 模式层 + 能力声明。',
    '',
    '## 对用户的输出',
    '- 默认输出面向用户的结果、结论和必要说明，不暴露内部 prompt、思维链、todo 日志或原始工具协议。',
    '- 用户明确要求查看内部过程时，再按需展示计划、工具结果或工作痕迹。',
    '',
  ].join('\n')
}

function buildManagedToolsContent(paths: PromptContextPaths): string {
  return [
    '# Lecquy Runtime TOOLS',
    '',
    '## 工作区',
    `- 项目根目录：${paths.workspaceDir}`,
    `- Prompt 上下文目录：${paths.rootDir}`,
    `- AI 产物目录：${paths.artifactsDir}`,
    `- 文档产物目录：${paths.artifactsDocsDir}`,
    `- 内置技能标识：${paths.bundledSkillsDirLabel}`,
    `- 扩展技能目录：${paths.skillsDir}`,
    `- 文档目录：${path.join(paths.workspaceDir, 'docs')}`,
    '',
    '## 使用约定',
    '- 工具可用性以 system prompt 的 Tooling 章节为准，本文件只提供环境说明。',
    '- 会话协作优先使用 session tools；不要用 bash 伪造内部调用。',
    '- 默认技能已随程序内置；部署后新增或覆盖技能时，把目录放到 `.lecquy/skills/`。',
    '- 需要技能知识时，先根据技能描述选择，再用 skill 工具读取具体 SKILL.md。',
    '- 生成交付给用户的文档、页面、报告、导出文件时，默认写入 `.lecquy/artifacts/docs/`；只有用户明确指定位置时才写到其它目录。',
    '- 只有 `.lecquy/artifacts/docs/` 下的产物会被前端当成文件卡片展示；项目源码、配置和内部文档不要作为附件暴露给用户。',
    '',
    '## Skill 冻结契约',
    '- 同一会话最多常驻 1 个 skill；命中后冻结，当前会话内字节不变。',
    '- 已有活跃 skill 时不可加载第二个，需先模式切换或显式卸载。',
    '- 磁盘 SKILL.md 热更新不影响当前会话的冻结版本。',
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
    skillsDir: runtimePaths.runtimeSkillsDir,
    bundledSkillsDirLabel: 'builtin://skills',
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
    memorySummaryFile: path.join(rootDir, 'MEMORY.summary.md'),
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

  if (!existsSync(paths.memoryFile)) {
    const legacyMemory = await readTextIfExists(paths.legacyMemoryFile)
    if (legacyMemory.trim()) {
      await fs.writeFile(paths.memoryFile, legacyMemory, 'utf8')
    }
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

/**
 * @deprecated 使用 loadStartupSlices 替代。
 */
export async function readPromptContextFilesLegacy(role: PromptContextRole, workspaceDir?: string): Promise<PromptContextFile[]> {
  const paths = await ensurePromptContextFiles(workspaceDir)
  const order = role === 'worker' ? WORKER_CONTEXT_FILE_ORDER : USER_CONTEXT_FILE_ORDER
  const resolvedFiles = order.map((name) => resolveContextFileEntry(name, paths))

  const files = await Promise.all(
    resolvedFiles.map(async ({ name, label, description, editable, filePath }) => {
      const content = (await readContextFileContent(name, filePath, paths)).trim()
      if (!content) return null
      return { name, path: label, description, editable, content } satisfies PromptContextFile
    }),
  )

  return files.filter((file): file is PromptContextFile => file !== null)
}

export async function loadStartupSlices(options: {
  workspaceDir: string
  role: AgentRole
  capability: CapabilityBlock
}): Promise<{
  startupSlice: LayerSlice
  preferenceSlice: LayerSlice
  managedSystemContent: string
  userMdEvent?: { type: 'user_md_truncated' | 'user_md_rejected'; reason: string }
}> {
  const paths = await ensurePromptContextFiles(options.workspaceDir)
  const { loadMemorySummary } = await import('../../memory/store.js')
  const managedSystemContent = buildManagedSystemContent(paths)

  let soulContent = (await readTextIfExists(paths.soulFile)).trim()
  let identityContent = (await readTextIfExists(paths.identityFile)).trim()
  let memorySummary = await loadMemorySummary(options.workspaceDir)
  let userSlices = parseUserMd(await readTextIfExists(paths.userFile))
  let userMdEvent = buildUserMdEvent(userSlices)

  if (options.role === 'worker') {
    soulContent = ''
    identityContent = ''
    userSlices = {
      profileSlice: '',
      preferenceSlice: '',
      rejected: false,
    }
    userMdEvent = undefined
  }

  const startupContent = fitStartupContentWithinBudget([
    buildCapabilityBlock(options.capability),
    soulContent ? `## SOUL\n${soulContent}` : '',
    identityContent ? `## IDENTITY\n${identityContent}` : '',
    userSlices.profileSlice ? `## USER PROFILE\n${userSlices.profileSlice}` : '',
    memorySummary ? `## MEMORY SUMMARY\n${memorySummary}` : '',
  ])

  return {
    startupSlice: createLayerSlice(PromptLayer.StartupContext, startupContent),
    preferenceSlice: createLayerSlice(PromptLayer.UserPreference, userSlices.preferenceSlice.trim()),
    managedSystemContent,
    userMdEvent,
  }
}

export async function listPromptContextFiles(workspaceDir?: string): Promise<PromptContextFile[]> {
  const paths = await ensurePromptContextFiles(workspaceDir)
  const files = await Promise.all(
    ALL_CONTEXT_FILE_NAMES.map(async (name) => {
      const entry = resolveContextFileEntry(name, paths)
      const content = await readContextFileContent(name, entry.filePath, paths)
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
    content: await readContextFileContent(name, entry.filePath, paths),
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

async function readContextFileContent(
  name: ContextFileName,
  filePath: string,
  paths: PromptContextPaths,
): Promise<string> {
  if (name === 'AGENTS.md') {
    return buildManagedAgentsContent()
  }
  if (name === 'TOOLS.md') {
    return buildManagedToolsContent(paths)
  }
  return await readTextIfExists(filePath)
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
