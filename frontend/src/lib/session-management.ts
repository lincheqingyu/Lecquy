import {
  extractSessionText,
  extractSessionThinking,
  type SessionMessageRecord,
  type SessionProjection,
} from '@webclaw/shared'
import type { ChatMessage } from '../hooks/useChat'

export interface SessionListItemVm {
  id: string
  title: string
  preview: string
  updatedAt: number
  createdAt: number
  sessionId: string
  channel: string
  peerId?: string
}

export function extractMessageText(content: unknown): string {
  return extractSessionText(content)
}

function normalizePreview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return '暂无消息'
  return normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized
}

export function toSessionListItemVm(entry: SessionProjection): SessionListItemVm {
  const latest = entry.recentMessages?.[entry.recentMessages.length - 1]
  const latestText = latest ? extractMessageText(latest.content) : ''

  return {
    id: entry.key,
    title: entry.title?.trim() || entry.displayName?.trim() || '未命名会话',
    preview: normalizePreview(latestText),
    updatedAt: entry.updatedAt,
    createdAt: entry.createdAt,
    sessionId: entry.sessionId,
    channel: entry.channel,
    peerId: entry.origin?.peerId,
  }
}

export function toChatMessages(records: SessionMessageRecord[]): ChatMessage[] {
  return records
    .filter((record) => record.role === 'user' || record.role === 'assistant')
    .map((record, index) => {
      const thinkingContent = extractSessionThinking(record.content)
      return {
        id: `history_${record.role}_${record.timestamp ?? Date.now()}_${index}`,
        role: record.role as ChatMessage['role'],
        content: extractMessageText(record.content),
        thinkingContent: thinkingContent || undefined,
        hasThinking: thinkingContent.trim().length > 0,
        isThinkingExpanded: false,
        timestamp: record.timestamp ?? Date.now(),
      }
    })
}

export function parsePeerIdFromSessionKey(sessionKey: string): string | null {
  const match = sessionKey.match(/^agent:[^:]+:[^:]+:[^:]+:dm:(.+)$/)
  return match?.[1] ?? null
}
