/**
 * Agent 共享类型和常量
 */

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
