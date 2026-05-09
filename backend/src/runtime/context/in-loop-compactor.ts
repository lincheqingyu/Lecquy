/**
 * In-loop context compaction only changes the LLM view.
 *
 * Decisions:
 * 1. Cross user-turn tool forgetting is intentional. Tool calls are not restored
 *    into raw LLM history here; durable extraction belongs in memory/.
 * 2. In-loop compaction is rule-based and never calls an LLM.
 * 3. The event tree stores original data. Truncation only happens in projected
 *    context, including buildSessionContext() and the transformContext hook.
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { logger } from '../../utils/logger.js'

export interface InLoopCompactorOptions {
  /** 总字符数超过此阈值才启动压缩 */
  readonly maxTotalChars: number
  /** 末尾 K 个 assistant turn 内的消息保持原样不动 */
  readonly keepRecentTurns: number
  /** 单条 toolResult 超过此字符数才被替换；小于的不动 */
  readonly minToolResultChars: number
}

export const DEFAULT_IN_LOOP_OPTIONS: InLoopCompactorOptions = {
  maxTotalChars: 80_000,
  keepRecentTurns: 2,
  minToolResultChars: 2_000,
}

function estimateChars(message: AgentMessage): number {
  if (typeof message.content === 'string') return message.content.length
  try {
    return JSON.stringify(message.content).length
  } catch {
    return 0
  }
}

function hasObjectContent(message: AgentMessage): message is AgentMessage & {
  content: Array<Record<string, unknown>>
} {
  return Array.isArray(message.content)
}

function createImagePlaceholder(part: Record<string, unknown>): { type: 'text'; text: string } {
  const name = typeof part.name === 'string' && part.name.trim() ? part.name.trim() : undefined
  const bytes = typeof part.size === 'number'
    ? part.size
    : typeof part.data === 'string'
      ? part.data.length
      : 0
  const detail = name ? `${name}, ${bytes}B` : `${bytes}B`
  return {
    type: 'text',
    text: `[image removed from in-loop context: ${detail}]`,
  }
}

function compactToolResult(message: AgentMessage): AgentMessage | null {
  const chars = estimateChars(message)
  const toolName = 'toolName' in message && typeof message.toolName === 'string'
    ? message.toolName
    : 'unknown'
  const toolCallId = 'toolCallId' in message && typeof message.toolCallId === 'string'
    ? message.toolCallId
    : 'unknown'

  return {
    ...message,
    content: [{
      type: 'text',
      text: `[tool_result truncated: tool=${toolName} id=${toolCallId} originalChars=${chars}]`,
    }],
  } as AgentMessage
}

function compactUserImages(message: AgentMessage): AgentMessage | null {
  if (!hasObjectContent(message)) return null

  let changed = false
  const content = message.content.map((part) => {
    if (part?.type === 'image') {
      changed = true
      return createImagePlaceholder(part)
    }
    return part
  })

  return changed ? ({ ...message, content } as unknown as AgentMessage) : null
}

function compactAssistantToolOutputs(message: AgentMessage): AgentMessage | null {
  if (!hasObjectContent(message)) return null

  let changed = false
  const content = message.content.map((part) => {
    if (part?.type !== 'toolCall' || typeof part.output !== 'string' || part.output.length <= 200) {
      return part
    }

    changed = true
    return {
      ...part,
      output: `${part.output.slice(0, 200)}... (truncated)`,
    }
  })

  return changed ? ({ ...message, content } as unknown as AgentMessage) : null
}

/**
 * In-loop 上下文压缩
 *
 * - 纯函数，不调 LLM，不修改入参
 * - 总字符数低于阈值则返回原数组（同引用）
 * - 超过阈值时，把末尾 keepRecentTurns 个 assistant turn 之前的大
 *   toolResult 替换为占位文字，把同区间的 image 块替换为占位文字
 * - 末尾 K 个 turn 一律不动
 *
 * 返回值：要么是入参原数组（无操作），要么是新数组（有替换）
 */
export function compactInLoop(
  messages: AgentMessage[],
  options: InLoopCompactorOptions = DEFAULT_IN_LOOP_OPTIONS,
): AgentMessage[] {
  const totalChars = messages.reduce((sum, message) => sum + estimateChars(message), 0)
  if (totalChars <= options.maxTotalChars) {
    return messages
  }

  const assistantIndexes = messages
    .map((message, index) => ({ role: message.role, index }))
    .filter((item) => item.role === 'assistant')
    .map((item) => item.index)

  if (assistantIndexes.length <= options.keepRecentTurns) {
    return messages
  }

  const cutoffIndex = options.keepRecentTurns <= 0
    ? messages.length
    : assistantIndexes[assistantIndexes.length - options.keepRecentTurns]

  let toolResultCount = 0
  let imageCount = 0
  let assistantToolOutputCount = 0
  let savedChars = 0

  const compactedMessages = messages.map((message, index) => {
    if (index >= cutoffIndex) return message

    let replacement: AgentMessage | null = null
    if (message.role === 'toolResult' && estimateChars(message) >= options.minToolResultChars) {
      replacement = compactToolResult(message)
      toolResultCount += 1
    } else if (message.role === 'user') {
      replacement = compactUserImages(message)
      if (replacement) imageCount += 1
    } else if (message.role === 'assistant') {
      replacement = compactAssistantToolOutputs(message)
      if (replacement) assistantToolOutputCount += 1
    }

    if (!replacement) return message

    savedChars += Math.max(0, estimateChars(message) - estimateChars(replacement))
    return replacement
  })

  const replacementCount = toolResultCount + imageCount + assistantToolOutputCount
  if (replacementCount === 0) {
    return messages
  }

  logger.debug('[in-loop-compactor] compacted context before LLM call', {
    totalChars,
    savedChars,
    toolResultCount,
    imageCount,
    assistantToolOutputCount,
  })

  return compactedMessages
}
