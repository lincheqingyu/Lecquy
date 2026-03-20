import type { Model } from '@mariozechner/pi-ai'
import { logger } from '../utils/logger.js'

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0' || hostname === '::1'
}

function isPrivateIpv4Host(hostname: string): boolean {
  return /^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
    || /^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)
    || /^172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}$/.test(hostname)
}

function parseBaseUrl(baseUrl: string): URL | null {
  try {
    return new URL(baseUrl)
  } catch {
    return null
  }
}

export function isBigmodelBaseUrl(baseUrl: string): boolean {
  return baseUrl.includes('bigmodel.cn')
}

export function isLikelyVllmBaseUrl(baseUrl: string): boolean {
  const parsed = parseBaseUrl(baseUrl)
  if (!parsed) return false

  const hostname = parsed.hostname.toLowerCase()
  if (hostname.includes('vllm')) return true

  const isLocalOrPrivateHost = isLoopbackHost(hostname) || isPrivateIpv4Host(hostname)
  const usesCanonicalOpenAiPath = parsed.pathname === '/v1' || parsed.pathname === '/v1/'

  return isLocalOrPrivateHost && usesCanonicalOpenAiPath
}

export function inferProviderFlavor(baseUrl: string): 'bigmodel' | 'vllm' | 'other' {
  if (isBigmodelBaseUrl(baseUrl)) return 'bigmodel'
  if (isLikelyVllmBaseUrl(baseUrl)) return 'vllm'
  return 'other'
}

export function mutateProviderPayload(
  model: Model<'openai-completions'>,
  payload: unknown,
): void {
  if (!isObject(payload)) return

  const providerFlavor = inferProviderFlavor(model.baseUrl)

  if (
    (providerFlavor === 'bigmodel' || providerFlavor === 'vllm')
    && Array.isArray(payload.tools)
    && payload.tools.length > 0
    && payload.stream === true
  ) {
    if (payload.tool_stream === true) return
    payload.tool_stream = true
    logger.info('启用 tool_stream 请求兼容参数', {
      modelId: model.id,
      baseUrl: model.baseUrl,
      providerFlavor,
    })
  }
}
