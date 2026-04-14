/**
 * Agent 共享类型和常量
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core'

/** 主 Agent 最大迭代次数 */
export const MAX_ITERATIONS = 10

/** 主 Agent 最大工具失败次数 */
export const MAX_TOOL_FAILURES = 3

/** 子 Agent 最大迭代次数 */
export const MAX_SUB_ITERATIONS = 8

/** 子 Agent 最大工具失败次数 */
export const MAX_SUB_TOOL_FAILURES = 3

/** 工具输出截断上限（字符数） */
export const TOOL_OUTPUT_LIMIT = 50_000

/** 迭代跟踪器（外部可变状态） */
export interface IterationTracker {
  iteration: number
  toolFailCount: number
  directReturn: boolean
}

/** 创建默认迭代跟踪器 */
export function createTracker(): IterationTracker {
  return { iteration: 0, toolFailCount: 0, directReturn: false }
}

export class AgentExecutionError extends Error {
  readonly messages: AgentMessage[]
  readonly stopReason: 'aborted' | 'error'

  constructor(
    message: string,
    options: {
      messages: AgentMessage[]
      stopReason: 'aborted' | 'error'
    },
  ) {
    super(message)
    this.name = 'AgentExecutionError'
    this.messages = options.messages
    this.stopReason = options.stopReason
  }
}

function extractTextLike(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''

  return value
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      if ('text' in part && typeof part.text === 'string') return part.text
      return ''
    })
    .filter(Boolean)
    .join('\n')
}

export function extractToolResultText(result: unknown): string {
  if (!result || typeof result !== 'object') return ''
  const content = 'content' in result ? (result as { content?: unknown }).content : undefined
  const text = extractTextLike(content).trim()
  return text.length > 240 ? `${text.slice(0, 240)}...` : text
}

export function formatAgentFailureMessage(reason: string, lastToolError?: string): string {
  const normalizedReason = reason.trim() || '执行失败'
  const normalizedToolError = lastToolError?.trim()

  if (normalizedToolError) {
    return `${normalizedReason}。最近一次工具错误：${normalizedToolError}。如果这是查询类任务，请补充更准确的表名、字段名或筛选条件，或者先让我探查可用 schema。`
  }

  return `${normalizedReason}。请补充更具体的目标、表名、字段名或执行范围后再试。`
}
