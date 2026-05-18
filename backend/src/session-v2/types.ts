// 中文：本文件（types.ts）位于 backend/src/session-v2/types.ts，属于backend链路中的会话服务代码，连接上游调用方与下游执行逻辑。
// English: This file (types.ts) belongs to the backend 会话服务 layer in backend/src/session-v2/types.ts, wiring upstream callers with downstream runtime logic.

import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { AssistantMessage, UserMessage } from '@mariozechner/pi-ai'
import type { SessionChannel, SessionEntry, SessionKind, SessionRouteContext, SessionSnapshot } from '@lecquy/shared'
import { createSessionId, type SessionId } from '@lecquy/shared'
import { createTodoManager, type TodoManager } from '../core/todo/todo-manager.js'

export type Mode = 'simple' | 'plan'

export interface SessionRuntimeState {
  readonly sessionId: SessionId
  readonly sessionKey: string
  mode: Mode
  contextMessages: AgentMessage[]
  isRunning: boolean
  isWaiting: boolean
  resumeHint?: string
  waitingTodoIndex?: number
  abortController?: AbortController
  todoManager: TodoManager
  memoryTurnCounter: number
  lastActiveAt: number
  createdAt: number
  lastAnthropicCallAt?: number
}

export interface SessionKeyResolved {
  key: string
  kind: SessionKind
  channel: SessionChannel
}

export interface SessionStoreShape {
  entries: Record<string, SessionEntry>
}

export interface SessionPruningConfig {
  mode: 'off' | 'cache-ttl'
  ttlMs: number
  keepLastAssistants: number
  softTrimRatio: number
  hardClearRatio: number
  minPrunableToolChars: number
}

export function createRuntimeState(sessionKey: string, sessionId?: SessionId): SessionRuntimeState {
  const now = Date.now()
  return {
    sessionId: sessionId ?? createSessionId(),
    sessionKey,
    mode: 'simple',
    contextMessages: [],
    isRunning: false,
    isWaiting: false,
    todoManager: createTodoManager(),
    memoryTurnCounter: 0,
    lastActiveAt: now,
    createdAt: now,
  }
}

export function serializeRuntimeState(state: SessionRuntimeState): SessionSnapshot {
  return {
    sessionId: state.sessionId,
    sessionKey: state.sessionKey,
    mode: state.mode,
    contextMessages: state.contextMessages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      timestamp: m.timestamp,
    })),
    todoItems: state.todoManager.getItems().map((item) => ({
      content: item.content,
      status: item.status,
      activeForm: item.activeForm,
      result: item.result,
      errorMessage: item.errorMessage,
    })),
    memoryTurnCounter: state.memoryTurnCounter,
    createdAt: state.createdAt,
    lastActiveAt: state.lastActiveAt,
    lastAnthropicCallAt: state.lastAnthropicCallAt,
  }
}

export function restoreRuntimeState(snapshot: SessionSnapshot, sessionKey: string): SessionRuntimeState {
  const state = createRuntimeState(sessionKey, snapshot.sessionId as SessionId)
  state.mode = snapshot.mode ?? 'simple'
  state.contextMessages = (snapshot.contextMessages ?? [])
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m): AgentMessage => {
      const ts = m.timestamp ?? Date.now()
      if (m.role === 'user') {
        return { role: 'user', content: m.content, timestamp: ts } satisfies UserMessage
      }
      return {
        role: 'assistant',
        content: [{ type: 'text', text: m.content }],
        api: 'openai-completions',
        provider: 'unknown',
        model: 'unknown',
        usage: {
          input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: ts,
      } satisfies AssistantMessage
    })
  state.memoryTurnCounter = snapshot.memoryTurnCounter ?? 0
  state.createdAt = snapshot.createdAt ?? Date.now()
  state.lastActiveAt = snapshot.lastActiveAt ?? Date.now()
  state.lastAnthropicCallAt = snapshot.lastAnthropicCallAt
  state.todoManager.loadItems((snapshot.todoItems ?? []).map((x) => ({ ...x })))
  return state
}

export interface ActiveSession {
  state: SessionRuntimeState
  entry: SessionEntry
  restored: boolean
}

export interface SessionRouteEnvelope extends SessionRouteContext {
  from?: string
  to?: string
}
