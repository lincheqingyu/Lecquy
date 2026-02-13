/**
 * LLM 相关类型定义
 * 定义对话消息、选项、响应等核心数据结构
 */

/** 消息角色 */
export type MessageRole = 'system' | 'user' | 'assistant'

/** 对话消息 */
export interface ChatMessage {
  readonly role: MessageRole
  readonly content: string
}

/** 对话选项 */
export interface ChatOptions {
  readonly model?: string
  readonly temperature?: number
  readonly maxTokens?: number
}

/** 完整对话响应 */
export interface ChatResponse {
  readonly content: string
  readonly model: string
  readonly usage?: TokenUsage
}

/** Token 用量统计 */
export interface TokenUsage {
  readonly promptTokens: number
  readonly completionTokens: number
  readonly totalTokens: number
}

/** 流式对话片段 */
export interface ChatChunk {
  readonly content: string
  readonly done: boolean
}
