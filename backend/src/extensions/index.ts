// 中文：本文件（index.ts）位于 backend/src/extensions/index.ts，属于backend链路中的扩展接口代码，连接上游调用方与下游执行逻辑。
// English: This file (index.ts) belongs to the backend 扩展接口 layer in backend/src/extensions/index.ts, wiring upstream callers with downstream runtime logic.

/**
 * 扩展工具注册表
 * 技能专用工具，与核心工具（bash, read_file, skill, todo_write）分离
 * 所有扩展工具都会加入 agent 工具列表，由 SKILL.md 控制 AI 何时使用
 */

import type { AgentTool } from '@mariozechner/pi-agent-core'
import { createExecuteSqlTool } from './execute-sql.js'
import { createArchiveApiTool } from './archive-api.js'
import { logger } from '../utils/logger.js'

/** 获取所有扩展工具（启动时加载，失败不阻塞主流程） */
export function createExtensionTools(): AgentTool<any>[] {
  const tools: AgentTool<any>[] = []

  try {
    tools.push(createExecuteSqlTool())
  } catch (error) {
    logger.warn('扩展工具 execute_sql 加载失败:', error)
  }

  try {
    tools.push(createArchiveApiTool())
  } catch (error) {
    logger.warn('扩展工具 get_ai_archive_data 加载失败:', error)
  }

  if (tools.length > 0) {
    logger.info(`已加载 ${tools.length} 个扩展工具: ${tools.map(t => t.name).join(', ')}`)
  }

  return tools
}

export { closeDmPool } from './dmdb-pool.js'
