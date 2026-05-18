// 中文：本文件（archive-api.ts）位于 backend/src/extensions/archive-api.ts，属于backend链路中的扩展接口代码，连接上游调用方与下游执行逻辑。
// English: This file (archive-api.ts) belongs to the backend 扩展接口 layer in backend/src/extensions/archive-api.ts, wiring upstream callers with downstream runtime logic.

/**
 * get_ai_archive_data 扩展工具 — 调用档案 API 获取业务数据
 */

import { Type } from '@sinclair/typebox'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { getConfig } from '../config/index.js'
import { logger } from '../utils/logger.js'

const parameters = Type.Object({
  archive_id: Type.String({ description: '档案唯一标识 (ARCHIVEID)' }),
  scheme_id: Type.String({ description: '方案唯一标识 (AISCHEMEID)' }),
})

/** 创建 get_ai_archive_data 工具 */
export function createArchiveApiTool(): AgentTool<typeof parameters> {
  return {
    name: 'get_ai_archive_data',
    label: '获取 AI 档案',
    description: '根据档案 ID 和方案 ID，调用档案 API 获取详细业务数据。',
    parameters,
    execute: async (_toolCallId, params): Promise<AgentToolResult<Record<string, never>>> => {
      const config = getConfig()

      if (!config.ARCHIVE_API_BASE_URL) {
        return {
          content: [{ type: 'text', text: '错误: ARCHIVE_API_BASE_URL 未配置，请在 .env 中设置档案 API 地址' }],
          details: {},
        }
      }

      const url = new URL('/api/archive/get2', config.ARCHIVE_API_BASE_URL)
      url.searchParams.set('archiveId', params.archive_id)
      url.searchParams.set('schemeId', params.scheme_id)

      logger.info(`请求 AI 档案: archive_id=${params.archive_id}, scheme_id=${params.scheme_id}`)

      try {
        const headers: Record<string, string> = {}
        if (config.ARCHIVE_API_TOKEN) {
          headers['Authorization'] = config.ARCHIVE_API_TOKEN
        }

        const response = await fetch(url.toString(), {
          headers,
          signal: AbortSignal.timeout(10_000),
        })

        if (!response.ok) {
          const text = await response.text()
          return {
            content: [{ type: 'text', text: `错误: API 返回 ${response.status}: ${text.slice(0, 200)}` }],
            details: {},
          }
        }

        const json = await response.json() as { data?: unknown }
        const data = json.data ?? {}
        const resultText = JSON.stringify(data, null, 2)

        // 截取前 5000 字符避免超出工具输出限制
        const truncated = resultText.length > 5000
          ? resultText.slice(0, 5000) + '\n...(结果已截取前 5000 字符)'
          : resultText

        return {
          content: [{ type: 'text', text: truncated }],
          details: {},
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.error(`get_ai_archive_data 失败: ${message}`)
        return {
          content: [{ type: 'text', text: `错误: ${message}` }],
          details: {},
        }
      }
    },
  }
}
