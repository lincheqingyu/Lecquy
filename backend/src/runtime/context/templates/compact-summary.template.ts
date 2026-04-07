import { extractSessionText, type SessionEventEntry } from '@webclaw/shared'

const COMPACT_MAX_SUMMARY_CHARS = 1_200
const COMPACT_PREVIOUS_SUMMARY_CHARS = 280
const COMPACT_SAMPLE_MESSAGE_CHARS = 140
const COMPACT_SAMPLE_MESSAGE_LIMIT = 8

export function formatCompactionContextMessage(summary: string): string {
  return `此前的对话已被压缩为以下摘要：\n\n${summary}`
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 3)}...`
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function extractMessageText(entry: SessionEventEntry): string {
  if (entry.type !== 'message') return ''
  return normalizeWhitespace(extractSessionText(entry.message.content))
}

export function formatCompactSummary(input: {
  readonly previousSummary?: string
  readonly compactedMessages: SessionEventEntry[]
  readonly recentTailCount: number
  readonly maxSummaryChars?: number
}): string {
  const lines: string[] = []

  if (input.previousSummary) {
    lines.push(`此前摘要：${truncate(input.previousSummary, COMPACT_PREVIOUS_SUMMARY_CHARS)}`)
  }

  lines.push(`已压缩 ${input.compactedMessages.length} 条较早消息，保留最近 ${input.recentTailCount} 条原文。`)

  const sampleMessages = input.compactedMessages
    .filter((entry) => entry.type === 'message')
    .slice(-COMPACT_SAMPLE_MESSAGE_LIMIT)

  for (const entry of sampleMessages) {
    const prefix = entry.message.role === 'user' ? '用户' : '助手'
    const text = extractMessageText(entry)
    if (!text) continue
    lines.push(`- ${prefix}: ${truncate(text, COMPACT_SAMPLE_MESSAGE_CHARS)}`)
  }

  return truncate(lines.join('\n'), input.maxSummaryChars ?? COMPACT_MAX_SUMMARY_CHARS)
}
