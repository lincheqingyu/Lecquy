/**
 * PostgreSQL 连接池
 * 调用 getPool() 前须确保 loadConfig() 已执行（server.ts 启动时会完成）
 */

import { Pool } from 'pg'
import { getConfig } from '../config/index.js'

let _pool: Pool | null = null

function buildSslOption(
  mode: 'false' | 'true' | 'require',
): boolean | { rejectUnauthorized: boolean } {
  if (mode === 'require') return { rejectUnauthorized: false }
  if (mode === 'true') return true
  return false
}

/**
 * 获取全局连接池（懒初始化单例）
 */
export function getPool(): Pool {
  if (!_pool) {
    const config = getConfig()
    _pool = new Pool({
      host: config.PG_HOST,
      port: config.PG_PORT,
      database: config.PG_DATABASE,
      user: config.PG_USER,
      password: config.PG_PASSWORD,
      max: config.PG_POOL_MAX,
      ssl: buildSslOption(config.PG_SSL),
    })
  }
  return _pool
}

/**
 * 关闭连接池（优雅关闭时调用）
 */
export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end()
    _pool = null
  }
}
