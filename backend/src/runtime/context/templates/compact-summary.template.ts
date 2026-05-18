// 中文：本文件（compact-summary.template.ts）位于 backend/src/runtime/context/templates/compact-summary.template.ts，属于backend链路中的会话运行时代码，连接上游调用方与下游执行逻辑。
// English: This file (compact-summary.template.ts) belongs to the backend 会话运行时 layer in backend/src/runtime/context/templates/compact-summary.template.ts, wiring upstream callers with downstream runtime logic.

import { extractSessionText, type SessionEventEntry } from '@lecquy/shared'

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

/**
 * 降级摘要生成（Phase 1 之前的模板方式）
 * LLM 调用失败时作为兜底，保留原有行为。
 */
export function formatCompactSummaryFallback(input: {
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
