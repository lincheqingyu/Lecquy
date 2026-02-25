/**
 * vLLM Model 工厂
 * 创建 pi-ai 兼容的 Model 对象，用于连接 vLLM/OpenAI 兼容 API
 */

import type { Model } from '@mariozechner/pi-ai'
import { getConfig } from '../config/index.js'

/** vLLM Model 创建参数 */
export interface VllmModelOptions {
  /** 模型 ID，默认从 LLM_MODEL 环境变量读取 */
  modelId?: string
  /** API 基础地址，默认从 LLM_BASE_URL 环境变量读取 */
  baseUrl?: string
  /** 上下文窗口大小 */
  contextWindow?: number
  /** 最大输出 token 数，默认从 LLM_MAX_TOKENS 环境变量读取 */
  maxTokens?: number
}

/**
 * 创建 vLLM 兼容的 Model 配置
 * apiKey 不存入 Model，需单独传给 AgentLoopConfig
 */
export function createVllmModel(options?: VllmModelOptions): Model<'openai-completions'> {
  const config = getConfig()

  const modelId = options?.modelId ?? config.LLM_MODEL
  const baseUrl = options?.baseUrl ?? config.LLM_BASE_URL
  const maxTokens = options?.maxTokens ?? config.LLM_MAX_TOKENS

  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider: 'openai',
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: options?.contextWindow ?? 128_000,
    maxTokens,
    compat: {
      supportsStore: false,
      supportsDeveloperRole: false,
      supportsReasoningEffort: false,
      supportsStrictMode: false,
      supportsUsageInStreaming: false,
      maxTokensField: 'max_tokens',
    },
  }
}
