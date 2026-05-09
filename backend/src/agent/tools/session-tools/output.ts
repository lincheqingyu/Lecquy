import { TOOL_OUTPUT_LIMIT } from '../../types.js'

export function normalizePositiveIntegerLimit(value: number | undefined, defaultValue: number, maxValue: number): number {
  if (!Number.isFinite(value)) return defaultValue
  return Math.min(maxValue, Math.max(1, Math.floor(value as number)))
}

export function normalizeNonNegativeIntegerLimit(value: number | undefined, defaultValue: number, maxValue: number): number {
  if (!Number.isFinite(value)) return defaultValue
  return Math.min(maxValue, Math.max(0, Math.floor(value as number)))
}

export function truncateSessionToolOutput(text: string): string {
  if (text.length <= TOOL_OUTPUT_LIMIT) return text

  const suffix = `\n\n... [输出被截断，原始 ${text.length} 字符 > 上限 ${TOOL_OUTPUT_LIMIT}。请缩小 limit/messageLimit 或更精确筛选。]`
  const contentLimit = Math.max(0, TOOL_OUTPUT_LIMIT - suffix.length)
  return `${text.slice(0, contentLimit)}${suffix}`
}

export function stringifySessionToolOutput(value: unknown): string {
  return truncateSessionToolOutput(JSON.stringify(value, null, 2))
}
