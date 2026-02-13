/**
 * 配置统一导出
 * 应用启动时调用 loadConfig() 初始化配置
 */

import { validateEnv, type Env } from './env.js'

/** 全局配置单例 */
let _config: Env | null = null

/**
 * 加载并校验配置
 * 应在应用启动时调用一次
 */
export function loadConfig(): Env {
  if (_config) return _config
  _config = validateEnv()
  return _config
}

/**
 * 获取当前配置
 * 必须在 loadConfig() 之后调用
 */
export function getConfig(): Env {
  if (!_config) {
    throw new Error('配置未初始化，请先调用 loadConfig()')
  }
  return _config
}

export type { Env } from './env.js'
