/**
 * 会话与工作流共享类型定义
 */

/** 会话 ID（品牌类型，增强类型安全） */
export type SessionId = string & { readonly __brand: 'SessionId' }
export type SessionKey = string & { readonly __brand: 'SessionKey' }
export type SessionBranchId = string & { readonly __brand: 'SessionBranchId' }
export type RunId = string & { readonly __brand: 'RunId' }
export type StepId = string & { readonly __brand: 'StepId' }
export type PauseId = string & { readonly __brand: 'PauseId' }

/** 创建带前缀的随机 ID */
function createPrefixedId(prefix: string, explicitId?: string): string {
  return explicitId ?? `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

/** 创建 SessionId */
export function createSessionId(id?: string): SessionId {
  return createPrefixedId('sess', id) as SessionId
}

/** 创建 RunId */
export function createRunId(id?: string): RunId {
  return createPrefixedId('run', id) as RunId
}

/** 创建 StepId */
export function createStepId(id?: string): StepId {
  return createPrefixedId('step', id) as StepId
}

/** 创建 PauseId */
export function createPauseId(id?: string): PauseId {
  return createPrefixedId('pause', id) as PauseId
}

/** 序列化的 todo 项 */
export interface SerializedTodoItem {
  readonly content: string
  readonly status: 'pending' | 'in_progress' | 'completed'
  readonly activeForm: string
  readonly result?: string
  readonly errorMessage?: string
}

export type SessionMode = 'simple' | 'plan'
export type WorkflowStatus = 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled'
export type StepKind = 'simple_reply' | 'planner' | 'task' | 'session_tool'
export type StepDeltaStream = 'text' | 'thinking'
export type SessionKind = 'main' | 'group' | 'channel' | 'thread' | 'cron' | 'hook' | 'node' | 'other'
export type SessionChannel = 'webchat' | 'internal' | 'telegram' | 'discord' | 'whatsapp' | 'unknown'
export type SessionTitleSource = 'route' | 'auto' | 'manual'
export type SessionTitleStatus = 'pending' | 'ready' | 'failed'
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
export type ThinkingProtocol = 'off' | 'qwen' | 'zai' | 'openai_reasoning'

export interface SessionOrigin {
  readonly label?: string
  readonly provider: SessionChannel
  readonly from?: string
  readonly to?: string
  readonly accountId?: string
  readonly threadId?: string
  readonly peerId?: string
  readonly groupId?: string
  readonly channelId?: string
}

export interface SessionStats {
  readonly inputTokens: number
  readonly outputTokens: number
  readonly totalTokens: number
  readonly contextTokens: number
}

export interface SessionRouteContext {
  readonly channel: SessionChannel
  readonly chatType: 'dm' | 'group' | 'channel' | 'thread'
  readonly peerId?: string
  readonly groupId?: string
  readonly channelId?: string
  readonly threadId?: string
  readonly accountId?: string
  readonly senderName?: string
  readonly conversationLabel?: string
}

export interface SessionTextContentBlock {
  readonly type: 'text'
  readonly text: string
  readonly textSignature?: string
}

export interface SessionThinkingContentBlock {
  readonly type: 'thinking'
  readonly thinking: string
  readonly thinkingSignature?: string
}

export interface SessionToolCallContentBlock {
  readonly type: 'toolCall'
  readonly id: string
  readonly name: string
  readonly arguments: Record<string, unknown>
  readonly thoughtSignature?: string
}

export type SessionAssistantContentBlock =
  | SessionTextContentBlock
  | SessionThinkingContentBlock
  | SessionToolCallContentBlock

export type SessionMessageContent = string | SessionAssistantContentBlock[]

export interface SessionMessageRecord {
  readonly role: string
  readonly content: SessionMessageContent
  readonly timestamp?: number
  readonly provider?: string
  readonly model?: string
}

export interface ThinkingConfig {
  readonly enabled: boolean
  readonly level: ThinkingLevel
  readonly protocol: ThinkingProtocol
}

export function createDefaultThinkingConfig(): ThinkingConfig {
  return {
    enabled: false,
    level: 'medium',
    protocol: 'off',
  }
}

export function resolveThinkingLevel(config?: Partial<ThinkingConfig> | null): ThinkingLevel {
  if (!config) return 'off'
  if (!config.enabled) return 'off'
  if (!config.protocol || config.protocol === 'off') return 'off'
  return config.level ?? 'medium'
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

export function normalizeSessionAssistantContent(content: unknown): SessionAssistantContentBlock[] {
  if (typeof content === 'string') {
    return content.length > 0 ? [{ type: 'text', text: content }] : []
  }

  if (!Array.isArray(content)) {
    return []
  }

  const blocks: SessionAssistantContentBlock[] = []

  for (const part of content) {
    if (typeof part === 'string') {
      if (part.length > 0) {
        blocks.push({ type: 'text', text: part })
      }
      continue
    }

    if (!isObject(part)) continue

    if (part.type === 'text' && typeof part.text === 'string') {
      blocks.push({
        type: 'text',
        text: part.text,
        textSignature: typeof part.textSignature === 'string' ? part.textSignature : undefined,
      })
      continue
    }

    if (part.type === 'thinking' && typeof part.thinking === 'string') {
      blocks.push({
        type: 'thinking',
        thinking: part.thinking,
        thinkingSignature: typeof part.thinkingSignature === 'string' ? part.thinkingSignature : undefined,
      })
      continue
    }

    if (part.type === 'toolCall' && typeof part.id === 'string' && typeof part.name === 'string') {
      blocks.push({
        type: 'toolCall',
        id: part.id,
        name: part.name,
        arguments: isObject(part.arguments) ? part.arguments : {},
        thoughtSignature: typeof part.thoughtSignature === 'string' ? part.thoughtSignature : undefined,
      })
      continue
    }

    if (typeof part.text === 'string') {
      blocks.push({ type: 'text', text: part.text })
    }
  }

  return blocks
}

export function extractSessionText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) {
    if (isObject(content) && typeof content.text === 'string') return content.text
    return ''
  }

  return content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!isObject(part)) return ''
      if (part.type === 'text' && typeof part.text === 'string') return part.text
      return typeof part.text === 'string' ? part.text : ''
    })
    .filter(Boolean)
    .join('\n')
}

export function extractSessionThinking(content: unknown): string {
  if (!Array.isArray(content)) {
    if (isObject(content) && typeof content.thinking === 'string') return content.thinking
    return ''
  }

  return content
    .map((part) => {
      if (!isObject(part)) return ''
      return part.type === 'thinking' && typeof part.thinking === 'string'
        ? part.thinking
        : ''
    })
    .filter(Boolean)
    .join('\n')
}

export interface PausePacket {
  readonly pauseId: PauseId
  readonly runId: RunId
  readonly stepId: StepId
  readonly prompt: string
  readonly createdAt: number
  readonly resolvedAt?: number
}

export interface TodoProjection {
  readonly items: SerializedTodoItem[]
  readonly updatedAt: number
}

export interface WorkflowProjection {
  readonly runId: RunId
  readonly mode: SessionMode
  readonly status: WorkflowStatus
  readonly currentStepId?: StepId
  readonly currentStepKind?: StepKind
  readonly todo?: TodoProjection
  readonly pause?: PausePacket
  readonly error?: string
  readonly startedAt: number
  readonly updatedAt: number
  readonly completedAt?: number
}

/** 会话列表/详情的基础元数据 */
export interface SessionEntry {
  readonly key: string
  readonly sessionId: string
  readonly branchId: string
  readonly kind: SessionKind
  readonly channel: SessionChannel
  readonly updatedAt: number
  readonly createdAt: number
  readonly model?: string
  readonly title?: string
  readonly titleSource?: SessionTitleSource
  readonly titleStatus?: SessionTitleStatus
  readonly displayName?: string
  readonly origin?: SessionOrigin
  readonly route?: SessionRouteContext
  readonly deliveryContext?: { channel: SessionChannel; to?: string; accountId?: string }
  readonly stats: SessionStats
  readonly latestPreview?: string
}

export interface SessionProjection extends SessionEntry {
  readonly workflow?: WorkflowProjection
  readonly recentMessages?: SessionMessageRecord[]
}

/**
 * append-only session core 中的消息/控制 entry。
 * 只有 message / custom_message / branch_summary / compaction 参与 buildSessionContext。
 */
export interface SessionHeader {
  readonly type: 'session'
  readonly version: number
  readonly id: string
  readonly timestamp: string
  readonly cwd: string
  readonly parentSession?: string
}

export interface SessionEntryBase {
  readonly type: string
  readonly id: string
  readonly parentId: string | null
  readonly timestamp: string
}

export interface SessionMessageEntry extends SessionEntryBase {
  readonly type: 'message'
  readonly message: SessionMessageRecord
}

export interface ThinkingLevelChangeEntry extends SessionEntryBase {
  readonly type: 'thinking_level_change'
  readonly thinkingLevel: ThinkingLevel
}

export interface ModelChangeEntry extends SessionEntryBase {
  readonly type: 'model_change'
  readonly provider: string
  readonly modelId: string
}

export interface CompactionEntry extends SessionEntryBase {
  readonly type: 'compaction'
  readonly summary: string
  readonly firstKeptEntryId: string
  readonly tokensBefore: number
  readonly details?: unknown
}

export interface BranchSummaryEntry extends SessionEntryBase {
  readonly type: 'branch_summary'
  readonly fromId: string
  readonly summary: string
  readonly details?: unknown
}

export interface CustomMessageEntry extends SessionEntryBase {
  readonly type: 'custom_message'
  readonly customType: string
  readonly content: string | Array<{ type: 'text'; text: string }>
  readonly details?: unknown
  readonly display: boolean
}

export interface CustomEntry extends SessionEntryBase {
  readonly type: 'custom'
  readonly customType: string
  readonly data?: unknown
}

export interface SessionInfoEntry extends SessionEntryBase {
  readonly type: 'session_info'
  readonly name?: string
}

export interface RunStartedEntry extends SessionEntryBase {
  readonly type: 'run_started'
  readonly runId: RunId
  readonly mode: SessionMode
}

export interface RunFinishedEntry extends SessionEntryBase {
  readonly type: 'run_finished'
  readonly runId: RunId
  readonly status: Exclude<WorkflowStatus, 'queued' | 'running'>
  readonly error?: string
}

export interface StepStartedEntry extends SessionEntryBase {
  readonly type: 'step_started'
  readonly runId: RunId
  readonly stepId: StepId
  readonly kind: StepKind
  readonly title?: string
  readonly todoIndex?: number
}

export interface StepFinishedEntry extends SessionEntryBase {
  readonly type: 'step_finished'
  readonly runId: RunId
  readonly stepId: StepId
  readonly kind: StepKind
  readonly status: 'completed' | 'failed'
  readonly summary?: string
  readonly todoIndex?: number
}

export interface TodoUpdatedEntry extends SessionEntryBase {
  readonly type: 'todo_updated'
  readonly runId: RunId
  readonly items: SerializedTodoItem[]
}

export interface PauseRequestedEntry extends SessionEntryBase {
  readonly type: 'pause_requested'
  readonly pause: PausePacket
}

export interface PauseResolvedEntry extends SessionEntryBase {
  readonly type: 'pause_resolved'
  readonly pauseId: PauseId
  readonly runId: RunId
  readonly resolvedAt: number
  readonly input: string
}

export interface SessionToolInvokedEntry extends SessionEntryBase {
  readonly type: 'session_tool_invoked'
  readonly runId: RunId
  readonly stepId: StepId
  readonly toolName: string
  readonly detail?: string
}

export interface SessionToolFinishedEntry extends SessionEntryBase {
  readonly type: 'session_tool_finished'
  readonly runId: RunId
  readonly stepId: StepId
  readonly toolName: string
  readonly status: 'completed' | 'failed'
  readonly detail?: string
}

export type SessionEventEntry =
  | SessionMessageEntry
  | ThinkingLevelChangeEntry
  | ModelChangeEntry
  | CompactionEntry
  | BranchSummaryEntry
  | CustomMessageEntry
  | CustomEntry
  | SessionInfoEntry
  | RunStartedEntry
  | RunFinishedEntry
  | StepStartedEntry
  | StepFinishedEntry
  | TodoUpdatedEntry
  | PauseRequestedEntry
  | PauseResolvedEntry
  | SessionToolInvokedEntry
  | SessionToolFinishedEntry

export type FileEntry = SessionHeader | SessionEventEntry

/** 兼容旧调用方，当前 snapshot 仅作为可丢弃 projection cache 使用。 */
export interface SessionSnapshot {
  readonly sessionId: string
  readonly sessionKey?: string
  readonly branchId: string
  readonly projection: SessionProjection
}

/** WS 连接参数（URL query 携带） */
export interface WsConnectParams {
  readonly sessionId: string
}
