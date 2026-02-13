/**
 * 统一 LLM 客户端（单模型工厂）
 * 对应源码: core/llm/base/langchain_base_client.py (VLLMSmartClient)
 * 变更：去掉 model discovery 和三模型概念，简化为单例 ChatOpenAI
 */

import { ChatOpenAI } from '@langchain/openai'
import { getConfig } from '../../config/index.js'

let _instance: ChatOpenAI | null = null

/** 获取统一 LLM 实例（单例，流式输出） */
export function getLLM(): ChatOpenAI {
  if (_instance) return _instance

  const config = getConfig()

  _instance = new ChatOpenAI({
    apiKey: config.LLM_API_KEY,
    configuration: { baseURL: config.LLM_BASE_URL },
    model: config.LLM_MODEL,
    temperature: config.LLM_TEMPERATURE,
    maxTokens: config.LLM_MAX_TOKENS,
    timeout: config.LLM_TIMEOUT,
    streaming: true,
  })

  return _instance
}

/** 清除缓存实例（测试用） */
export function resetLLM(): void {
  _instance = null
}
