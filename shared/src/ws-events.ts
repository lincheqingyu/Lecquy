/**
 * WebSocket 生命周期事件定义
 * 前后端共享，确保事件名和 payload 类型一致
 */

import type {
  ArtifactTraceItem,
  ChatAttachment,
  GeneratedFileArtifact,
  PausePacket,
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
  | 'tool_state'
  | 'session_tool_result'
  | 'session_title_updated'
  | 'ping'
  | 'error'

/** 客户端 -> 服务端 事件类型 */
export type ClientEventType = 'run_start' | 'run_resume' | 'run_cancel' | 'pong'

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
