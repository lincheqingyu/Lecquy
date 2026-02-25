/**
 * 子 Agent 运行器
 * 对应旧代码 src/agents2/sub-agent/
 */

import type { Model, Message } from '@mariozechner/pi-ai'
import { agentLoop, type AgentMessage } from '@mariozechner/pi-agent-core'
import { AGENT_TYPES } from '../core/agent/agent-config.js'
import { buildSubAgentPrompt } from '../core/prompts/system-prompts.js'
import { TODO, type TodoItem } from '../core/todo/todo-manager.js'
import { createSubAgentTools } from './tools/index.js'
import {
  createTracker,
  MAX_SUB_ITERATIONS,
  MAX_SUB_TOOL_FAILURES,
  type IterationTracker,
} from './types.js'

/** 子 Agent 运行参数 */
export interface SubAgentParams {
  description: string
  prompt: string
  agentType: string
  model: Model<'openai-completions'>
  apiKey: string
  signal?: AbortSignal
}

/**
 * 运行子 Agent，返回最终文本结果
 */
export async function runSubAgent(params: SubAgentParams): Promise<string> {
  const { description, prompt, agentType, model, apiKey, signal } = params

  if (!(agentType in AGENT_TYPES)) {
    return `错误：未知的代理类型 '${agentType}'`
  }

  const config = AGENT_TYPES[agentType]
  const systemPrompt = buildSubAgentPrompt(agentType, config.prompt, prompt)
  const tools = createSubAgentTools()
  const tracker = createTracker()

  const abortController = new AbortController()
  const combinedSignal = signal
    ? AbortSignal.any([signal, abortController.signal])
    : abortController.signal

  const userMessage: AgentMessage = {
    role: 'user' as const,
    content: [{ type: 'text' as const, text: prompt }],
    timestamp: Date.now(),
  }

  const stream = agentLoop(
    [userMessage],
    { systemPrompt, messages: [], tools },
    {
      model,
      apiKey,
      convertToLlm: (messages: AgentMessage[]) =>
        messages.filter(
          (m): m is Message => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult',
        ),
      getSteeringMessages: async () => {
        if (
          tracker.iteration >= MAX_SUB_ITERATIONS ||
          tracker.toolFailCount >= MAX_SUB_TOOL_FAILURES
        ) {
          abortController.abort()
          return [
            {
              role: 'user' as const,
              content: [
                {
                  type: 'text' as const,
                  text: `已达到最大迭代次数(${MAX_SUB_ITERATIONS}次)，请停止调用工具，基于已有信息总结回答。`,
                },
              ],
              timestamp: Date.now(),
            },
          ]
        }
        return []
      },
    },
    combinedSignal,
  )

  let lastAssistantText = ''

  for await (const event of stream) {
    if (event.type === 'turn_end') {
      tracker.iteration++
    }
    if (event.type === 'tool_execution_end' && event.isError) {
      tracker.toolFailCount++
    }
    if (event.type === 'message_end' && 'role' in event.message && event.message.role === 'assistant') {
      const textParts = (event.message.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text!)
      if (textParts.length > 0) {
        lastAssistantText = textParts.join('\n')
      }
    }
  }

  return lastAssistantText || '(子代理未返回文本)'
}

/**
 * 逐条执行 pending todo items
 * 使用指定的 model 和 apiKey
 */
export async function* runPendingTodosWithModel(
  model: Model<'openai-completions'>,
  apiKey: string,
): AsyncGenerator<[number, TodoItem, string]> {
  while (true) {
    const pending = TODO.getPending()
    if (pending === null) break

    const [idx, item] = pending
    TODO.markInProgress(idx)

    try {
      const result = await runSubAgent({
        description: item.content.slice(0, 50),
        prompt: item.content,
        agentType: 'query',
        model,
        apiKey,
      })
      TODO.markCompleted(idx)
      yield [idx, item, result]
    } catch (error) {
      TODO.markCompleted(idx)
      yield [idx, item, `执行失败: ${error instanceof Error ? error.message : String(error)}`]
    }
  }
}
