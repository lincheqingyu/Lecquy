/**
 * TodoWrite 工具 — 更新任务列表
 */

import { Type } from '@sinclair/typebox'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { TODO } from '../../core/todo/todo-manager.js'

/** todo_write 工具的 details 类型 */
export interface TodoWriteDetails {
  hasPending: boolean
}

/** 创建 todo_write 工具 */
export function createTodoWriteTool(): AgentTool<typeof parameters, TodoWriteDetails> {
  return {
    name: 'todo_write',
    label: '更新任务列表',
    description: '更新任务列表。每个 item 需包含 content、status、activeForm 字段。',
    parameters,
    execute: async (_toolCallId, params): Promise<AgentToolResult<TodoWriteDetails>> => {
      try {
        const rendered = TODO.update(params.items)
        const hasPending = TODO.getPending() !== null
        return {
          content: [{ type: 'text', text: rendered }],
          details: { hasPending },
        }
      } catch (error) {
        const text = `错误: ${error instanceof Error ? error.message : String(error)}`
        return {
          content: [{ type: 'text', text }],
          details: { hasPending: false },
        }
      }
    },
  }
}

const todoItemSchema = Type.Object({
  content: Type.String({ description: '任务内容' }),
  status: Type.Optional(Type.String({ description: '任务状态', default: 'pending' })),
  activeForm: Type.Optional(Type.String({ description: "进行中的展示文本，如'正在查询数据'", default: '' })),
})

const parameters = Type.Object({
  items: Type.Array(todoItemSchema, { description: '任务项列表' }),
})
