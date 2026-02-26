import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

export type ChatMode = 'simple' | 'thinking'

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
}

interface UseChatOptions {
  systemPrompt: string
  modelConfig: ModelConfig
}

const API_BASE = 'http://localhost:5000'
const WS_BASE = 'ws://localhost:5000'

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function appendMessage(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  msg: ChatMessage,
) {
  setMessages((prev) => [...prev, msg])
}

export function useChat({ systemPrompt, modelConfig }: UseChatOptions) {
  const [mode, setMode] = useState<ChatMode>('simple')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [isWaiting, setIsWaiting] = useState(false)
  const wsRef = useRef<WebSocket | null>(null)
  const pendingSendRef = useRef<string | null>(null)

  const updateMessageContent = useCallback((id: string, delta: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === id ? { ...m, content: m.content + delta } : m)),
    )
  }, [])

  const ensureWebSocket = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return wsRef.current

    const ws = new WebSocket(`${WS_BASE}/api/v1/chat/ws`)
    wsRef.current = ws

    ws.onopen = () => {
      if (pendingSendRef.current) {
        ws.send(pendingSendRef.current)
        pendingSendRef.current = null
      }
    }

    ws.onclose = () => {
      wsRef.current = null
    }

    ws.onerror = () => {
      appendMessage(setMessages, {
        id: createId('system'),
        role: 'system',
        content: 'WebSocket 连接失败',
        timestamp: Date.now(),
      })
      wsRef.current = null
    }

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data as string)
        const eventType = payload.event as string

        if (eventType === 'message_delta') {
          const last = messagesRef.current.lastAssistantId
          if (last) {
            updateMessageContent(last, payload.content ?? '')
          }
          return
        }

        if (eventType === 'message_end') {
          setIsStreaming(false)
          return
        }

        if (eventType === 'need_user_input' || eventType === 'waiting') {
          setIsWaiting(true)
        }

        if (eventType === 'done') {
          setIsStreaming(false)
          setIsWaiting(false)
          return
        }

        if (eventType === 'error') {
          appendMessage(setMessages, {
            id: createId('system'),
            role: 'system',
            content: payload.message ?? '发生错误',
            timestamp: Date.now(),
          })
          setIsStreaming(false)
          setIsWaiting(false)
          return
        }

        const content =
          payload.content ??
          payload.result ??
          payload.prompt ??
          JSON.stringify(payload, null, 2)

        appendMessage(setMessages, {
          id: createId('event'),
          role: 'event',
          content,
          timestamp: Date.now(),
          eventType,
        })
      } catch {
        appendMessage(setMessages, {
          id: createId('system'),
          role: 'system',
          content: '无法解析 WS 消息',
          timestamp: Date.now(),
        })
      }
    }

    return ws
  }, [updateMessageContent])

  const messagesRef = useRef<{ lastAssistantId: string | null }>({
    lastAssistantId: null,
  })

  const buildMessages = useCallback(
    (text: string) => {
      const result: Array<{ role: 'system' | 'user'; content: string }> = []
      if (systemPrompt.trim()) {
        result.push({ role: 'system', content: systemPrompt.trim() })
      }
      result.push({ role: 'user', content: text })
      return result
    },
    [systemPrompt],
  )

  const sendSimple = useCallback(async (text: string) => {
    const userId = createId('user')
    appendMessage(setMessages, {
      id: userId,
      role: 'user',
      content: text,
      timestamp: Date.now(),
    })

    const assistantId = createId('assistant')
    messagesRef.current.lastAssistantId = assistantId
    appendMessage(setMessages, {
      id: assistantId,
      role: 'assistant',
      content: '',
      timestamp: Date.now(),
    })

    setIsStreaming(true)

    const response = await fetch(`${API_BASE}/api/v1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'simple',
        stream: true,
        model: modelConfig.model,
        baseUrl: modelConfig.baseUrl,
        apiKey: modelConfig.apiKey,
        options: {
          temperature: modelConfig.temperature,
          maxTokens: modelConfig.maxTokens,
        },
        messages: buildMessages(text),
      }),
    })

    if (!response.ok || !response.body) {
      appendMessage(setMessages, {
        id: createId('system'),
        role: 'system',
        content: '请求失败',
        timestamp: Date.now(),
      })
      setIsStreaming(false)
      return
    }

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''

      for (const eventText of events) {
        const lines = eventText.split('\n')
        const eventType = lines
          .find((l) => l.startsWith('event:'))
          ?.slice(6)
          .trim()
        const dataLine = lines.find((l) => l.startsWith('data:'))
        if (!dataLine) continue
        const data = JSON.parse(dataLine.slice(5).trim())

        if (eventType === 'message') {
          updateMessageContent(assistantId, data.content ?? '')
        } else if (eventType === 'done') {
          setIsStreaming(false)
        }
      }
    }
  }, [buildMessages, modelConfig.maxTokens, modelConfig.model, modelConfig.temperature, updateMessageContent])

  const sendThinking = useCallback(
    (text: string) => {
      const userId = createId('user')
      appendMessage(setMessages, {
        id: userId,
        role: 'user',
        content: text,
        timestamp: Date.now(),
      })

      const assistantId = createId('assistant')
      messagesRef.current.lastAssistantId = assistantId
      appendMessage(setMessages, {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
      })

      setIsStreaming(true)
      setIsWaiting(false)

      const payload = JSON.stringify({
        mode: 'thinking',
        stream: true,
        model: modelConfig.model,
        baseUrl: modelConfig.baseUrl,
        apiKey: modelConfig.apiKey,
        options: {
          temperature: modelConfig.temperature,
          maxTokens: modelConfig.maxTokens,
        },
        messages: buildMessages(text),
      })

      const ws = ensureWebSocket()
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload)
      } else {
        pendingSendRef.current = payload
      }
    },
    [buildMessages, ensureWebSocket, modelConfig.maxTokens, modelConfig.model, modelConfig.temperature],
  )

  const send = useCallback(
    (text: string) => {
      if (!text.trim()) return
      if (mode === 'simple') {
        void sendSimple(text)
      } else {
        sendThinking(text)
      }
    },
    [mode, sendSimple, sendThinking],
  )

  useEffect(() => {
    if (mode === 'simple' && wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }
  }, [mode])

  return {
    mode,
    setMode,
    messages,
    send,
    isStreaming,
    isWaiting,
  }
}
