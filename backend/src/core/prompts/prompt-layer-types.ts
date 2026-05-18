// 中文：本文件（prompt-layer-types.ts）位于 backend/src/core/prompts/prompt-layer-types.ts，属于backend链路中的核心运行时与配置代码，连接上游调用方与下游执行逻辑。
// English: This file (prompt-layer-types.ts) belongs to the backend 核心运行时与配置 layer in backend/src/core/prompts/prompt-layer-types.ts, wiring upstream callers with downstream logic.

/**
 * 分层提示词协议定义文件。
 *
 * 该文件只定义“类型/常量/约定”，不承载业务执行逻辑。
 * 所有构建链路都应围绕这套协议工作：
 * - system-prompts.ts：按 LayerSlice 组装每层文本；
 * - context-files.ts：读取并构造 USER.md、SOUL/IDENTITY 等上下文；
 * - prompt-serializer.ts：把各 layer 转成带 LAYER 标签的 system prompt。
 * - 调用方：根据 layer 顺序判断缓存分层与动态层是否变更。
 *
 * 这是 system prompt 拼接链路的“类型契约层”：
 * - 它不读取文件；
 * - 它不渲染模板；
 * - 它不拼接字符串；
 * - 它只定义每个阶段共同遵守的层级、标签、预算和中间数据结构。
 *
 * 修改本文件的风险高于普通工具代码：
 * - PromptLayer 数值会影响 serializer 排序；
 * - LAYER_TAGS 文本会影响最终 prompt 字节、缓存命中和回放比对；
 * - STARTUP_BUDGETS 会影响上下文召回量和模型可见内容；
 * - BuildLayeredPromptOptions 字段会影响 system-prompts.ts 与调用方的接口稳定性。
 */

/**
 * Prompt 7 层优先级枚举。
 * 数值即注入顺序，同时也是默认 cache 顺序。
 * 1-5：可做 prefix cache 的静态层；6-7：每轮动态层（不应进入静态字节缓存边界）。
 */
export enum PromptLayer {
  /** 最稳定的系统基底：identity、tooling、safety、workspace、documentation 等。 */
  System = 1,
  /** 角色/模式指令：simple/manager/worker 与 simple/plan 差异主要落在这里。 */
  Mode = 2,
  /** 启动上下文：capability、SOUL/IDENTITY、USER profile、MEMORY.summary 等。 */
  StartupContext = 3,
  /** 已命中 skill 的运行时片段；未命中时可以为空 slice。 */
  SkillRuntime = 4,
  /** USER.md 中稳定 preference 切片，单独成层便于观察偏好变化。 */
  UserPreference = 5,
  /** 当轮召回记忆；按项目守则不进入 prefix system 字段，应挂在 user message。 */
  MemoryRecall = 6,
  /** 当轮实时输入/临时上下文；天然动态，不应参与 prefix cache。 */
  LiveTurn = 7,
}

/**
 * 与 PromptLayer 一一对应的 LAYER 标签名。
 * 标签名是序列化字节契约，任何变更都影响缓存命中和回放比对。
 */
export const LAYER_TAGS = {
  [PromptLayer.System]: 'system',
  [PromptLayer.Mode]: 'mode',
  [PromptLayer.StartupContext]: 'startup',
  [PromptLayer.SkillRuntime]: 'skill',
  [PromptLayer.UserPreference]: 'user_preference',
  [PromptLayer.MemoryRecall]: 'memory_recall',
  [PromptLayer.LiveTurn]: 'live_turn',
} as const satisfies Record<PromptLayer, string>

/**
 * prefix cache 段（1-5）的层级集合。
 * 这些层会在同一会话内稳定存在，优先参与字节级缓存。
 */
export const PREFIX_CACHE_LAYERS = [
  PromptLayer.System,
  PromptLayer.Mode,
  PromptLayer.StartupContext,
  PromptLayer.SkillRuntime,
  PromptLayer.UserPreference,
] as const

/**
 * 动态段集合（6-7），用于当轮上下文注入，不应与 prefix cache 同一命中策略。
 */
export const DYNAMIC_LAYERS = [
  PromptLayer.MemoryRecall,
  PromptLayer.LiveTurn,
] as const

/**
 * 单个分层切片标准结构。
 * 该结构必须是 serializer、builder、监控三方共同理解的中间件格式。
 */
export interface LayerSlice {
  /** 所属层级（数值/业务角色）。 */
  layer: PromptLayer
  /** 序列化标签名，必须是 LAYER_TAGS 成员。 */
  tag: string
  /** 该层完整文本。 */
  content: string
  /** SHA256 哈希，通常用于缓存一致性比对。 */
  contentHash: string
  /** 粗 token 估计值（1 token≈3.5 字符）。 */
  tokenEstimate: number
  /** 可选属性；目前用于 mode / skill id / runtime 标记。 */
  attributes?: Record<string, string>
}

/**
 * 运行时能力声明块（Capability）。
 * 逻辑上属于系统层语义，但最终通常注入到 startup 片段。
 */
export interface CapabilityBlock {
  /** 当前可用执行器。 */
  executor: 'powershell' | 'shell' | 'none'
  /** 可用能力清单。 */
  available: string[]
  /** 不可用能力清单。 */
  unavailable: string[]
}

/**
 * USER.md 解析产物。
 * 约定：profile 进入 startup 层，preference 进入 user_preference 层。
 */
export interface UserMdSlices {
  /** profile 段内容（startup）。 */
  profileSlice: string
  /** preference 段内容（user_preference）。 */
  preferenceSlice: string
  /** 是否命中 schema 失败或结构异常。 */
  rejected: boolean
  /** 拒绝原因标签，可用于 telemetry 与提示词降级说明。 */
  rejectReason?: string
}

/** USER.md frontmatter 的 schema 版本标识。 */
export const USER_MD_SCHEMA = 'lecquy.user/v1' as const

/**
 * worker 回执结构：worker 完成单 todo 后返回给 manager 的结构化结果。
 */
export interface WorkerReceipt {
  /** 执行结果。 */
  result: string
  /** 校验与验证说明。 */
  validation: string
  /** 下一步建议。 */
  nextHint?: string
}

/**
 * 工具调用权限等级。
 * auto：默认执行；preamble：先说明后执行；confirm：需用户显式确认。
 */
export enum PermissionTier {
  Auto = 'auto',
  Preamble = 'preamble',
  Confirm = 'confirm',
}

/**
 * Agent 角色类型；与 system-prompts 的 role 字段保持一一映射。
 */
export type AgentRole = 'simple' | 'manager' | 'worker'

/**
 * startup 里各类上下文预算（按估算 token）。
 * 控制原因：避免 prompt 体积失控影响延迟和缓存命中。
 */
export const STARTUP_BUDGETS = {
  /** capability block 预算。 */
  capability: 200,
  /** SOUL + IDENTITY 预算（已保留合计字段，便于后续拆分）。 */
  soulIdentity: 500,
  /** USER.md profile 预算。 */
  userProfile: 400,
  /** USER.md preference 预算。 */
  userPreference: 200,
  /** MEMORY.summary 预算。 */
  memorySummary: 400,
  /** startup 层总预算上限。 */
  startupTotal: 1500,
} as const

/**
 * 分层 Prompt 构建器输入参数。
 * 包含构建所有 layer 所需的上下文与控制位。
 */
export interface BuildLayeredPromptOptions {
  /** 角色。 */
  role: AgentRole
  /** 模式。 */
  mode: 'simple' | 'plan'
  /** 工作区路径（已解析到 workspace 根）。 */
  workspaceDir: string
  /** 运行时工具元数据。 */
  tools: Array<{
    /** 工具名。 */
    name: string
    /** 工具说明。 */
    description: string
  }>
  /** 工具开关。 */
  toolsEnabled: boolean
  /** 当前模型标识。 */
  modelId: string
  /** 推理强度。 */
  thinkingLevel?: string
  /** 通道来源。 */
  channel?: string
  /** 会话类型。 */
  chatType?: string
  /** 用户时区。 */
  timeZone?: string
  /** snapshot 创建时冻结的时间；缺省时保持 legacy 的即时取时行为。 */
  snapshotNow?: string
  /** 兼容层附加指令。 */
  extraInstructions?: string
  /** 已命中 skill 名。 */
  activeSkillName?: string
  /** 启动层托管文本（由 context-files 预组装）。 */
  managedSystemContent?: string
  /** 预构建 startup 切片（可为空）。 */
  startupSlice?: LayerSlice
  /** 预构建 preference 切片（可为空）。 */
  preferenceSlice?: LayerSlice
  /** 当前会话能力块。 */
  capability: CapabilityBlock
  /** USER.md 解析结果。 */
  userSlices: UserMdSlices
  /** SOUL.md 内容。 */
  soulContent: string
  /** IDENTITY.md 内容。 */
  identityContent: string
  /** MEMORY.summary.md 内容。 */
  memorySummary: string
}

/**
 * buildLayeredSystemPrompt 返回值。
 * 除 systemPrompt 外，额外保留每层 hash/token 供 cache + 运维观察。
 */
export interface LayeredPromptResult {
  /** 最终拼接出的单条 system prompt。 */
  systemPrompt: string
  /** 各层内容哈希（用于 cache 命中评估）。 */
  sliceHashes: Record<string, string>
  /** 各层 token 估计值。 */
  sliceTokens: Record<string, number>
}
