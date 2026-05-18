// 中文：本文件（sessions-spawn.ts）位于 backend/src/agent/tools/session-tools/sessions-spawn.ts，属于backend链路中的agent 编排与工具链代码，连接上游调用方与下游执行逻辑。
// English: This file (sessions-spawn.ts) belongs to the backend agent 编排与工具链 layer in backend/src/agent/tools/session-tools/sessions-spawn.ts, wiring upstream callers with downstream runtime logic.

import { Type } from '@sinclair/typebox'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { TOOL_OUTPUT_LIMIT } from '../../types.js'
import { stringifySessionToolOutput } from './output.js'
import { getBoundSessionService, getCurrentToolSessionKey } from './runtime.js'

const parameters = Type.Object({
  task: Type.String({ minLength: 1 }),
  label: Type.Optional(Type.String()),
  runTimeoutSeconds: Type.Optional(Type.Number({ minimum: 0, maximum: 3600 })),
  cleanup: Type.Optional(Type.Union([Type.Literal('delete'), Type.Literal('keep')])),
})

export function createSessionsSpawnTool(): AgentTool<typeof parameters> {
  return {
    name: 'sessions_spawn',
    label: '生成隔离子会话',
    description: `创建隔离子任务会话并异步执行。单次输出会被截断到 ${TOOL_OUTPUT_LIMIT} 字符以内。`,
    parameters,
    execute: async (_id, params): Promise<AgentToolResult<Record<string, never>>> => {
      const service = getBoundSessionService()
      const requesterSessionKey = getCurrentToolSessionKey()
      if (!requesterSessionKey) {
        return {
          content: [{ type: 'text', text: stringifySessionToolOutput({ status: 'error', error: 'missing requester session key' }) }],
          details: {},
        }
      }
      const result = await service.spawnTask(requesterSessionKey, params.task)
      return {
        content: [{ type: 'text', text: stringifySessionToolOutput(result) }],
        details: {},
      }
    },
  }
}
