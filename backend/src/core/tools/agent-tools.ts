/**
 * 代理工具定义
 * 对应源码: core/tools/agent_tools.py
 */

import { tool } from '@langchain/core/tools'
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { z } from 'zod'

import { SKILLS } from '../skills/skill-loader.js'
import { TODO, type TodoItem } from '../todo/todo-manager.js'
import { AGENT_TYPES } from '../agent/agent-config.js'
import { buildSubAgentPrompt } from '../prompts/system-prompts.js'
import { createToolResult, type ToolResult } from './tool-result.js'
import type { SubAgentState } from '../../agents/sub-agent/state.js'

/** 模块级变量，由 execute_tools 在调用前设置，供 task 获取当前已激活的 skill names */
let _currentSkillNames: string[] = []

/** 设置当前 skill names */
export function setCurrentSkillNames(names: string[]): void {
  _currentSkillNames = names ?? []
}

/** 获取当前 skill names */
export function getCurrentSkillNames(): string[] {
  return _currentSkillNames
}

/** 内部子代理分发器（不暴露给模型） */
export async function task(
  description: string,
  prompt: string,
  agentType: string,
): Promise<string> {
  if (!(agentType in AGENT_TYPES)) {
    return `错误：未知的代理类型 '${agentType}'`
  }

  // 延迟导入避免循环依赖
  const { createSubGraph } = await import('../../agents/sub-agent/graph.js')
  const subGraph = createSubGraph()

  const config = AGENT_TYPES[agentType]
  const subSystem = buildSubAgentPrompt(agentType, config.prompt, prompt)

  const messages = [
    new SystemMessage(subSystem),
    new HumanMessage(prompt),
  ]

  const initialState: SubAgentState = {
    messages,
    iteration: 0,
    maxIterations: 8,
    toolFailCount: 0,
    description,
    extraToolNames: [...config.defaultSkills],
  }

  const runConfig = {
    tags: ['sub_agent'],
    metadata: { description },
  }

  let finalContent = ''
  for await (const event of subGraph.streamEvents(initialState, {
    ...runConfig,
    version: 'v2',
  })) {
    if (event.event === 'on_chat_model_end') {
      const aiMsg = event.data?.output
      if (aiMsg && typeof aiMsg.content === 'string' && aiMsg.content) {
        finalContent = aiMsg.content
      }
    }
  }

  return finalContent || '(子代理未返回文本)'
}

/** 为一个 todo item 创建子代理并执行 */
async function executeTodoItem(item: TodoItem): Promise<string> {
  return task(item.content.slice(0, 50), item.content, 'query')
}

/** 逐条执行 pending todo items */
export async function* runPendingTodos(): AsyncGenerator<
  [number, TodoItem, string]
> {
  while (true) {
    const pending = TODO.getPending()
    if (pending === null) break

    const [idx, item] = pending
    TODO.markInProgress(idx)

    try {
      const result = await executeTodoItem(item)
      TODO.markCompleted(idx)
      yield [idx, item, result]
    } catch (error) {
      TODO.markCompleted(idx)
      yield [idx, item, `执行失败: ${error instanceof Error ? error.message : String(error)}`]
    }
  }
}

/** 加载技能工具 */
export const skill = tool(
  async ({ skill_name }: { skill_name: string }): Promise<ToolResult | string> => {
    const content = SKILLS.getSkillContent(skill_name)
    if (content === null) {
      const available = SKILLS.listSkills().join(', ') || '无'
      return `错误：未知技能 '${skill_name}'。可用：${available}`
    }

    const wrappedContent = `<skill-loaded name="${skill_name}">
${content}
</skill-loaded>

按照上面技能中的指令完成用户的任务。`

    return createToolResult(wrappedContent, '')
  },
  {
    name: 'skill',
    description: '加载技能以获得任务的专业知识。技能内容将被注入到对话中。',
    schema: z.object({
      skill_name: z.string().describe('技能名称'),
    }),
  },
)

/** TodoItem 输入 schema */
const todoItemSchema = z.object({
  content: z.string().describe('任务内容'),
  status: z.string().default('pending').describe('任务状态'),
  activeForm: z.string().default('').describe("进行中的展示文本，如'正在查询数据'"),
})

/** 更新任务列表工具 */
export const todoWrite = tool(
  async ({ items }: { items: z.infer<typeof todoItemSchema>[] }): Promise<string> => {
    try {
      return TODO.update(items)
    } catch (error) {
      return `错误: ${error instanceof Error ? error.message : String(error)}`
    }
  },
  {
    name: 'todo_write',
    description: '更新任务列表。每个 item 需包含 content、status、activeForm 字段。',
    schema: z.object({
      items: z.array(todoItemSchema).describe('任务项列表'),
    }),
  },
)
