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
      `${index + 1}. summary: ${truncate(item.summary, MEMORY_RECALL_SUMMARY_CHARS)}`,
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
