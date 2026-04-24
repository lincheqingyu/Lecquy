/**
 * WebSocket 生命周期事件定义
 * 前后端共享，确保事件名和 payload 类型一致
 */

import { z } from 'zod'
import type {
  ArtifactTraceItem,
  ChatAttachment,
  GeneratedFileArtifact,
  PausePacket,
  RunId,
  SerializedTodoItem,
  SessionChannel,
  SessionKind,
  SessionMode,
  SessionRouteContext,
  SessionTitleSource,
  StepDeltaStream,
  StepId,
  StepKind,
  ThinkingConfig,
  WorkflowStatus,
} from './session.js'

/** 服务端 -> 客户端 事件类型 */
export type ServerEventType =
  | 'session_bound'
  | 'session_restored'
  | 'run_state'
  | 'step_state'
  | 'step_delta'
  | 'todo_state'
  | 'pause_requested'
  | 'tool_call_start'
  | 'tool_call_delta'
  | 'tool_call_end'
  | 'tool_state'
  | 'server_request'
  | 'server_request_resolved'
  | 'session_tool_result'
  | 'session_title_updated'
  | 'ping'
  | 'error'

/** 客户端 -> 服务端 事件类型 */
export type ClientEventType =
  | 'run_start'
  | 'run_resume'
  | 'run_cancel'
  | 'session_subscribe'
  | 'server_request_response'
  | 'pong'

export const PERMISSION_MODES = [
  'default',
  'dontAsk',
  'plan',
  'acceptEdits',
  'bypassPermissions',
] as const

export type PermissionMode = (typeof PERMISSION_MODES)[number]

export type ServerRequestKind = 'tool_approval'

export type PermissionDecisionOption =
  | 'accept'
  | 'accept_for_session'
  | 'accept_for_project'
  | 'decline'
  | 'cancel'

export interface PermissionRuleSuggestion {
  readonly toolName: string
  readonly content?: string
  readonly description?: string
}

export interface ToolApprovalOperation {
  readonly toolName: string
  readonly args: unknown
  readonly displayCommand?: string
  readonly filePath?: string
  readonly diffPreview?: string
}

export interface ServerRequestPayload {
  readonly sessionKey: string
  readonly sessionId?: string
  readonly runId: RunId
  readonly requestId: string
  readonly itemId: string
  readonly kind: ServerRequestKind
  readonly status: 'pending'
  readonly createdAt: number
  readonly expiresAt: number
  readonly title: string
  readonly description: string
  readonly approval: {
    readonly mode: PermissionMode
    readonly operation: ToolApprovalOperation
    readonly ruleSuggestion?: PermissionRuleSuggestion
    readonly availableDecisions: readonly PermissionDecisionOption[]
  }
}

export interface ServerRequestResponsePayload {
  readonly sessionKey: string
  readonly runId: RunId
  readonly requestId: string
  readonly itemId: string
  readonly decision: PermissionDecisionOption
  readonly rule?: PermissionRuleSuggestion
}

export interface ServerRequestResolvedPayload {
  readonly sessionKey: string
  readonly runId: RunId
  readonly requestId: string
  readonly itemId: string
  readonly kind: ServerRequestKind
  readonly status:
    | 'accepted'
    | 'accepted_for_session'
    | 'accepted_for_project'
    | 'declined'
    | 'cancelled'
    | 'expired'
  readonly resolvedAt: number
  readonly source: 'client' | 'timeout' | 'run_cancel' | 'server'
  readonly message?: string
}

export interface ToolCallErrorDetailPayload {
  readonly code?: string
  readonly ruleContent?: string
  readonly message?: string
}

export type ToolCallErrorDetail = string | ToolCallErrorDetailPayload

const permissionModeSchema = z.enum(PERMISSION_MODES)
const runIdSchema = z.string().min(1, 'runId 不能为空').transform((value) => value as RunId)
const permissionDecisionSchema = z.enum([
  'accept',
  'accept_for_session',
  'accept_for_project',
  'decline',
  'cancel',
])

const permissionRuleSuggestionSchema = z.object({
  toolName: z.string().min(1, 'toolName 不能为空'),
  content: z.string().optional(),
  description: z.string().optional(),
})

const toolApprovalOperationSchema = z.object({
  toolName: z.string().min(1, 'toolName 不能为空'),
  args: z.unknown(),
  displayCommand: z.string().optional(),
  filePath: z.string().optional(),
  diffPreview: z.string().optional(),
})

export const serverRequestSchema = z.object({
  sessionKey: z.string().min(1, 'sessionKey 不能为空'),
  sessionId: z.string().optional(),
  runId: runIdSchema,
  requestId: z.string().min(1, 'requestId 不能为空'),
  itemId: z.string().min(1, 'itemId 不能为空'),
  kind: z.literal('tool_approval'),
  status: z.literal('pending'),
  createdAt: z.number().int(),
  expiresAt: z.number().int(),
  title: z.string().min(1, 'title 不能为空'),
  description: z.string().min(1, 'description 不能为空'),
  approval: z.object({
    mode: permissionModeSchema,
    operation: toolApprovalOperationSchema,
    ruleSuggestion: permissionRuleSuggestionSchema.optional(),
    availableDecisions: z.array(permissionDecisionSchema).min(1, 'availableDecisions 不能为空'),
  }),
})

export const serverRequestResponseSchema = z.object({
  sessionKey: z.string().min(1, 'sessionKey 不能为空'),
  runId: runIdSchema,
  requestId: z.string().min(1, 'requestId 不能为空'),
  itemId: z.string().min(1, 'itemId 不能为空'),
  decision: permissionDecisionSchema,
  rule: permissionRuleSuggestionSchema.optional(),
})

export const serverRequestResolvedSchema = z.object({
  sessionKey: z.string().min(1, 'sessionKey 不能为空'),
  runId: runIdSchema,
  requestId: z.string().min(1, 'requestId 不能为空'),
  itemId: z.string().min(1, 'itemId 不能为空'),
  kind: z.literal('tool_approval'),
  status: z.enum([
    'accepted',
    'accepted_for_session',
    'accepted_for_project',
    'declined',
    'cancelled',
    'expired',
  ]),
  resolvedAt: z.number().int(),
  source: z.enum(['client', 'timeout', 'run_cancel', 'server']),
  message: z.string().optional(),
})

/** `session_subscribe` 仅用于重连后的会话重新绑定。 */
export const sessionSubscribeSchema = z.object({
  sessionKey: z.string().min(1, 'sessionKey 不能为空'),
})

export interface ClientModelOptions {
  readonly model?: string
  readonly baseUrl?: string
  readonly apiKey?: string
  readonly enableTools?: boolean
  readonly thinking?: ThinkingConfig
  readonly options?: {
    readonly temperature?: number
    readonly maxTokens?: number
  }
}

/** 服务端事件 payload 映射 */
export interface ServerEventPayloadMap {
  session_bound: {
    sessionKey: string
    sessionId: string
    kind: SessionKind
    channel: SessionChannel
    created: boolean
  }
  session_restored: {
    sessionKey: string
    sessionId: string
    status?: WorkflowStatus
    runId?: string
    messageCount: number
  }
  run_state: {
    sessionKey: string
    sessionId: string
    runId: string
    mode: SessionMode
    status: WorkflowStatus
    error?: string
  }
  step_state: {
    sessionKey: string
    runId: string
    stepId: StepId
    kind: StepKind
    status: 'started' | 'completed' | 'failed'
    startedAt?: number
    finishedAt?: number
    durationMs?: number
    title?: string
    todoIndex?: number
    summary?: string
  }
  step_delta: {
    sessionKey: string
    runId: string
    stepId: StepId
    kind: StepKind
    stream: StepDeltaStream
    content: string
  }
  todo_state: {
    sessionKey: string
    runId: string
    items: SerializedTodoItem[]
  }
  pause_requested: {
    sessionKey: string
    runId: string
    pause: PausePacket
  }
  tool_call_start: {
    sessionKey: string
    runId: RunId
    stepId: StepId
    toolCallId: string
    toolName: string
    args?: unknown
  }
  tool_call_delta: {
    sessionKey: string
    runId: RunId
    stepId: StepId
    toolCallId: string
    toolName: string
    args: unknown
  }
  tool_call_end:
    | {
        sessionKey: string
        runId: RunId
        stepId: StepId
        toolCallId: string
        toolName: string
        status: 'success'
        result: unknown
        summary?: string
        detail?: string
        generatedArtifacts?: GeneratedFileArtifact[]
        artifactTraceItems?: ArtifactTraceItem[]
      }
    | {
        sessionKey: string
        runId: RunId
        stepId: StepId
        toolCallId: string
        toolName: string
        status: 'error'
        errorMessage: string
        errorDetail?: ToolCallErrorDetail
      }
  tool_state: {
    sessionKey: string
    runId: string
    stepId?: StepId
    toolName: string
    status: 'start' | 'delta' | 'end'
    args?: unknown
    summary?: string
    detail?: string
    isError?: boolean
    generatedArtifacts?: GeneratedFileArtifact[]
    artifactTraceItems?: ArtifactTraceItem[]
  }
  server_request: ServerRequestPayload
  server_request_resolved: ServerRequestResolvedPayload
  session_tool_result: {
    tool: string
    status: string
    runId?: string
    sessionKey?: string
    detail?: string
  }
  session_title_updated: {
    sessionKey: string
    sessionId: string
    title: string
    titleSource: SessionTitleSource
  }
  ping: { timestamp: number }
  error: { message: string; code?: string }
}

/** 客户端事件 payload 映射 */
export interface ClientEventPayloadMap {
  run_start: ClientModelOptions & {
    mode: SessionMode
    route: SessionRouteContext
    input: string
    attachments?: ChatAttachment[]
    systemPrompt?: string
    sessionKey?: string
  }
  run_resume: ClientModelOptions & {
    sessionKey: string
    runId: string
    pauseId: string
    input: string
    attachments?: ChatAttachment[]
    systemPrompt?: string
  }
  run_cancel: {
    sessionKey: string
    runId?: string
  }
  session_subscribe: {
    sessionKey: string
  }
  server_request_response: ServerRequestResponsePayload
  pong: { timestamp: number }
}

/** 服务端发送的事件 */
export interface ServerEvent<T extends ServerEventType = ServerEventType> {
  readonly event: T
  readonly payload: ServerEventPayloadMap[T]
}

/** 客户端发送的事件 */
export interface ClientEvent<T extends ClientEventType = ClientEventType> {
  readonly event: T
  readonly payload: ClientEventPayloadMap[T]
}
