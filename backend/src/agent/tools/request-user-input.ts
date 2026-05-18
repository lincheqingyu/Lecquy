// 中文：本文件（request-user-input.ts）位于 backend/src/agent/tools/request-user-input.ts，属于backend链路中的agent 编排与工具链代码，连接上游调用方与下游执行逻辑。
// English: This file (request-user-input.ts) belongs to the backend agent 编排与工具链 layer in backend/src/agent/tools/request-user-input.ts, wiring upstream callers with downstream runtime logic.

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
