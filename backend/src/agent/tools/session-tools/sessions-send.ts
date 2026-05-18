// 中文：本文件（sessions-send.ts）位于 backend/src/agent/tools/session-tools/sessions-send.ts，属于backend链路中的agent 编排与工具链代码，连接上游调用方与下游执行逻辑。
// English: This file (sessions-send.ts) belongs to the backend agent 编排与工具链 layer in backend/src/agent/tools/session-tools/sessions-send.ts, wiring upstream callers with downstream runtime logic.

import { Type } from '@sinclair/typebox'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { TOOL_OUTPUT_LIMIT } from '../../types.js'
import { stringifySessionToolOutput } from './output.js'
import { getBoundSessionService } from './runtime.js'

const parameters = Type.Object({
  sessionKey: Type.String({ minLength: 1 }),
  message: Type.String({ minLength: 1 }),
  timeoutSeconds: Type.Optional(Type.Number({ minimum: 0, maximum: 600, default: 30 })),
})

export function createSessionsSendTool(): AgentTool<typeof parameters> {
  return {
    name: 'sessions_send',
    label: '跨会话发送消息',
    description: `向另一个会话发送消息。单次输出会被截断到 ${TOOL_OUTPUT_LIMIT} 字符以内。`,
    parameters,
    execute: async (_id, params): Promise<AgentToolResult<Record<string, never>>> => {
      const service = getBoundSessionService()
      const timeoutSeconds = params.timeoutSeconds ?? 30
      const promise = service.runSend(params.sessionKey, params.message)
      if (timeoutSeconds === 0) {
        void promise
        return {
          content: [{ type: 'text', text: stringifySessionToolOutput({ status: 'accepted' }) }],
          details: {},
        }
      }

      let timeoutHandle: ReturnType<typeof setTimeout> | undefined
      const timeout = new Promise<{ timeout: true }>((resolve) => {
        timeoutHandle = setTimeout(() => resolve({ timeout: true }), timeoutSeconds * 1000)
      })

      const race = await Promise.race([promise, timeout])
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      if ('timeout' in race) {
        return {
          content: [{ type: 'text', text: stringifySessionToolOutput({ status: 'timeout', error: `waited ${timeoutSeconds}s` }) }],
          details: {},
        }
      }

      if (race.status === 'error') {
        return {
          content: [{ type: 'text', text: stringifySessionToolOutput({ runId: race.runId, status: race.status, error: race.error }) }],
          details: {},
        }
      }

      return {
        content: [{ type: 'text', text: stringifySessionToolOutput({ runId: race.runId, status: race.status, reply: race.reply }) }],
        details: {},
      }
    },
  }
}
