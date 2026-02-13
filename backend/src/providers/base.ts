/**
 * Provider 抽象基类
 * 提供公共逻辑，具体 Provider 继承此类
 */

import type { LLMProvider, ChatMessage, ChatOptions, ChatResponse, ChatChunk } from '../types/index.js'

/**
 * 抽象基类，强制子类实现核心方法
 * 提供参数默认值合并等公共逻辑
 */
export abstract class BaseProvider implements LLMProvider {
  abstract readonly name: string

  abstract chat(
    messages: readonly ChatMessage[],
    options?: ChatOptions,
  ): Promise<ChatResponse>

  abstract chatStream(
    messages: readonly ChatMessage[],
    options?: ChatOptions,
  ): AsyncIterable<ChatChunk>

  /** 合并默认选项与用户选项 */
  protected mergeOptions(
    defaults: ChatOptions,
    userOptions?: ChatOptions,
  ): ChatOptions {
    return {
      ...defaults,
      ...userOptions,
    }
  }
}
