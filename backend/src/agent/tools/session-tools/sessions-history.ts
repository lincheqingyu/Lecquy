import { Type } from '@sinclair/typebox'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { getBoundSessionService } from './runtime.js'

const parameters = Type.Object({
  sessionKey: Type.String({ minLength: 1 }),
  limit: Type.Optional(Type.Number({ minimum: 1, maximum: 500 })),
})

export function createSessionsHistoryTool(): AgentTool<typeof parameters> {
  return {
    name: 'sessions_history',
    label: '读取会话历史',
    description: '读取指定会话的历史消息。',
    parameters,
    execute: async (_id, params): Promise<AgentToolResult<Record<string, never>>> => {
      const service = getBoundSessionService()
      const rows = await service.history(params.sessionKey, params.limit)
      return {
        content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }],
        details: {},
      }
    },
  }
}
