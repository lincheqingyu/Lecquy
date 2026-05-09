import { Type } from '@sinclair/typebox'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { TOOL_OUTPUT_LIMIT } from '../../types.js'
import { getBoundSessionService } from './runtime.js'
import {
  normalizeNonNegativeIntegerLimit,
  normalizePositiveIntegerLimit,
  stringifySessionToolOutput,
} from './output.js'

const DEFAULT_LIST_LIMIT = 20
const MAX_LIST_LIMIT = 200
const DEFAULT_MESSAGE_LIMIT = 0
const MAX_MESSAGE_LIMIT = 50

const parameters = Type.Object({
  limit: Type.Optional(Type.Number({
    minimum: 1,
    maximum: MAX_LIST_LIMIT,
    default: DEFAULT_LIST_LIMIT,
    description: `返回最近 N 个会话。不传则取 ${DEFAULT_LIST_LIMIT}。`,
  })),
  activeMinutes: Type.Optional(Type.Number({ minimum: 1 })),
  messageLimit: Type.Optional(Type.Number({
    minimum: 0,
    maximum: MAX_MESSAGE_LIMIT,
    default: DEFAULT_MESSAGE_LIMIT,
    description: `每个会话附带最近 N 条消息。默认为 ${DEFAULT_MESSAGE_LIMIT}，最多 ${MAX_MESSAGE_LIMIT}。`,
  })),
})

export function createSessionsListTool(): AgentTool<typeof parameters> {
  return {
    name: 'sessions_list',
    label: '列出会话',
    description:
      '列出最近会话，可选附带最近消息。' +
      `\n- limit 默认 ${DEFAULT_LIST_LIMIT} 个；` +
      '\n- messageLimit 默认为 0，只有需要定位内容时才附带消息；' +
      `\n- 单次输出会被截断到 ${TOOL_OUTPUT_LIMIT} 字符以内，避免上下文爆炸。`,
    parameters,
    execute: async (_id, params): Promise<AgentToolResult<Record<string, never>>> => {
      const service = getBoundSessionService()
      const rows = await service.listSessions({
        ...params,
        limit: normalizePositiveIntegerLimit(params.limit, DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT),
        messageLimit: normalizeNonNegativeIntegerLimit(params.messageLimit, DEFAULT_MESSAGE_LIMIT, MAX_MESSAGE_LIMIT),
      })
      return {
        content: [{ type: 'text', text: stringifySessionToolOutput(rows) }],
        details: {},
      }
    },
  }
}
