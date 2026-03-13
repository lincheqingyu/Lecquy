import type { ChatMessage } from '../hooks/useChat'

export interface SessionMessageRecord {
  role: string
  content: unknown
  timestamp?: number
}

export interface SessionListEntry {
  key: string
  sessionId: string
  kind: string
  channel: string
  updatedAt: number
  createdAt: number
  displayName?: string
  messages?: SessionMessageRecord[]
}

export interface SessionListItemVm {
  id: string
  title: string
  preview: string
  updatedAt: number
  createdAt: number
  sessionId: string
  channel: string
}

export function extractMessageText(content: unknown): string {
  if (typeof content === 'string') return content

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (!part || typeof part !== 'object') return ''
        const candidate = part as { type?: string; text?: unknown }
        return candidate.type === 'text' && typeof candidate.text === 'string'
          ? candidate.text
          : ''
      })
      .filter(Boolean)
      .join('\n')
  }

  if (content && typeof content === 'object') {
    const candidate = content as { text?: unknown }
    if (typeof candidate.text === 'string') return candidate.text
  }

  return ''
}

function normalizePreview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return '暂无消息'
  return normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized
}

export function toSessionListItemVm(entry: SessionListEntry): SessionListItemVm {
  const latest = entry.messages?.[entry.messages.length - 1]
  const latestText = latest ? extractMessageText(latest.content) : ''

  return {
    id: entry.key,
    title: entry.displayName?.trim() || '未命名会话',
    preview: normalizePreview(latestText),
    updatedAt: entry.updatedAt,
    createdAt: entry.createdAt,
    sessionId: entry.sessionId,
    channel: entry.channel,
  }
}

export function toChatMessages(records: SessionMessageRecord[]): ChatMessage[] {
  return records
    .filter((record) => record.role === 'user' || record.role === 'assistant')
    .map((record, index) => ({
      id: `history_${record.role}_${record.timestamp ?? Date.now()}_${index}`,
      role: record.role as ChatMessage['role'],
      content: extractMessageText(record.content),
      timestamp: record.timestamp ?? Date.now(),
    }))
}

export function parsePeerIdFromSessionKey(sessionKey: string): string | null {
  const match = sessionKey.match(/^agent:[^:]+:[^:]+:[^:]+:dm:(.+)$/)
  return match?.[1] ?? null
}
