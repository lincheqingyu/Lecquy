// 中文：本文件（index.ts）位于 backend/src/config/index.ts，属于backend链路中的配置与路由代码，连接上游调用方与下游执行逻辑。
// English: This file (index.ts) belongs to the backend 配置与路由 layer in backend/src/config/index.ts, wiring upstream callers with downstream runtime logic.

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
