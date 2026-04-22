/**
 * 权限系统核心类型定义
 *
 * 参考 Claude Code `utils/permissions/` 的分层模型：
 *   - PermissionMode        控制 AI 的总体执行策略
 *   - PermissionBehavior    单条规则的原子行为（allow / deny / ask）
 *   - PermissionRule        匹配某个工具（及可选内容模式）的规则
 *   - PermissionRuleSource  规则的来源，决定优先级
 *   - PermissionDecision    单次权限检查的结果
 *
 * 与 Lecquy 原有 `core/prompts/prompt-layer-types.ts` 中的 `PermissionTier`
 * （Auto / Preamble / Confirm）共存：
 *   - 新引擎产出 `PermissionDecision`
 *   - 通过 `tier-bridge.ts` 翻译为 `PermissionTier`
 *   - 上游 `createPermissionAwareTools` 不需要改动
 */

/**
 * 权限模式 (Permission Mode)
 * 与 Claude Code 的 `EXTERNAL_PERMISSION_MODES` 对齐（去掉内部专用的 auto/bubble）。
 */
export const PERMISSION_MODES = [
  'default', // 默认：每次未知操作都询问
  'dontAsk', // 已知操作不再询问（严格：未知操作一律拒绝）
  'plan', // 计划模式：只预览，不实际执行
  'acceptEdits', // 自动接受所有编辑类操作
  'bypassPermissions', // 绕过所有权限检查（仅受信任环境使用）
] as const

export type PermissionMode = (typeof PERMISSION_MODES)[number]

/**
 * 默认权限模式。
 */
export const DEFAULT_PERMISSION_MODE: PermissionMode = 'default'

/**
 * 判断字符串是否为合法权限模式。
 */
export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value)
}

/**
 * 单条规则的行为。
 */
export type PermissionBehavior = 'allow' | 'deny' | 'ask'

/**
 * 规则来源；决定规则的优先级顺序。
 */
export const PERMISSION_RULE_SOURCES = [
  'cliArg', // 命令行参数（最高优先级）
  'session', // 当前会话临时规则
  'projectSettings', // 项目级 .lecquy/permissions.json
  'userSettings', // 用户级 ~/.lecquy/permissions.json
  'builtin', // 内置默认规则（最低优先级）
] as const

export type PermissionRuleSource = (typeof PERMISSION_RULE_SOURCES)[number]

/**
 * 规则来源的数字优先级（数值越大越高）。
 * 用于稳定排序：相同行为下高优先级先命中。
 */
export const RULE_SOURCE_PRIORITY: Record<PermissionRuleSource, number> = {
  cliArg: 40,
  session: 30,
  projectSettings: 20,
  userSettings: 10,
  builtin: 0,
}

/**
 * 单条权限规则。
 *
 * @example
 *   { source: 'projectSettings', behavior: 'deny', toolName: 'bash', content: 'rm -rf *' }
 *   { source: 'userSettings',    behavior: 'allow', toolName: 'read_file' }
 *   { source: 'builtin',         behavior: 'ask',  toolName: 'edit_file', content: '.env' }
 */
export interface PermissionRule {
  /** 规则来源。 */
  source: PermissionRuleSource
  /** 行为：allow / deny / ask。 */
  behavior: PermissionBehavior
  /** 目标工具名；使用 '*' 表示所有工具。 */
  toolName: string
  /**
   * 内容模式（可选）。
   *   - bash 工具：作为命令前缀匹配（大小写敏感），也支持简单 glob `*`
   *   - 文件类工具：作为路径 glob（支持 `*`、`**`、`?`）
   */
  content?: string
  /** 可选的人类可读描述，用于 UI 展示。 */
  description?: string
}

/**
 * 权限决策结果。
 */
export type PermissionDecision =
  | { behavior: 'allow'; reason: string; source?: PermissionRuleSource }
  | { behavior: 'deny'; reason: string; source?: PermissionRuleSource }
  | { behavior: 'ask'; reason: string; source?: PermissionRuleSource }
  | { behavior: 'plan'; reason: string; source?: PermissionRuleSource }

/**
 * 对外暴露的一次权限检查的完整结果。
 */
export interface PermissionResult {
  /** 决策。 */
  decision: PermissionDecision
  /**
   * 命中的规则（若有）。
   * 用于审计日志与 UI 展示。
   */
  matchedRule?: PermissionRule
  /**
   * 额外的建议规则更新（例如：用户选择"始终允许此命令"后生成一条 `session` 规则）。
   */
  suggestedUpdates?: PermissionUpdate[]
  /** 毫秒级时间戳，用于审计。 */
  timestamp: number
}

/**
 * 规则更新操作。
 * 类似 Claude Code 的 `PermissionUpdate`，但简化为三种基本操作。
 */
export type PermissionUpdate =
  | { type: 'addRule'; rule: PermissionRule }
  | {
    type: 'removeRule'
    toolName: string
    source: PermissionRuleSource
    content?: string
  }
  | { type: 'clearSource'; source: PermissionRuleSource }

/**
 * 规则更新目标：持久化到哪个源的配置文件。
 */
export type PermissionUpdateDestination = Extract<
  PermissionRuleSource,
  'projectSettings' | 'userSettings'
>

/**
 * 分类器结果（Bash 命令分类器使用）。
 */
export interface ClassifierResult {
  /** 命中等级：allow / ask / deny。 */
  level: PermissionBehavior
  /** 置信度（规则命中一般为 high；AI 分类器可给出 medium/low）。 */
  confidence: 'high' | 'medium' | 'low'
  /** 触发命中的说明文本。 */
  reason: string
  /** 命中的模式（调试用）。 */
  matchedPattern?: string
}

/**
 * 分类器接口。
 * 当前内置实现为规则驱动（`RuleBasedBashClassifier`）。
 * 未来可接入 AI 分类器，只需实现同一接口。
 */
export interface CommandClassifier {
  readonly name: string
  classify(input: { command: string; cwd?: string }): Promise<ClassifierResult>
}

/**
 * 权限检查调用上下文。
 */
export interface PermissionCheckContext {
  /** 工具名，如 'bash' / 'edit_file' / 'read_file'。 */
  toolName: string
  /** 工具参数，未经修饰直接透传。 */
  args: Record<string, unknown>
  /** 当前工作区根目录（绝对路径）。 */
  workspaceDir: string
  /** 本次会话中的 Agent 角色。 */
  role?: 'simple' | 'manager' | 'worker'
  /** 本次请求是否由用户触发（true 时某些规则可放宽）。 */
  userInitiated?: boolean
}

/**
 * 单条审计记录。
 */
export interface PermissionAuditRecord {
  /** 毫秒级时间戳。 */
  timestamp: number
  /** 本次决策对应的工具。 */
  toolName: string
  /** 工具参数快照（可能被裁剪）。 */
  args: Record<string, unknown>
  /** 最终决策。 */
  decision: PermissionDecision
  /** 是否命中了规则（若命中则记录规则来源）。 */
  matchedSource?: PermissionRuleSource
  /** 当前权限模式。 */
  mode: PermissionMode
}
