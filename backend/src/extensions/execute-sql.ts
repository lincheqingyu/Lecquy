// 中文：本文件（execute-sql.ts）位于 backend/src/extensions/execute-sql.ts，属于backend链路中的扩展接口代码，连接上游调用方与下游执行逻辑。
// English: This file (execute-sql.ts) belongs to the backend 扩展接口 layer in backend/src/extensions/execute-sql.ts, wiring upstream callers with downstream runtime logic.

/**
 * execute_sql 扩展工具 — 查询达梦数据库
 * 仅支持 SELECT 语句，自动限制返回行数
 */

import { Type } from '@sinclair/typebox'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { getDmPool } from './dmdb-pool.js'
import { logger } from '../utils/logger.js'

interface ColumnMeta {
  name: string
}

interface DmConnection {
  execute: (sql: string) => Promise<{ metaData?: ColumnMeta[]; rows?: unknown[][] }>
  close: () => Promise<void>
}

interface DmPool {
  getConnection: () => Promise<DmConnection>
}

const parameters = Type.Object({
  sql: Type.String({ description: 'SQL SELECT 语句（仅支持 SELECT）' }),
  max_rows: Type.Optional(Type.Number({ description: '最大返回行数，默认 100', default: 100 })),
})

/** 创建 execute_sql 工具 */
export function createExecuteSqlTool(): AgentTool<typeof parameters> {
  return {
    name: 'execute_sql',
    label: '执行 SQL 查询',
    description: '执行 SQL SELECT 查询达梦数据库，返回 JSON 结果集。仅支持 SELECT 语句。',
    parameters,
    execute: async (_toolCallId, params): Promise<AgentToolResult<Record<string, never>>> => {
      const sql = params.sql.trim()

      // 安全检查：仅允许 SELECT
      if (!/^\s*SELECT\b/i.test(sql)) {
        throw new Error('仅支持 SELECT 语句')
      }

      const maxRows = params.max_rows ?? 100

      try {
        const pool = await getDmPool() as DmPool
        const conn = await pool.getConnection()

        try {
          // 用 ROWNUM 限制行数（达梦兼容 Oracle 语法）
          const limitedSql = sql.toUpperCase().includes('ROWNUM')
            ? sql
            : `SELECT * FROM (${sql}) WHERE ROWNUM <= ${maxRows}`

          const result = await conn.execute(limitedSql)

          const columns: string[] = result.metaData?.map((m) => m.name) ?? []
          const rows = result.rows ?? []

          const data = rows.map((row) => {
            const obj: Record<string, unknown> = {}
            columns.forEach((col, i) => { obj[col] = row[i] })
            return obj
          })

          const response = {
            success: true,
            row_count: data.length,
            columns,
            data,
            truncated: data.length >= maxRows,
          }

          return {
            content: [{ type: 'text', text: JSON.stringify(response, null, 2) }],
            details: {},
          }
        } finally {
          await conn.close()
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`execute_sql 失败: ${message}`)
        throw new Error(message)
      }
    },
  }
}
