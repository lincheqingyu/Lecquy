/**
 * Prompt 7 层优先级枚举。
 * 数值即优先级顺序，也是最终注入顺序。
 * 1-5 为 prefix cache 段，6-7 为动态段。
 */
export enum PromptLayer {
  System = 1,
  Mode = 2,
  StartupContext = 3,
  SkillRuntime = 4,
  UserPreference = 5,
  MemoryRecall = 6,
  LiveTurn = 7,
}

/**
 * 与 PromptLayer 一一对应的 LAYER 标签名。
 * 标签名属于字节级契约，后续实现应视为不可随意修改。
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
 * prefix cache 段对应的层级集合。
 */
export const PREFIX_CACHE_LAYERS = [
  PromptLayer.System,
  PromptLayer.Mode,
  PromptLayer.StartupContext,
  PromptLayer.SkillRuntime,
  PromptLayer.UserPreference,
] as const

/**
 * 动态段对应的层级集合。
 */
export const DYNAMIC_LAYERS = [
  PromptLayer.MemoryRecall,
  PromptLayer.LiveTurn,
] as const

/**
 * 单个 Prompt 层切片。
 * 作为序列化器与各层构建器之间的标准输入单元。
 */
export interface LayerSlice {
  /** 所属层级。 */
  layer: PromptLayer
  /** LAYER 标签名。 */
  tag: string
  /** 该层的完整文本内容。 */
  content: string
  /** 内容的 SHA256 哈希，用于 cache 命中判断。 */
  contentHash: string
  /** 粗估 token 数，按 1 token ≈ 3.5 字符估算。 */
  tokenEstimate: number
  /** 可选属性，会被序列化为 LAYER 标签属性。 */
  attributes?: Record<string, string>
}

/**
 * 运行时能力声明块。
 * 逻辑归属 system 层，但物理注入位置位于 startup 段首部。
 */
export interface CapabilityBlock {
  /** 当前可用的 OS 执行器。 */
  executor: 'powershell' | 'shell' | 'none'
  /** 可用能力列表。 */
  available: string[]
  /** 不可用能力列表。 */
  unavailable: string[]
}

/**
 * USER.md 解析产物。
 * profile 与 preference 会分别注入不同层。
 */
export interface UserMdSlices {
  /** profile 段内容，注入层 3 startup context。 */
  profileSlice: string
  /** preference 段内容，注入层 5 user preference。 */
  preferenceSlice: string
  /** 是否被拒绝使用。 */
  rejected: boolean
  /** 被拒绝时的原因。 */
  rejectReason?: string
}

/**
 * USER.md frontmatter 的 schema 版本标识。
 */
export const USER_MD_SCHEMA = 'lecquy.user/v1' as const

/**
 * worker 完成单个 todo 后返回的结构化回执。
 */
export interface WorkerReceipt {
  /** 执行结果。 */
  result: string
  /** 验证说明。 */
  validation: string
  /** 对下一步的建议。 */
  nextHint?: string
}

/**
 * 工具调用权限等级。
 * auto 直接执行，preamble 先说明后执行，confirm 必须等待显式确认。
 */
export enum PermissionTier {
  Auto = 'auto',
  Preamble = 'preamble',
  Confirm = 'confirm',
}

/**
 * Agent 角色类型。
 * 与当前 system-prompts.ts 中的 role 字段保持对齐。
 */
export type AgentRole = 'simple' | 'manager' | 'worker'

/**
 * startup context 各分项的 token 预算。
 */
export const STARTUP_BUDGETS = {
  /** capability block 预算。 */
  capability: 200,
  /** SOUL.md 与 IDENTITY.md 的合计预算。 */
  soulIdentity: 500,
  /** USER.md profile 段预算。 */
  userProfile: 400,
  /** USER.md preference 段预算。 */
  userPreference: 200,
  /** MEMORY.summary.md 预算。 */
  memorySummary: 400,
  /** startup 层总预算上限。 */
  startupTotal: 1500,
} as const

/**
 * 分层 Prompt 构建器的输入参数。
 * 整合当前系统提示词构建所需的基础上下文。
 */
export interface BuildLayeredPromptOptions {
  /** Agent 角色。 */
  role: AgentRole
  /** 会话模式。 */
  mode: 'simple' | 'plan'
  /** 工作区目录。 */
  workspaceDir: string
  /** 当前可注入的工具列表。 */
  tools: Array<{
    /** 工具名。 */
    name: string
    /** 工具说明。 */
    description: string
  }>
  /** 当前这一步是否启用工具。 */
  toolsEnabled: boolean
  /** 当前模型标识。 */
  modelId: string
  /** thinking 等级。 */
  thinkingLevel?: string
  /** 路由 channel。 */
  channel?: string
  /** 会话 chatType。 */
  chatType?: string
  /** 用户时区。 */
  timeZone?: string
  /** 额外追加指令。 */
  extraInstructions?: string
  /** 当前命中的 skill 名称。 */
  activeSkillName?: string
  /** 由 startup loader 产出的托管 system 内容。 */
  managedSystemContent?: string
  /** 由 startup loader 预构建的 startup 层切片。 */
  startupSlice?: LayerSlice
  /** 由 startup loader 预构建的 user preference 层切片。 */
  preferenceSlice?: LayerSlice
  /** capability block 数据。 */
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
 * 分层 Prompt 构建器的返回结果。
 */
export interface LayeredPromptResult {
  /** 最终拼接出的单条 systemPrompt 字符串。 */
  systemPrompt: string
  /** 各层内容哈希，用于判断 cache 是否命中。 */
  sliceHashes: Record<string, string>
  /** 各层粗估 token 数。 */
  sliceTokens: Record<string, number>
}
