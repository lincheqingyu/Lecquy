/**
 * 工具返回结果，支持前后端内容分离
 */

/** 工具结果接口 */
export interface ToolResult {
  /** 写入 ToolMessage.content，给 LLM 上下文 */
  readonly context: string
  /** 给前端展示 */
  readonly display: string
}

/** 类型守卫：判断值是否为 ToolResult */
export function isToolResult(value: unknown): value is ToolResult {
  return (
    typeof value === 'object' &&
    value !== null &&
    'context' in value &&
    'display' in value
  )
}

/** 创建 ToolResult */
export function createToolResult(context: string, display: string): ToolResult {
  return Object.freeze({ context, display })
}
