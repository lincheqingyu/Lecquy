import { Type } from '@sinclair/typebox'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'

const parameters = Type.Object({
  prompt: Type.String({ minLength: 1 }),
})

export function createRequestUserInputTool(): AgentTool<typeof parameters> {
  return {
    name: 'request_user_input',
    label: '请求用户补充信息',
    description: '当缺少继续执行所必需的信息时调用。调用后应立即停止继续执行，等待系统恢复。',
    parameters,
    execute: async (_id, params): Promise<AgentToolResult<Record<string, never>>> => ({
      content: [{ type: 'text', text: JSON.stringify({ status: 'pause_requested', prompt: params.prompt }) }],
      details: {},
    }),
  }
}
