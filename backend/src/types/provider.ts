/**
 * LLM Provider 接口定义
 * 所有 Provider 必须实现此接口
 */

import type { ChatMessage, ChatOptions, ChatResponse, ChatChunk } from './llm.js'

/** LLM Provider 统一接口 */
export interface LLMProvider {
  /** Provider 名称标识 */
  readonly name: string

  /** 同步对话，返回完整响应 */
  chat(messages: readonly ChatMessage[], options?: ChatOptions): Promise<ChatResponse>

  /** 流式对话，返回 AsyncIterable */
  chatStream(messages: readonly ChatMessage[], options?: ChatOptions): AsyncIterable<ChatChunk>
}

/** Provider 配置（用于 OpenAI 兼容 Provider） */
export interface ProviderConfig {
  readonly name: string
  readonly baseURL: string
  readonly apiKey: string
  readonly defaultModel?: string
}
