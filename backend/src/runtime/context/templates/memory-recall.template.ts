// 中文：本文件（memory-recall.template.ts）位于 backend/src/runtime/context/templates/memory-recall.template.ts，属于backend链路中的会话运行时代码，连接上游调用方与下游执行逻辑。
// English: This file (memory-recall.template.ts) belongs to the backend 会话运行时 layer in backend/src/runtime/context/templates/memory-recall.template.ts, wiring upstream callers with downstream runtime logic.

import type { MemoryRecallResult } from '../../../memory/types.js'

const MEMORY_RECALL_BUDGET_CHARS = 6_000
const MEMORY_RECALL_SUMMARY_CHARS = 80
const MEMORY_RECALL_CONTENT_CHARS = 200

export const RELEVANT_MEMORY_HEADER = '[Relevant Memory]'

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function truncate(text: string, maxLength: number): string {
  const normalized = normalizeWhitespace(text)
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 3)}...`
}

function formatProjectName(projectId: string | undefined): string {
  const normalized = normalizeWhitespace(projectId ?? '').replace(/\\/g, '/')
  if (!normalized) return 'global'

  const parts = normalized.split('/').filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}

function formatRelativeTime(occurredAt: string | undefined): string {
  if (!occurredAt) return '时间未知'

  const timestamp = new Date(occurredAt).getTime()
  if (!Number.isFinite(timestamp)) return '时间未知'

  const diffMs = Math.max(Date.now() - timestamp, 0)
  const minuteMs = 60 * 1000
  const hourMs = 60 * minuteMs
  const dayMs = 24 * hourMs

  if (diffMs < hourMs) {
    const minutes = Math.max(Math.floor(diffMs / minuteMs), 1)
    return `${minutes} 分钟前`
  }

  if (diffMs < dayMs) {
    return `${Math.floor(diffMs / hourMs)} 小时前`
  }

  return `${Math.floor(diffMs / dayMs)} 天前`
}

function formatMemoryLabel(item: MemoryRecallResult): string {
  const type = item.eventType ?? item.kind
  return `${type} · ${formatProjectName(item.projectId)} · ${formatRelativeTime(item.occurredAt)}`
}

export function formatMemoryRecallBlock(
  items: MemoryRecallResult[],
  charBudget = MEMORY_RECALL_BUDGET_CHARS,
): string {
  if (items.length === 0) return ''

  const header = [
    '以下是与当前问题相关的历史记忆，只作为辅助上下文。',
    '如果这些记忆与当前用户输入冲突，以当前用户输入为准。',
    '',
    RELEVANT_MEMORY_HEADER,
  ].join('\n')

  const lines: string[] = [header]

  for (const [index, item] of items.entries()) {
    const block = [
      `${index + 1}. [${formatMemoryLabel(item)}] summary: ${truncate(item.summary, MEMORY_RECALL_SUMMARY_CHARS)}`,
      `   content: ${truncate(item.content, MEMORY_RECALL_CONTENT_CHARS)}`,
      `   tags: ${item.tags.join(', ') || 'n/a'}`,
      '   source: session memory',
    ].join('\n')

    const next = `${lines.join('\n')}\n${block}`
    if (next.length > charBudget) {
      break
    }

    lines.push(block)
  }

  return lines.length === 1 ? '' : lines.join('\n')
}
