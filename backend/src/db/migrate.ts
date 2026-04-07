/**
 * Migration runner
 *
 * 可编程调用：
 *   import { runMigrations } from './db/migrate.js'
 *   await runMigrations(pool)
 *
 * 也可通过 npm script 独立运行：
 *   pnpm db:migrate
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { logger } from '../utils/logger.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/** migrations/ 目录与本文件同级 */
const MIGRATIONS_DIR = path.join(__dirname, 'migrations')

const CREATE_MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version     TEXT        PRIMARY KEY,
    applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`

/**
 * 执行所有未应用的 migration
 * - 按文件名字母序执行
 * - 每条 migration 在独立事务内完成，失败自动回滚
 */
export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect()
  try {
    // 确保 schema_migrations 跟踪表存在
    await client.query(CREATE_MIGRATIONS_TABLE_SQL)

    // 读取已应用版本
    const { rows } = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version',
    )
    const applied = new Set(rows.map((r) => r.version))

    // 扫描 SQL 文件，按名称排序
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort()

    if (files.length === 0) {
      logger.info('migration: 没有找到 SQL 文件')
      return
    }

    for (const file of files) {
      const version = path.basename(file, '.sql')

      if (applied.has(version)) {
        logger.debug(`migration 已跳过（已应用）: ${version}`)
        continue
      }

      const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8')
      logger.info(`migration 开始应用: ${version}`)

      await client.query('BEGIN')
      try {
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version])
        await client.query('COMMIT')
        logger.info(`migration 已完成: ${version}`)
      } catch (err) {
        await client.query('ROLLBACK')
        logger.error(`migration 失败，已回滚: ${version}`)
        throw err
      }
    }
  } finally {
    client.release()
  }
}

// ─── 独立运行入口 ──────────────────────────────────────────────────────────────
// tsx src/db/migrate.ts 时执行
if (process.argv[1] === __filename) {
  const { default: dotenv } = await import('dotenv')
  const { resolve } = await import('node:path')
  const { resolveWorkspaceRoot } = await import('../core/runtime-paths.js')

  const workspaceRoot = resolveWorkspaceRoot()
  const envPath = resolve(workspaceRoot, '.env')
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath })
  }

  const { loadConfig } = await import('../config/index.js')
  const config = loadConfig()

  const pool = new Pool({
    host: config.PG_HOST,
    port: config.PG_PORT,
    database: config.PG_DATABASE,
    user: config.PG_USER,
    password: config.PG_PASSWORD,
    max: 1,
    ssl: config.PG_SSL === 'require' ? { rejectUnauthorized: false }
      : config.PG_SSL === 'true' ? true : false,
  })

  try {
    await runMigrations(pool)
    logger.info('所有 migration 已完成')
  } catch (err) {
    logger.error('migration 执行失败', err)
    process.exitCode = 1
  } finally {
    await pool.end()
  }
}
