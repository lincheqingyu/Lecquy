/**
 * Provider 注册表
 * 工厂模式管理所有已注册的 LLM Provider
 */

import type { LLMProvider } from '../types/index.js'
import { logger } from '../utils/logger.js'

/** Provider 存储 */
const providers = new Map<string, LLMProvider>()

/** 默认 Provider 名称 */
let defaultProviderName: string | null = null

/**
 * 注册一个 Provider
 * 如果是第一个注册的 Provider，自动设为默认
 */
export function registerProvider(name: string, provider: LLMProvider): void {
  if (providers.has(name)) {
    logger.warn(`Provider "${name}" 已存在，将被覆盖`)
  }
  providers.set(name, provider)
  logger.info(`已注册 Provider: ${name}`)

  if (!defaultProviderName) {
    defaultProviderName = name
    logger.info(`默认 Provider 设为: ${name}`)
  }
}

/** 获取指定 Provider */
export function getProvider(name: string): LLMProvider {
  const provider = providers.get(name)
  if (!provider) {
    throw new Error(`Provider "${name}" 未注册。可用: ${listProviders().join(', ')}`)
  }
  return provider
}

/** 获取默认 Provider */
export function getDefaultProvider(): LLMProvider {
  if (!defaultProviderName) {
    throw new Error('没有已注册的 Provider')
  }
  return getProvider(defaultProviderName)
}

/** 设置默认 Provider */
export function setDefaultProvider(name: string): void {
  if (!providers.has(name)) {
    throw new Error(`Provider "${name}" 未注册`)
  }
  defaultProviderName = name
  logger.info(`默认 Provider 已切换为: ${name}`)
}

/** 列出所有已注册的 Provider 名称 */
export function listProviders(): readonly string[] {
  return [...providers.keys()]
}

/** 清除所有 Provider（仅用于测试） */
export function clearProviders(): void {
  providers.clear()
  defaultProviderName = null
}
