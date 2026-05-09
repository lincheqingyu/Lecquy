import { logger } from '../utils/logger.js'

export type ModelContextWindowSource = 'spec' | 'registry' | 'fallback'

export interface ModelRegistrySpec {
  readonly contextWindow: number
  readonly maxTokens: number
}

export interface ResolvedModelSpec extends ModelRegistrySpec {
  readonly contextWindowSource: ModelContextWindowSource
}

const FALLBACK_CONTEXT_WINDOW = 128_000
const FALLBACK_MAX_TOKENS = 8_192

const MODEL_REGISTRY: Record<string, ModelRegistrySpec> = {
  'glm-4.7': { contextWindow: 128_000, maxTokens: 8_192 },
  'glm-4-plus': { contextWindow: 128_000, maxTokens: 8_192 },
  'qwen3-coder-30b-instruct': { contextWindow: 128_000, maxTokens: 8_192 },
  'qwen3-coder-plus': { contextWindow: 128_000, maxTokens: 8_192 },
  'local-32k': { contextWindow: 32_000, maxTokens: 4_096 },
  'local-128k': { contextWindow: 128_000, maxTokens: 8_192 },
  'local-200k': { contextWindow: 200_000, maxTokens: 8_192 },
}

const warnedFallbackModelIds = new Set<string>()

function normalizeModelId(modelId: string | undefined): string {
  return modelId?.trim().toLowerCase() ?? ''
}

export function lookupModelSpec(modelId: string | undefined): ModelRegistrySpec | undefined {
  const normalized = normalizeModelId(modelId)
  if (!normalized) return undefined
  return MODEL_REGISTRY[normalized]
}

export function resolveModelSpec(input: {
  readonly modelId?: string
  readonly explicitContextWindow?: number
  readonly explicitMaxTokens?: number
  readonly contextWindowSource?: ModelContextWindowSource
  readonly fallbackContextWindow?: number
  readonly fallbackMaxTokens?: number
  readonly warnOnFallback?: boolean
}): ResolvedModelSpec {
  if (input.explicitContextWindow && input.explicitContextWindow > 0) {
    return {
      contextWindow: input.explicitContextWindow,
      maxTokens: input.explicitMaxTokens ?? input.fallbackMaxTokens ?? FALLBACK_MAX_TOKENS,
      contextWindowSource: input.contextWindowSource ?? 'spec',
    }
  }

  const registrySpec = lookupModelSpec(input.modelId)
  if (registrySpec) {
    return {
      contextWindow: registrySpec.contextWindow,
      maxTokens: input.explicitMaxTokens ?? registrySpec.maxTokens,
      contextWindowSource: 'registry',
    }
  }

  const contextWindow = input.fallbackContextWindow ?? FALLBACK_CONTEXT_WINDOW
  const modelId = input.modelId?.trim() || 'unknown'
  if (input.warnOnFallback && !warnedFallbackModelIds.has(modelId)) {
    warnedFallbackModelIds.add(modelId)
    logger.warn('[model-registry] missing model spec, using fallback context window', {
      modelId,
      contextWindow,
    })
  }

  return {
    contextWindow,
    maxTokens: input.explicitMaxTokens ?? input.fallbackMaxTokens ?? FALLBACK_MAX_TOKENS,
    contextWindowSource: 'fallback',
  }
}
