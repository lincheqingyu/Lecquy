/**
 * OpenAI 兼容 Provider
 * 覆盖所有支持 OpenAI 格式 API 的厂商（OpenAI、DeepSeek、Zhipu 等）
 */

import OpenAI from 'openai'
import { BaseProvider } from './base.js'
import type {
  ProviderConfig,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  ChatChunk,
} from '../types/index.js'
import { logger } from '../utils/logger.js'

export class OpenAICompatibleProvider extends BaseProvider {
  readonly name: string
  private readonly client: OpenAI
  private readonly defaultModel: string

  constructor(config: ProviderConfig) {
    super()
    this.name = config.name
    this.defaultModel = config.defaultModel ?? 'gpt-4o'
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    })
  }

  async chat(
    messages: readonly ChatMessage[],
    options?: ChatOptions,
  ): Promise<ChatResponse> {
    const merged = this.mergeOptions(
      { model: this.defaultModel },
      options,
    )

    logger.debug(`[${this.name}] 发起对话请求，模型: ${merged.model}`)
    logger.debug(`[${this.name}] 请求参数: ${JSON.stringify(merged)}`)

    const response = await this.client.chat.completions.create({
      model: merged.model ?? this.defaultModel,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: merged.temperature,
      max_tokens: merged.maxTokens,
    })

    const choice = response.choices[0]
    logger.info(`choice`,choice)

    if (!choice?.message?.content) {
      throw new Error(`[${this.name}] LLM 返回空响应`)
    }

    return {
      content: choice.message.content,
      model: response.model,
      usage: response.usage
        ? {
            promptTokens: response.usage.prompt_tokens,
            completionTokens: response.usage.completion_tokens,
            totalTokens: response.usage.total_tokens,
          }
        : undefined,
    }
  }

  async *chatStream(
    messages: readonly ChatMessage[],
    options?: ChatOptions,
  ): AsyncIterable<ChatChunk> {
    const merged = this.mergeOptions(
      { model: this.defaultModel },
      options,
    )

    logger.debug(`[${this.name}] 发起流式请求，模型: ${merged.model}`)

    const stream = await this.client.chat.completions.create({
      model: merged.model ?? this.defaultModel,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: merged.temperature,
      max_tokens: merged.maxTokens,
      stream: true,
    })

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content
      if (delta) {
        yield { content: delta, done: false }
      }
    }

    yield { content: '', done: true }
  }
}
