// 中文：本文件（types.ts）位于 backend/src/memory/types.ts，属于backend链路中的memory 记忆链路代码，连接上游调用方与下游执行逻辑。
// English: This file (types.ts) belongs to the backend memory 记忆链路 layer in backend/src/memory/types.ts, wiring upstream callers with downstream runtime logic.

export type MemoryKind = 'profile' | 'episodic' | 'event' | 'foresight'
export type MemoryStatus = 'active' | 'superseded' | 'expired' | 'deleted'
export type MemoryJobType = 'extract_event'
export type MemoryJobStatus = 'pending' | 'running' | 'done' | 'failed'
export type ExtractedEventType =
  | 'user_fact'
  | 'assistant_commitment'
  | 'tool_action'
  | 'decision'
  | 'observation'

export interface EventExtractionInputMessage {
  readonly seq: number
  readonly eventId: string
  readonly role: 'user' | 'assistant'
  readonly text: string
  readonly timestamp: string
}

export interface EventExtractionInput {
  readonly sessionContext: {
    readonly sessionId: string
    readonly sessionKey?: string
    readonly title?: string
    readonly mode: 'simple' | 'plan'
  }
  readonly messages: EventExtractionInputMessage[]
}

export interface ExtractedEventCandidate {
  readonly summary: string
  readonly content: string
  readonly eventType: ExtractedEventType
  readonly tags: string[]
  readonly importance: number
  readonly confidence: number
  readonly occurredAt: string
  readonly sourceEventIds: string[]
}

export interface EventExtractionDiagnostics {
  readonly source: 'llm' | 'heuristic'
  readonly fallbackReason?: string
  readonly llmAttemptCount: number
}

export interface EventExtractionExecution {
  readonly items: MemoryItemInsert[]
  readonly diagnostics: EventExtractionDiagnostics
}

export interface MemoryItemInsert {
  readonly id: string
  readonly kind: MemoryKind
  readonly sessionId?: string
  readonly sessionKey?: string
  readonly summary: string
  readonly content: string
  readonly payloadJson: Record<string, unknown>
  readonly tags: string[]
  readonly importance: number
  readonly confidence: number
  readonly status: MemoryStatus
  readonly sourceEventIds: string[]
  readonly sourceSessionId?: string
  readonly createdAt: string
  readonly updatedAt: string
}

export interface MemoryJobRecord {
  readonly id: string
  readonly jobType: MemoryJobType
  readonly status: MemoryJobStatus
  readonly sessionId: string
  readonly triggerEventSeq: number | null
  readonly payloadJson: Record<string, unknown>
  readonly attemptCount: number
  readonly lastError: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export interface EventExtractionJobPayload {
  readonly sessionKey?: string
  readonly fromEventSeq: number
  readonly maxMessages: number
}

export interface MemoryRecallQuery {
  readonly sessionId: string
  readonly sessionKey: string
  readonly userQuery: string
  readonly mode: 'simple' | 'plan'
  readonly route?: string
  readonly limit?: number
}

export interface MemoryRecallResult {
  readonly id: string
  readonly kind: 'event'
  readonly eventType?: ExtractedEventType
  readonly projectId?: string
  readonly summary: string
  readonly content: string
  readonly tags: string[]
  readonly importance: number
  readonly confidence: number
  readonly occurredAt?: string
  readonly sourceEventIds: string[]
  readonly score: number
}
