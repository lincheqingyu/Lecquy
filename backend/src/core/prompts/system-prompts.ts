// 中文：本文件（system-prompts.ts）位于 backend/src/core/prompts/system-prompts.ts，属于backend链路中的核心运行时与配置代码，连接上游调用方与下游执行逻辑。
// English: This file (system-prompts.ts) belongs to the backend 核心运行时与配置 layer in backend/src/core/prompts/system-prompts.ts, wiring upstream callers with downstream runtime logic.

/**
 * System prompt 组装核心编排器（system-prompt builder core）。
 *
 * 这里负责把可配置模板、上下文文件、运行时 metadata、skill 片段拼成有序分层。
 * 核心调用链：
 * prompt-serializer.buildLayeredSystemPrompt
 * -> buildSystemLayerSlice / buildModeLayerSlice / buildStartupLayerSlice / buildSkillLayerSlice / buildUserPreferenceSlice
 * -> context-files / prompt-module-files / capability-block / SKILLS + 运行时上下文
 *
 * 关键约束：
 * 1. 同一层输入尽量产出确定性文本（排序、去重、模板替换都要稳定）。
 * 2. role/mode 变化应尽量只落在 mode/system 层，避免污染 startup/token预算层。
 * 3. system prompt 旧链路兼容通过 buildSystemPromptLegacy 暴露，避免线上热切换抖动。
 *
 * 只看 system 拼接时，本文件处在整条链路的第一站：
 * 1. system-prompts.ts 接收 BuildSystemPromptOptions / BuildLayeredPromptOptions；
 * 2. 通过 prompt-module-files.ts 读取并渲染 identity / role / tooling / safety 等稳定模板；
 * 3. 通过 context-files.ts 读取 .lecquy/AGENTS.md、TOOLS.md、SOUL.md、IDENTITY.md、USER.md、MEMORY.md 等上下文；
 * 4. 通过 capability-block.ts 和 user-md-parser.ts 生成能力块、用户画像、用户偏好等 startup/user_preference 输入；
 * 5. 通过 prompt-layer-types.ts 约束每层的枚举、标签、预算和中间结构；
 * 6. 最终交给 prompt-serializer.ts 按层级排序并输出一条稳定的 system prompt 字符串。
 *
 * 本文件不是“模板内容”的归属地：
 * - 模板文件名、默认模板与占位符替换规则属于 prompt-module-files.ts；
 * - .lecquy 上下文文件路径、预算裁剪和托管上下文构造属于 context-files.ts；
 * - LAYER 标签、层级顺序、缓存分层协议属于 prompt-layer-types.ts；
 * - 真实字符串序列化格式属于 prompt-serializer.ts。
 *
 * 因此维护本文件时优先关注“调用顺序”和“组合边界”，不要把大量静态文案硬塞进这里。
 */

import { existsSync } from 'node:fs'
import path from 'node:path'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { SessionMode, SessionRouteContext, ThinkingLevel } from '@lecquy/shared'
import { readPromptContextFilesLegacy, resolvePromptContextPaths, type PromptContextRole } from './context-files.js'
import { renderPromptModuleTemplate } from './prompt-module-files.js'
import type { BuildLayeredPromptOptions, LayerSlice } from './prompt-layer-types.js'
import { PromptLayer } from './prompt-layer-types.js'
import { createSlice } from './prompt-serializer.js'
import { buildCapabilityBlock } from './capability-block.js'
import { SKILLS } from '../skills/skill-loader.js'

export interface BuildSystemPromptOptions {
  /** 目标角色。决定 identity / role 指令模板与是否读取文档/时间片。 */
  readonly role: PromptContextRole
  /** 会话模式（simple / plan）。用于注入 mode 层以及 runtime 标记。 */
  readonly mode: SessionMode
  /** 会话路由上下文。用于补充时区、channel 等运行环境字段。 */
  readonly route?: SessionRouteContext
  /** 可选模型 ID。会被透传到 runtime 段用于 trace 与重放。 */
  readonly modelId?: string | null
  /** 当前会话可见工具列表。用于 Tooling 段和权限提示生成。 */
  readonly tools: ReadonlyArray<AgentTool<any>>
  /** 思考等级（思考模式 / reasoning 强度）。 */
  readonly thinkingLevel?: ThinkingLevel
  /** 工具总开关，用于在工具未挂接时给出更清晰提示。 */
  readonly toolsEnabled?: boolean
  /** 兼容层附加指令（最低优先级）注入 runtime 尾部。 */
  readonly extraInstructions?: string
  /** 可选工作区根路径；未提供时走默认 root（cwd/运行时路径）。 */
  readonly workspaceDir?: string
}

interface RuntimeSectionFields {
  /** 当前 prompt 以哪个 agent 角色运行；会影响 identity/role 模板选择。 */
  readonly role: PromptContextRole
  /** 当前会话模式；simple 与 plan 会影响 mode 层与运行时 trace。 */
  readonly mode: SessionMode
  /** 会话来源通道，例如 web / telegram / local；为空时不输出该字段。 */
  readonly channel?: string
  /** 模型标识；只用于运行态可观测和回放，不应驱动业务分支。 */
  readonly modelId?: string | null
  /** 推理强度描述；用于让下游日志知道本轮 reasoning 设定。 */
  readonly thinkingLevel?: string
  /** 工具总开关；用于区分“没有工具”和“工具被关闭”。 */
  readonly toolsEnabled?: boolean
  /** 工具数量；只放统计值，避免 runtime 段重复完整工具 inventory。 */
  readonly toolCount?: number
}

interface ToolSummaryLike {
  /** 工具调用名，必须与模型可调用工具名一致。 */
  readonly name: string
  /** 面向模型的工具说明，优先级高于 label。 */
  readonly description?: string
  /** 兜底展示名；当 description 缺失时用于提示模型工具用途。 */
  readonly label?: string
}

/**
 * 按角色渲染 identity 开场白模板。
 * 上游角色：simple/manager/worker 三种 identity 模板。
 * 下游消费：buildSystemLayerSlice 中的 system 层开头。
 * 路径：system 模板 -> prompt-module-files.ts -> renderPromptModuleTemplate。
 */
async function buildIdentityLine(role: PromptContextRole, workspaceDir?: string): Promise<string> {
  // 角色到模板名的映射必须保持显式展开，避免后续新增角色时静默落到 simple。
  const templateName =
    role === 'manager'
      ? 'identity-manager'
      : role === 'worker'
        ? 'identity-worker'
        : 'identity-simple'

  // 模板读取由 prompt-module-files.ts 接管；这里不关心模板来自磁盘还是默认内置值。
  return await renderPromptModuleTemplate(templateName, {}, workspaceDir)
}

/**
 * 生成 mode 指令 section（Role Directive）。
 * 上游：buildModeLayerSlice / buildSystemPromptLegacy。
 * 下游：返回字符串数组，后续交由 toSectionLines 标准化追加空行边界。
 * 与 system 层职责分离，避免角色差异过多影响 startup 缓存边界。
 */
async function buildRoleDirectiveSection(role: PromptContextRole, workspaceDir?: string): Promise<string[]> {
  // Role Directive 是 mode 层的核心文本；manager/worker/simple 分开有助于控制差异范围。
  const templateName =
    role === 'manager'
      ? 'role-manager'
      : role === 'worker'
        ? 'role-worker'
        : 'role-simple'

  // toSectionLines 会把渲染结果转成数组，统一交给后续 section 组合函数控制空行。
  return toSectionLines(await renderPromptModuleTemplate(templateName, {}, workspaceDir))
}

/**
 * 组装工具声明列表。
 * 输入是工具元信息；输出为 Tooling 章节文本数组。
 * 关键点：
 * - 当工具未启用/空时，明确写入降级说明，避免模型“猜工具”。
 * - 每个工具优先用 description，其次 label，缺失则 fallback 为“可用工具”。
 */
async function buildToolingSection(
  tools: ReadonlyArray<ToolSummaryLike>,
  toolsEnabled: boolean,
  workspaceDir?: string,
): Promise<string[]> {
  // 工具关闭时必须输出明确降级文本；否则模型可能根据历史经验幻觉不存在的工具。
  const toolingBody = !toolsEnabled || tools.length === 0
    ? '- 当前这一步未启用一等工具；请只基于已有上下文作答。'
    : tools
        .map((tool) => {
          // description 是给模型看的正式说明；label 只作为兼容旧工具元数据的兜底。
          const summary = tool.description?.trim() || tool.label?.trim() || '可用工具'
          return `- ${tool.name}: ${summary}`
        })
        .join('\n')

  // tooling.md 内部只持有结构和占位符，真实工具列表由本函数按当前会话动态填充。
  return toSectionLines(await renderPromptModuleTemplate('tooling', { TOOLING_BODY: toolingBody }, workspaceDir))
}

/**
 * 渲染“工具调用风格”约束。
 * 仅影响调用语气，不直接改变工具白名单本体。
 */
async function buildToolCallStyleSection(workspaceDir?: string): Promise<string[]> {
  return toSectionLines(await renderPromptModuleTemplate('tool-call-style', {}, workspaceDir))
}

/**
 * 渲染安全条款。
 * 安全段与角色段/工具段同层渲染，主要用于下游 runtime 的行为边界定义。
 */
async function buildSafetySection(workspaceDir?: string): Promise<string[]> {
  return toSectionLines(await renderPromptModuleTemplate('safety', {}, workspaceDir))
}

/**
 * 渲染 Skills 引导列表。
 * 上游由 SKILLS 注册表提供摘要；下游作为 system 内容的一部分。
 * 未命中任何 skill 时返回空数组，保持无害缺省。
 */
async function buildSkillsSection(workspaceDir: string): Promise<string[]> {
  // skill registry 是运行时可发现能力索引；这里只注入摘要，不直接读取完整 SKILL.md。
  const skills = SKILLS.listSkillSummaries(workspaceDir)
  if (skills.length === 0) {
    return []
  }

  // displayPath 帮助模型在需要时定位 skill，但是否读取仍由 skill 触发规则决定。
  const skillList = skills
    .map((skill) => `- ${skill.name}: ${skill.description} (${skill.displayPath})`)
    .join('\n')

  return toSectionLines(await renderPromptModuleTemplate('skills', { SKILL_LIST: skillList }, workspaceDir))
}

/**
 * 渲染 workspace 段，固定注入 PROJECT 根目录。
 * 作用是让模型在输出前后决策均以当前工作区为边界。
 */
async function buildWorkspaceSection(workspaceDir: string): Promise<string[]> {
  return toSectionLines(await renderPromptModuleTemplate('workspace', { WORKSPACE_DIR: workspaceDir }, workspaceDir))
}

/**
 * 渲染 Documentation 段。
 * 当 docs/README 或 backend/AGENTS.md 存在时写入可发现入口；
 * 用于降低“凭空猜测项目规则”的概率。
 */
async function buildDocumentationSection(workspaceDir: string): Promise<string[]> {
  // 文档入口只在文件真实存在时注入，避免 prompt 中出现不可访问路径。
  const docsRoot = path.join(workspaceDir, 'docs')
  const docsReadme = path.join(docsRoot, 'README.md')
  const backendDocs = path.join(docsRoot, 'backend')
  const backendAgents = path.join(workspaceDir, 'backend', 'AGENTS.md')
  const docLines: string[] = []

  if (existsSync(docsReadme)) {
    docLines.push(`- 项目文档入口：${docsReadme}`)
  }
  if (existsSync(backendDocs)) {
    docLines.push(`- 后端文档目录：${backendDocs}`)
  }
  if (existsSync(backendAgents)) {
    docLines.push(`- 后端开发说明：${backendAgents}`)
  }

  if (docLines.length === 0) {
    return []
  }

  return toSectionLines(
    await renderPromptModuleTemplate('documentation', { DOCUMENTATION_LINES: docLines.join('\n') }, workspaceDir),
  )
}

/**
 * 使用 Intl.DateTimeFormat 生成 timezone 绑定的本地日期时间。
 * 输入时区 -> 输出 {date,time}，避免手工 offset 误差导致的时间漂移。
 */
function formatLocalDateTime(timezone: string, now = new Date()): { date: string; time: string } {
  // 使用 Intl 而非手写 offset，是为了让夏令时、地区规则和未来时区数据库更新由运行时处理。
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = formatter.formatToParts(now)
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const date = `${byType.year}-${byType.month}-${byType.day}`
  const time = `${byType.hour}:${byType.minute}`
  return { date, time }
}

/**
 * 根据路由中的 timezone 生成 Current Date & Time 段。
 * 上游 route.userTimezone 可为空，空值即不注入，避免污染无意义字段。
 */
async function buildTimeSection(route: SessionRouteContext | undefined, workspaceDir?: string, snapshotNow?: string): Promise<string[]> {
  // 时间是高频动态字段：只有调用方明确提供 userTimezone 时才注入，减少无意义 prompt 变化。
  const timezone = route?.userTimezone?.trim()
  if (!timezone) {
    return []
  }

  const { date, time } = formatLocalDateTime(timezone, snapshotNow ? new Date(snapshotNow) : undefined)
  return toSectionLines(
    await renderPromptModuleTemplate(
      'time',
      {
        TIME_ZONE: timezone,
        CURRENT_DATE: date,
        CURRENT_TIME: time,
      },
      workspaceDir,
    ),
  )
}

/**
 * 兼容层封装：将 timezone 直接转为 buildTimeSection 输入。
 * 避免重复组装 route 对象。
 */
async function buildTimeSectionFromTimezone(timezone: string | undefined, workspaceDir?: string, snapshotNow?: string): Promise<string[]> {
  return await buildTimeSection(
    timezone ? { userTimezone: timezone } as SessionRouteContext : undefined,
    workspaceDir,
    snapshotNow,
  )
}

/**
 * 读取 .lecquy 上下文文件并拼接 Project Context。
 * 该段面向普通角色提供完整上下文；worker 也会通过 readPromptContextFilesLegacy 进入过滤分支。
 */
async function buildProjectContextSection(role: PromptContextRole, workspaceDir?: string): Promise<string[]> {
  // 旧链路的 Project Context 仍从 context-files.ts 读取，保证迁移到分层 prompt 前后语义一致。
  const files = await readPromptContextFilesLegacy(role, workspaceDir)
  if (files.length === 0) {
    return []
  }

  const lines = ['# Project Context', '']
  const hasSoul = files.some((file) => file.path.endsWith('/SOUL.md'))
  if (hasSoul) {
    lines.push('如果存在 SOUL.md，请体现其中的人格、语气与边界，但高优先级的安全规则和角色约束始终优先。', '')
  }

  for (const file of files) {
    lines.push(`## ${file.path}`, '', file.content, '')
  }

  return lines
}

/**
 * 仅渲染系统托管上下文（AGENTS/TOOLS）；
 * 供 system 层使用，降低普通可编辑文件与托管规则的耦合。
 */
async function buildManagedContextSection(role: PromptContextRole, workspaceDir?: string): Promise<string[]> {
  const files = await readPromptContextFilesLegacy(role, workspaceDir)
  const managedFiles = files.filter((file) => file.name === 'AGENTS.md' || file.name === 'TOOLS.md')
  if (managedFiles.length === 0) {
    return []
  }

  const lines = ['# Project Context', '']
  for (const file of managedFiles) {
    lines.push(`## ${file.path}`, '', file.content, '')
  }
  return lines
}

/**
 * 组装 runtime 元数据行（role/mode/channel/model/thinking/toolsEnabled）。
 * 该信息会落在 runtime 模板，作为“当前执行态快照”方便重放和调试。
 */
async function buildRuntimeSection(runtimeFields: RuntimeSectionFields, workspaceDir?: string): Promise<string[]> {
  const toolsEnabled = runtimeFields.toolsEnabled ?? (runtimeFields.toolCount ?? 0) > 0
  const serializedFields = [
    `role=${runtimeFields.role}`,
    `mode=${runtimeFields.mode}`,
    runtimeFields.channel ? `channel=${runtimeFields.channel}` : '',
    runtimeFields.modelId ? `model=${runtimeFields.modelId}` : '',
    `thinking=${runtimeFields.thinkingLevel ?? 'off'}`,
    `toolsEnabled=${toolsEnabled ? 'true' : 'false'}`,
  ].filter(Boolean)

  return toSectionLines(
    await renderPromptModuleTemplate('runtime', { RUNTIME_FIELDS: serializedFields.join(' | ') }, workspaceDir),
  )
}

/**
 * 附加自定义指令（extra instructions）：
 * 该输入通常来自兼容层参数，按模板拼接为最低优先级片段。
 */
async function buildExtraInstructionsSection(extraInstructions: string | undefined, workspaceDir?: string): Promise<string[]> {
  const trimmed = extraInstructions?.trim()
  if (!trimmed) {
    return []
  }

  return toSectionLines(
    await renderPromptModuleTemplate('extra-instructions', { EXTRA_INSTRUCTIONS: trimmed }, workspaceDir),
  )
}

/**
 * 组合 startup-context 的静态文本块（capability + SOUL + IDENTITY + USER.profile + MEMORY SUMMARY）。
 * 该输出直接作为 startup 层基础内容。
 */
function buildStartupContextContent(options: BuildLayeredPromptOptions): string {
  const sections = [
    buildCapabilityBlock(options.capability),
    options.soulContent.trim() ? `## SOUL\n${options.soulContent.trim()}` : '',
    options.identityContent.trim() ? `## IDENTITY\n${options.identityContent.trim()}` : '',
    options.userSlices.profileSlice.trim() ? `## USER PROFILE\n${options.userSlices.profileSlice.trim()}` : '',
    options.memorySummary.trim() ? `## MEMORY SUMMARY\n${options.memorySummary.trim()}` : '',
  ].filter((section) => section.trim().length > 0)

  return sections.join('\n\n')
}

/**
 * 统一合并 section（string 或 lines[]）并去除首尾空白。
 * 用途：避免不同分片在拼接时引入空行语义歧义。
 */
function joinSections(sections: Array<string | string[]>): string {
  return sections
    .flatMap((section) => Array.isArray(section) ? section : [section])
    .join('\n')
    .trim()
}

/**
 * @deprecated 使用 buildLayeredSystemPrompt 替代。
 * 保留为 fallback，维持原有 system prompt 拼装逻辑不变。
 */
export async function buildSystemPromptLegacy(options: BuildSystemPromptOptions): Promise<string> {
  const workspaceDir = resolvePromptContextPaths(options.workspaceDir).workspaceDir
  const toolsEnabled = options.toolsEnabled ?? options.tools.length > 0

  const sections = [
    await buildIdentityLine(options.role, workspaceDir),
    '',
    ...(await buildRoleDirectiveSection(options.role, workspaceDir)),
    ...(await buildToolingSection(options.tools, toolsEnabled, workspaceDir)),
    ...(await buildToolCallStyleSection(workspaceDir)),
    ...(await buildSafetySection(workspaceDir)),
    ...(await buildSkillsSection(workspaceDir)),
    ...(await buildWorkspaceSection(workspaceDir)),
    ...(options.role === 'worker' ? [] : await buildDocumentationSection(workspaceDir)),
    ...(options.role === 'worker' ? [] : await buildTimeSection(options.route, workspaceDir)),
    ...(await buildProjectContextSection(options.role, workspaceDir)),
    ...(await buildRuntimeSection({
      role: options.role,
      mode: options.mode,
      channel: options.route?.channel,
      modelId: options.modelId,
      thinkingLevel: options.thinkingLevel,
      toolsEnabled: options.toolsEnabled,
      toolCount: options.tools.length,
    }, workspaceDir)),
    ...(await buildExtraInstructionsSection(options.extraInstructions, workspaceDir)),
  ]

  return sections.join('\n').trim()
}

/**
 * 构建 system 层切片。
 * 合并身份、工具、安全、技能索引、工作区、文档、时间、运行时以及托管上下文。
 */
export async function buildSystemLayerSlice(options: BuildLayeredPromptOptions): Promise<LayerSlice> {
  const workspaceDir = resolvePromptContextPaths(options.workspaceDir).workspaceDir
  const managedSystemContent = options.managedSystemContent?.trim()
  const content = joinSections([
    await buildIdentityLine(options.role, workspaceDir),
    '',
    await buildToolingSection(options.tools, options.toolsEnabled, workspaceDir),
    await buildToolCallStyleSection(workspaceDir),
    await buildSafetySection(workspaceDir),
    await buildSkillsSection(workspaceDir),
    await buildWorkspaceSection(workspaceDir),
    options.role === 'worker' ? [] : await buildDocumentationSection(workspaceDir),
    options.role === 'worker' ? [] : await buildTimeSectionFromTimezone(options.timeZone, workspaceDir, options.snapshotNow),
    managedSystemContent ? managedSystemContent : await buildManagedContextSection(options.role, workspaceDir),
    await buildRuntimeSection({
      role: options.role,
      mode: options.mode,
      channel: options.channel,
      modelId: options.modelId,
      thinkingLevel: options.thinkingLevel,
      toolsEnabled: options.toolsEnabled,
      toolCount: options.tools.length,
    }, workspaceDir),
    await buildExtraInstructionsSection(options.extraInstructions, workspaceDir),
  ])

  return createSlice(PromptLayer.System, content)
}

/**
 * 构建 mode 层切片。
 * 当前仅承载角色差异化指令，并通过 name 属性标记 simple/plan 模式。
 */
export async function buildModeLayerSlice(options: BuildLayeredPromptOptions): Promise<LayerSlice> {
  const workspaceDir = resolvePromptContextPaths(options.workspaceDir).workspaceDir
  const content = joinSections([
    await buildRoleDirectiveSection(options.role, workspaceDir),
  ])

  return createSlice(PromptLayer.Mode, content, { name: options.mode })
}

/**
 * 构建 startup context 层切片。
 * 包 1 阶段直接使用传入的 capability、SOUL、IDENTITY、USER.profile 与 memorySummary。
 */
export async function buildStartupLayerSlice(options: BuildLayeredPromptOptions): Promise<LayerSlice> {
  if (options.startupSlice) {
    // 已被 buildLayeredSystemPrompt.loadStartupSlices 缓存，直接复用避免重复解析成本。
    return options.startupSlice
  }
  return createSlice(PromptLayer.StartupContext, buildStartupContextContent(options))
}

/**
 * 构建 skill runtime 层切片。
 * 命中 skill 时注入 skill 正文，否则返回空切片。
 */
export async function buildSkillLayerSlice(options: BuildLayeredPromptOptions): Promise<LayerSlice> {
  const workspaceDir = resolvePromptContextPaths(options.workspaceDir).workspaceDir
  const activeSkillName = options.activeSkillName?.trim()
  if (!activeSkillName) {
    return createSlice(PromptLayer.SkillRuntime, '')
  }

  const skillContent = SKILLS.getSkillContent(activeSkillName, workspaceDir) ?? ''
  return createSlice(PromptLayer.SkillRuntime, skillContent, { id: activeSkillName })
}

/**
 * 构建 user preference 层切片。
 * 内容直接来自 USER.md preference 切片。
 */
export async function buildUserPreferenceSlice(options: BuildLayeredPromptOptions): Promise<LayerSlice> {
  if (options.preferenceSlice) {
    return options.preferenceSlice
  }
  return createSlice(PromptLayer.UserPreference, options.userSlices.preferenceSlice.trim())
}

/**
 * 简单角色 prompt 的兼容 API。
 * 保留旧入口供节点路由/测试调用，内部仍走 buildSystemPromptLegacy。
 */
export async function buildSimpleSystemPrompt(options: Omit<BuildSystemPromptOptions, 'role'>): Promise<string> {
  return await buildSystemPromptLegacy({ ...options, role: 'simple' })
}

/**
 * 管理者角色 prompt 的兼容 API。
 * 仅改变角色参数，不改变其余拼接语义。
 */
export async function buildManagerPrompt(options: Omit<BuildSystemPromptOptions, 'role'>): Promise<string> {
  return await buildSystemPromptLegacy({ ...options, role: 'manager' })
}

/**
 * 工作者角色 prompt 的兼容 API。
 * worker 主要用于只读和执行任务分片的提示语场景。
 */
export async function buildWorkerPrompt(options: Omit<BuildSystemPromptOptions, 'role'>): Promise<string> {
  return await buildSystemPromptLegacy({ ...options, role: 'worker' })
}

/**
 * 总结节点提示词（用于 nodes.ts summarize）。
 * 强制要求模型在该阶段只回用户可见结果，不再调用工具，减少收口噪音。
 */
export function buildSummarizePrompt(reason: string): string {
  return `${reason}，请基于已有的对话内容，总结当前的工作进展和结果，直接回复用户。\n不要再调用任何工具。`
}

/**
 * 工具型字符串转段落数组：trim 后拆行并补尾空行，给渲染器一个稳定的段落终止符。
 */
function toSectionLines(section: string): string[] {
  const trimmed = section.trim()
  if (!trimmed) return []
  return [...trimmed.split('\n'), '']
}
