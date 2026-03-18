import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ClientEventPayloadMap, ServerEventPayloadMap, StepKind, ThinkingConfig } from '@webclaw/shared'
import { WS_BASE } from '../config/api.ts'
import { getPeerId } from '../lib/session.ts'
import { buildDefaultRoute } from '../lib/session-route.ts'
import { ReconnectableWs, type ConnectionStatus } from '../lib/ws-reconnect.ts'

export type ChatMode = 'simple' | 'plan'
export type MessageRole = 'user' | 'assistant' | 'system' | 'event'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  thinkingContent?: string
  hasThinking?: boolean
  isThinkingExpanded?: boolean
  timestamp: number
  eventType?: string
  stepId?: string
}

export interface ModelConfig {
  model: string
  temperature: number
  maxTokens: number
  baseUrl: string
  apiKey: string
  enableTools: boolean
  thinking: ThinkingConfig
}

export type SessionResolvedPayload = ServerEventPayloadMap['session_bound']
export type SessionTitleUpdatedPayload = ServerEventPayloadMap['session_title_updated']

interface UseChatOptions {
  systemPrompt: string
  modelConfig: ModelConfig
  peerId?: string
  currentSessionKey?: string | null
  onWsEvent?: <T extends keyof ServerEventPayloadMap>(event: T, payload: ServerEventPayloadMap[T]) => void
}

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function appendMessage(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  msg: ChatMessage,
) {
  setMessages((prev) => [...prev, msg])
}

function updateMessage(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  id: string,
  updater: (message: ChatMessage) => ChatMessage,
) {
  setMessages((prev) => prev.map((message) => (message.id === id ? updater(message) : message)))
}

function stepTitle(kind: StepKind, title?: string, todoIndex?: number): string {
  if (title?.trim()) return title.trim()
  if (kind === 'planner') return '正在生成计划'
  if (kind === 'task') return `任务 ${typeof todoIndex === 'number' ? todoIndex + 1 : ''}`.trim()
  if (kind === 'session_tool') return '正在执行会话工具'
  return '正在生成回复'
}

function renderTodo(items: ServerEventPayloadMap['todo_state']['items']): string {
  if (items.length === 0) return '当前没有任务。'
  return items
    .map((item) => {
      const mark =
        item.status === 'completed' ? '[x]' :
        item.status === 'in_progress' ? '[>]' : '[ ]'
      return `${mark} ${item.content}`
    })
    .join('\n')
}

export function useChat({ systemPrompt, modelConfig, peerId, currentSessionKey, onWsEvent }: UseChatOptions) {
  const [mode, setMode] = useState<ChatMode>('simple')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [isWaiting, setIsWaiting] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')
  const [boundSessionKey, setBoundSessionKey] = useState<string | null>(currentSessionKey ?? null)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)

  const reconnectWsRef = useRef<ReconnectableWs | null>(null)
  const currentRunIdRef = useRef<string | null>(null)
  const currentPauseIdRef = useRef<string | null>(null)
  const stepMessageIdsRef = useRef<Map<string, string>>(new Map())
  const todoMessageIdRef = useRef<string | null>(null)
  const pendingUserIdRef = useRef<string | null>(null)

  useEffect(() => {
    setBoundSessionKey(currentSessionKey ?? null)
  }, [currentSessionKey])

  const clearDerivedState = useCallback(() => {
    currentRunIdRef.current = null
    currentPauseIdRef.current = null
    stepMessageIdsRef.current.clear()
    todoMessageIdRef.current = null
    pendingUserIdRef.current = null
    setIsStreaming(false)
    setIsWaiting(false)
  }, [])

  const replaceMessages = useCallback((nextMessages: ChatMessage[]) => {
    clearDerivedState()
    setMessages(nextMessages)
  }, [clearDerivedState])

  const clearMessages = useCallback(() => {
    replaceMessages([])
  }, [replaceMessages])

  const toggleThinking = useCallback((id: string) => {
    updateMessage(setMessages, id, (message) => ({
      ...message,
      isThinkingExpanded: !message.isThinkingExpanded,
    }))
  }, [])

  const ensureStepMessage = useCallback((stepId: string, kind: StepKind, title?: string, todoIndex?: number) => {
    const existing = stepMessageIdsRef.current.get(stepId)
    if (existing) return existing

    const id = createId(kind === 'simple_reply' ? 'assistant' : 'event')
    stepMessageIdsRef.current.set(stepId, id)
    appendMessage(setMessages, {
      id,
      role: kind === 'simple_reply' ? 'assistant' : 'event',
      content: kind === 'simple_reply' ? '' : stepTitle(kind, title, todoIndex),
      thinkingContent: '',
      hasThinking: false,
      isThinkingExpanded: false,
      timestamp: Date.now(),
      eventType: 'step',
      stepId,
    })
    return id
  }, [])

  const ensureWs = useCallback(() => {
    if (reconnectWsRef.current) return reconnectWsRef.current

    const ws = new ReconnectableWs({
      url: `${WS_BASE}/api/v1/chat/ws`,
      onMessage: (data) => {
        try {
          const parsed = JSON.parse(data) as { event?: keyof ServerEventPayloadMap; payload?: Record<string, unknown> }
          const event = parsed.event
          if (!event) return
          const payload = (parsed.payload ?? {}) as ServerEventPayloadMap[keyof ServerEventPayloadMap]

          if (event === 'session_bound') {
            const bound = payload as ServerEventPayloadMap['session_bound']
            setBoundSessionKey(bound.sessionKey)
            setCurrentSessionId(bound.sessionId)
            onWsEvent?.(event, bound)
            return
          }

          if (event === 'session_restored') {
            onWsEvent?.(event, payload as ServerEventPayloadMap['session_restored'])
            return
          }

          if (event === 'session_title_updated') {
            onWsEvent?.(event, payload as ServerEventPayloadMap['session_title_updated'])
            return
          }

          if (event === 'run_state') {
            const run = payload as ServerEventPayloadMap['run_state']
            currentRunIdRef.current = run.runId
            setIsStreaming(run.status === 'running')
            setIsWaiting(run.status === 'paused')
            if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
              currentPauseIdRef.current = null
              pendingUserIdRef.current = null
            }
            if (run.status === 'failed' && run.error) {
              appendMessage(setMessages, {
                id: createId('system'),
                role: 'system',
                content: run.error,
                timestamp: Date.now(),
              })
            }
            onWsEvent?.(event, run)
            return
          }

          if (event === 'step_state') {
            const step = payload as ServerEventPayloadMap['step_state']
            const messageId = ensureStepMessage(step.stepId, step.kind, step.title, step.todoIndex)
            if (step.summary && step.status === 'completed') {
              const summary = step.summary
              updateMessage(setMessages, messageId, (message) => ({
                ...message,
                content: summary,
              }))
            }
            onWsEvent?.(event, step)
            return
          }

          if (event === 'step_delta') {
            const delta = payload as ServerEventPayloadMap['step_delta']
            const messageId = ensureStepMessage(delta.stepId, delta.kind)
            const stream = delta.stream ?? 'text'
            updateMessage(setMessages, messageId, (message) => {
              if (stream === 'thinking') {
                return {
                  ...message,
                  hasThinking: true,
                  thinkingContent: (message.thinkingContent ?? '') + delta.content,
                }
              }

              return {
                ...message,
                content: message.content + delta.content,
              }
            })
            return
          }

          if (event === 'todo_state') {
            const todo = payload as ServerEventPayloadMap['todo_state']
            if (!todoMessageIdRef.current) {
              todoMessageIdRef.current = createId('todo')
              appendMessage(setMessages, {
                id: todoMessageIdRef.current,
                role: 'event',
                content: renderTodo(todo.items),
                timestamp: Date.now(),
                eventType: 'todo',
              })
            } else {
              updateMessage(setMessages, todoMessageIdRef.current, (message) => ({
                ...message,
                content: renderTodo(todo.items),
              }))
            }
            onWsEvent?.(event, todo)
            return
          }

          if (event === 'pause_requested') {
            const pause = payload as ServerEventPayloadMap['pause_requested']
            currentPauseIdRef.current = pause.pause.pauseId
            setIsStreaming(false)
            setIsWaiting(true)
            appendMessage(setMessages, {
              id: createId('pause'),
              role: 'event',
              content: pause.pause.prompt,
              timestamp: Date.now(),
              eventType: 'pause',
            })
            onWsEvent?.(event, pause)
            return
          }

          if (event === 'tool_state') {
            return
          }

          if (event === 'session_tool_result') {
            const toolResult = payload as ServerEventPayloadMap['session_tool_result']
            appendMessage(setMessages, {
              id: createId('event'),
              role: 'event',
              content: toolResult.detail ?? JSON.stringify(toolResult, null, 2),
              timestamp: Date.now(),
              eventType: 'session_tool_result',
            })
            onWsEvent?.(event, toolResult)
            return
          }

          if (event === 'error') {
            const error = payload as ServerEventPayloadMap['error']
            appendMessage(setMessages, {
              id: createId('system'),
              role: 'system',
              content: error.message,
              timestamp: Date.now(),
            })
            setIsStreaming(false)
            onWsEvent?.(event, error)
          }
        } catch {
          appendMessage(setMessages, {
            id: createId('system'),
            role: 'system',
            content: '无法解析 WS 消息',
            timestamp: Date.now(),
          })
        }
      },
      onStatusChange: (status) => {
        setConnectionStatus(status)
        if (status === 'disconnected') {
          appendMessage(setMessages, {
            id: createId('system'),
            role: 'system',
            content: 'WebSocket 连接已断开',
            timestamp: Date.now(),
          })
        }
      },
    })

    reconnectWsRef.current = ws
    return ws
  }, [WS_BASE, ensureStepMessage, onWsEvent])

  const buildModelOptions = useCallback(() => ({
    model: modelConfig.model,
    baseUrl: modelConfig.baseUrl || undefined,
    apiKey: modelConfig.apiKey || undefined,
    enableTools: modelConfig.enableTools,
    thinking: modelConfig.thinking,
    systemPrompt: systemPrompt.trim() || undefined,
    options: {
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.maxTokens,
    },
  }), [modelConfig, systemPrompt])

  const send = useCallback((text: string) => {
    const input = text.trim()
    if (!input) return false
    if (isStreaming) return false
    if (isWaiting && mode !== 'plan') return false

    const ws = ensureWs()
    const userId = createId('user')
    pendingUserIdRef.current = userId
    appendMessage(setMessages, {
      id: userId,
      role: 'user',
      content: input,
      timestamp: Date.now(),
    })

    stepMessageIdsRef.current.clear()
    todoMessageIdRef.current = null
    setIsStreaming(true)
    setIsWaiting(false)

    if (isWaiting && mode === 'plan' && boundSessionKey && currentRunIdRef.current && currentPauseIdRef.current) {
      const payload: ClientEventPayloadMap['run_resume'] = {
        sessionKey: boundSessionKey,
        runId: currentRunIdRef.current,
        pauseId: currentPauseIdRef.current,
        input,
        ...buildModelOptions(),
      }
      ws.send(JSON.stringify({ event: 'run_resume', payload }))
      return true
    }

    const payload: ClientEventPayloadMap['run_start'] = {
      route: buildDefaultRoute({ peerId: peerId ?? getPeerId() }),
      mode,
      input,
      sessionKey: boundSessionKey ?? undefined,
      ...buildModelOptions(),
    }
    ws.send(JSON.stringify({ event: 'run_start', payload }))
    return true
  }, [boundSessionKey, buildModelOptions, ensureWs, isStreaming, isWaiting, mode, peerId])

  const stop = useCallback(() => {
    if (!boundSessionKey) return
    const ws = ensureWs()
    const payload: ClientEventPayloadMap['run_cancel'] = {
      sessionKey: boundSessionKey,
      runId: currentRunIdRef.current ?? undefined,
    }
    ws.send(JSON.stringify({ event: 'run_cancel', payload }))
  }, [boundSessionKey, ensureWs])

  useEffect(() => {
    return () => {
      reconnectWsRef.current?.close()
      reconnectWsRef.current = null
    }
  }, [])

  return {
    mode,
    setMode,
    messages,
    replaceMessages,
    clearMessages,
    toggleThinking,
    send,
    stop,
    isStreaming,
    isWaiting,
    connectionStatus,
    currentSessionKey: boundSessionKey,
    currentSessionId,
  }
}
