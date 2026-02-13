/**
 * API 请求/响应类型定义
 */

import type { ChatMessage, ChatOptions, TokenUsage } from './llm.js'

/** 对话请求体 */
export interface ChatRequest {
  readonly messages: readonly ChatMessage[]
  readonly provider?: string
  readonly options?: ChatOptions
  readonly stream?: boolean
}

/** 对话响应体 */
export interface ChatApiResponse {
  readonly success: true
  readonly data: {
    readonly content: string
    readonly model: string
    readonly provider: string
    readonly usage?: TokenUsage
  }
}

/** 错误响应体 */
export interface ErrorResponse {
  readonly success: false
  readonly error: string
  readonly code?: string
}

/** API 统一响应类型 */
export type ApiResponse<T = unknown> =
  | { readonly success: true; readonly data: T }
  | ErrorResponse

/** 健康检查响应 */
export interface HealthResponse {
  readonly status: 'ok'
  readonly timestamp: string
  readonly providers: readonly string[]
}
