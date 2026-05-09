import { Type } from '@sinclair/typebox'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { TOOL_OUTPUT_LIMIT } from '../../types.js'
import { getBoundSessionService, getCurrentToolSessionKey } from './runtime.js'
import { normalizePositiveIntegerLimit, stringifySessionToolOutput } from './output.js'

const DEFAULT_HISTORY_LIMIT = 20
const MAX_HISTORY_LIMIT = 200

const parameters = Type.Object({
  sessionKey: Type.String({
    minLength: 1,
    description: '目标会话的 session key。如需当前会话，可以传 current 或 __current__。',
  }),
  limit: Type.Optional(Type.Number({
    minimum: 1,
    maximum: MAX_HISTORY_LIMIT,
    default: DEFAULT_HISTORY_LIMIT,
    description: `返回最近 N 条消息。不传则取 ${DEFAULT_HISTORY_LIMIT}，最多 ${MAX_HISTORY_LIMIT}。`,
  })),
})

export function createSessionsHistoryTool(): AgentTool<typeof parameters> {
  return {
    name: 'sessions_history',
    label: '读取会话历史',
    description:
      '读取指定会话最近 N 条历史消息。' +
      `\n- limit 默认 ${DEFAULT_HISTORY_LIMIT} 条，最多 ${MAX_HISTORY_LIMIT} 条；` +
      '\n- 建议先用 sessions_list 查看可用会话 key；' +
      '\n- sessionKey 可传 current 或 __current__ 表示当前工具调用所在会话；' +
      `\n- 单次输出会被截断到 ${TOOL_OUTPUT_LIMIT} 字符以内，避免上下文爆炸。`,
    parameters,
    execute: async (_id, params): Promise<AgentToolResult<Record<string, never>>> => {
      const service = getBoundSessionService()
      let sessionKey = params.sessionKey
      if (sessionKey === 'current' || sessionKey === '__current__') {
        const currentSessionKey = getCurrentToolSessionKey()
        if (!currentSessionKey) {
          return {
            content: [{
              type: 'text',
              text: stringifySessionToolOutput({
                status: 'error',
                error: 'sessionKey="current" 不可用：当前没有绑定的运行时会话。请改传具体 session key。',
              }),
            }],
            details: {},
          }
        }
        sessionKey = currentSessionKey
      }

      const limit = normalizePositiveIntegerLimit(params.limit, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT)
      const rows = await service.history(sessionKey, limit)
      return {
        content: [{ type: 'text', text: stringifySessionToolOutput(rows) }],
        details: {},
      }
    },
  }
}
