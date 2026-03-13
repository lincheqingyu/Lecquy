import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
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
  timestamp: number
  eventType?: string
}

export interface ModelConfig {
  model: string
  temperature: number
  maxTokens: number
  baseUrl: string
  apiKey: string
  enableTools: boolean
}

export interface SessionResolvedPayload {
  sessionKey: string
  sessionId: string
  kind: string
  channel: string
}

interface WsEventPayloadMap {
  session_key_resolved: SessionResolvedPayload
  session_restored: { sessionId: string; messageCount: number }
  need_user_input: { prompt: string }
  done: Record<string, never>
  error: { message?: string; code?: string }
}

interface UseChatOptions {
  systemPrompt: string
  modelConfig: ModelConfig
  peerId?: string
  onWsEvent?: <T extends keyof WsEventPayloadMap>(event: T, payload: WsEventPayloadMap[T]) => void
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

function removeMessages(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  ids: string[],
) {
  setMessages((prev) => prev.filter((msg) => !ids.includes(msg.id)))
}

function isSessionBusyError(eventPayload: Record<string, unknown>): boolean {
  const code = typeof eventPayload.code === 'string' ? eventPayload.code : ''
  const message = typeof eventPayload.message === 'string' ? eventPayload.message : ''
  return code === 'SESSION_BUSY' || message.includes('当前会话正在运行')
}

/** 处理 WS 消息的纯函数 */
function handleWsEvent(
  payload: Record<string, unknown>,
  lastAssistantIdRef: { current: string | null },
  lastWorkerIdRef: { current: string | null },
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  updateContent: (id: string, delta: string) => void,
  setIsStreaming: Dispatch<SetStateAction<boolean>>,
  setIsWaiting: Dispatch<SetStateAction<boolean>>,
  clearPendingOptimisticMessage: () => void,
  onWsEvent?: <T extends keyof WsEventPayloadMap>(event: T, payload: WsEventPayloadMap[T]) => void,
): void {
  const eventType = payload.event as string
  const eventPayload = (payload.payload as Record<string, unknown>) ?? {}

  if (eventType === 'message_delta') {
    const last = lastAssistantIdRef.current
    if (last) {
      updateContent(last, (eventPayload.content as string) ?? '')
    }
    return
  }

  if (eventType === 'worker_delta') {
    const last = lastWorkerIdRef.current
    if (last) {
      updateContent(last, (eventPayload.content as string) ?? '')
    }
    return
  }

  if (eventType === 'message_end') {
    setIsStreaming(false)
    return
  }

  if (eventType === 'need_user_input') {
    setIsWaiting(true)
    onWsEvent?.('need_user_input', {
      prompt: (eventPayload.prompt as string) ?? '需要补充信息',
    })
    appendMessage(setMessages, {
      id: createId('event'),
      role: 'event',
      content: (eventPayload.prompt as string) ?? '需要补充信息',
      timestamp: Date.now(),
      eventType,
    })
    return
  }

  if (eventType === 'done') {
    setIsStreaming(false)
    setIsWaiting(false)
    onWsEvent?.('done', {})
    return
  }

  if (eventType === 'session_restored') {
    // 会话恢复属于后台状态，避免污染对话 UI
    onWsEvent?.('session_restored', {
      sessionId: (eventPayload.sessionId as string) ?? '',
      messageCount: Number(eventPayload.messageCount ?? 0),
    })
    return
  }

  if (eventType === 'session_key_resolved') {
    // 路由解析是内部事件，不在消息流展示
    onWsEvent?.('session_key_resolved', {
      sessionKey: (eventPayload.sessionKey as string) ?? '',
      sessionId: (eventPayload.sessionId as string) ?? '',
      kind: (eventPayload.kind as string) ?? '',
      channel: (eventPayload.channel as string) ?? '',
    })
    return
  }

  if (eventType === 'session_tool_result') {
    appendMessage(setMessages, {
      id: createId('event'),
      role: 'event',
      content: JSON.stringify(eventPayload, null, 2),
      timestamp: Date.now(),
      eventType,
    })
    return
  }

  if (eventType === 'error') {
    if (isSessionBusyError(eventPayload)) {
      clearPendingOptimisticMessage()
    }
    onWsEvent?.('error', {
      message: (eventPayload.message as string) ?? '发生错误',
      code: (eventPayload.code as string) ?? undefined,
    })
    appendMessage(setMessages, {
      id: createId('system'),
      role: 'system',
      content: (eventPayload.message as string) ?? '发生错误',
      timestamp: Date.now(),
    })
    setIsStreaming(false)
    setIsWaiting(false)
    return
  }

  if (eventType === 'worker_start') {
    const id = createId('worker')
    lastWorkerIdRef.current = id
    const content = `Worker #${eventPayload.todoIndex ?? ''}: ${eventPayload.content ?? ''}`
    appendMessage(setMessages, {
      id,
      role: 'event',
      content,
      timestamp: Date.now(),
      eventType,
    })
    return
  }

  if (eventType === 'worker_end') {
    lastWorkerIdRef.current = null
  }

  // 其他事件（todo_write, subagent_start 等）
  const content =
    (eventPayload.content as string) ??
    (eventPayload.result as string) ??
    (eventPayload.prompt as string) ??
    JSON.stringify(eventPayload, null, 2)

  appendMessage(setMessages, {
    id: createId('event'),
    role: 'event',
    content,
    timestamp: Date.now(),
    eventType,
  })
}

export function useChat({ systemPrompt, modelConfig, peerId, onWsEvent }: UseChatOptions) {
  const [mode, setMode] = useState<ChatMode>('simple')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [isWaiting, setIsWaiting] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')
  const [currentSessionKey, setCurrentSessionKey] = useState<string | null>(null)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)

  const reconnectWsRef = useRef<ReconnectableWs | null>(null)
  const lastAssistantIdRef = useRef<string | null>(null)
  const lastWorkerIdRef = useRef<string | null>(null)
  const pendingOptimisticMessageIdsRef = useRef<{ userId: string; assistantId: string } | null>(null)

  const updateMessageContent = useCallback((id: string, delta: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content: m.content + delta } : m)),
    )
  }, [])

  const replaceMessages = useCallback((nextMessages: ChatMessage[]) => {
    lastAssistantIdRef.current = null
    lastWorkerIdRef.current = null
    setMessages(nextMessages)
    setIsStreaming(false)
    setIsWaiting(false)
  }, [])

  const clearMessages = useCallback(() => {
    replaceMessages([])
  }, [replaceMessages])

  const clearPendingOptimisticMessage = useCallback(() => {
    const pending = pendingOptimisticMessageIdsRef.current
    if (!pending) return

    removeMessages(setMessages, [pending.userId, pending.assistantId])
    if (lastAssistantIdRef.current === pending.assistantId) {
      lastAssistantIdRef.current = null
    }
    pendingOptimisticMessageIdsRef.current = null
  }, [])

  /** 获取或创建 ReconnectableWs */
  const ensureWs = useCallback(() => {
    if (reconnectWsRef.current) return reconnectWsRef.current

    const url = `${WS_BASE}/api/v1/chat/ws`

    const rws = new ReconnectableWs({
      url,
      onMessage: (data) => {
        try {
          const payload = JSON.parse(data) as Record<string, unknown>
          handleWsEvent(
            payload,
            lastAssistantIdRef,
            lastWorkerIdRef,
            setMessages,
            updateMessageContent,
            setIsStreaming,
            setIsWaiting,
            clearPendingOptimisticMessage,
            (event, eventPayload) => {
              if (event === 'session_key_resolved') {
                const resolved = eventPayload as SessionResolvedPayload
                setCurrentSessionKey(resolved.sessionKey)
                setCurrentSessionId(resolved.sessionId)
              }
              onWsEvent?.(event, eventPayload)
            },
          )
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

    reconnectWsRef.current = rws
    return rws
  }, [clearPendingOptimisticMessage, onWsEvent, updateMessageContent, setMessages, setIsStreaming, setIsWaiting, setConnectionStatus])

  const buildMessages = useCallback(
    (text: string) => {
      const result: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = []
      if (systemPrompt.trim()) {
        result.push({ role: 'system', content: systemPrompt.trim() })
      }
      const history = messages
        .filter(
          (m) =>
            (m.role === 'user' || m.role === 'assistant') &&
            m.content.trim().length > 0,
        )
        .map((m) => ({
          role: m.role,
          content: m.content,
        })) as Array<{ role: 'user' | 'assistant'; content: string }>

      result.push(...history)
      result.push({ role: 'user', content: text })
      return result
    },
    [messages, systemPrompt],
  )

  const sendWs = useCallback(
    (text: string) => {
      const userId = createId('user')
      appendMessage(setMessages, {
        id: userId,
        role: 'user',
        content: text,
        timestamp: Date.now(),
      })

      const assistantId = createId('assistant')
      lastAssistantIdRef.current = assistantId
      lastWorkerIdRef.current = null
      appendMessage(setMessages, {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      })
      pendingOptimisticMessageIdsRef.current = {
        userId,
        assistantId,
      }

      setIsStreaming(true)
      setIsWaiting(false)

      const payload = JSON.stringify({
        event: 'chat',
        payload: {
          route: buildDefaultRoute({ peerId: peerId ?? getPeerId() }),
          mode,
          model: modelConfig.model,
          baseUrl: modelConfig.baseUrl || undefined,
          apiKey: modelConfig.apiKey || undefined,
          enableTools: modelConfig.enableTools,
          options: {
            temperature: modelConfig.temperature,
            maxTokens: modelConfig.maxTokens,
          },
          messages: buildMessages(text),
        },
      })

      const rws = ensureWs()
      rws.send(payload)
    },
    [buildMessages, ensureWs, mode, modelConfig.apiKey, modelConfig.baseUrl, modelConfig.enableTools, modelConfig.maxTokens, modelConfig.model, modelConfig.temperature, peerId],
  )

  const send = useCallback(
    (text: string) => {
      if (!text.trim()) return false
      if (isStreaming) return false
      if (isWaiting && mode !== 'plan') return false
      sendWs(text)
      return true
    },
    [isStreaming, isWaiting, mode, sendWs],
  )

  const stop = useCallback(() => {
    const rws = ensureWs()
    rws.send(JSON.stringify({
      event: 'cancel',
      payload: {},
    }))
  }, [ensureWs])

  // 组件卸载时清理
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
    send,
    stop,
    isStreaming,
    isWaiting,
    connectionStatus,
    currentSessionKey,
    currentSessionId,
  }
}
