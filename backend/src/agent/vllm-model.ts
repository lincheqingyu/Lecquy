/**
 * vLLM Model 工厂
 * 创建 pi-ai 兼容的 Model 对象，用于连接 vLLM/OpenAI 兼容 API
 */

import type { Model } from '@mariozechner/pi-ai'
import type { ThinkingProtocol } from '@webclaw/shared'
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
  /** Thinking 协议 */
  thinkingProtocol?: ThinkingProtocol
}

function createCompat(thinkingProtocol: ThinkingProtocol): Model<'openai-completions'>['compat'] {
  const baseCompat: Model<'openai-completions'>['compat'] = {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    supportsStrictMode: false,
    supportsUsageInStreaming: false,
    maxTokensField: 'max_tokens',
  }

  if (thinkingProtocol === 'qwen') {
    return {
      ...baseCompat,
      thinkingFormat: 'qwen',
    }
  }

  if (thinkingProtocol === 'zai') {
    return {
      ...baseCompat,
      thinkingFormat: 'zai',
    }
  }

  if (thinkingProtocol === 'openai_reasoning') {
    return {
      ...baseCompat,
      supportsReasoningEffort: true,
    }
  }

  return baseCompat
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
  const thinkingProtocol = options?.thinkingProtocol ?? 'off'

  return {
    id: modelId,
    name: modelId,
    api: 'openai-completions',
    provider: 'openai',
    baseUrl,
    reasoning: thinkingProtocol !== 'off',
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: options?.contextWindow ?? 128_000,
    maxTokens,
    compat: createCompat(thinkingProtocol),
  }
}
