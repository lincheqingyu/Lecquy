/**
 * 主 Agent 运行器
 * 对应旧代码 src/agents2/agent-loop/
 * 使用 pi-agent-core 的 agentLoop 替代 LangGraph StateGraph
 */

import type { Model, Message } from '@mariozechner/pi-ai'
import { agentLoop, type AgentMessage, type AgentEvent } from '@mariozechner/pi-agent-core'
import { buildMainSystemPrompt } from '../core/prompts/system-prompts.js'
import { createAgentTools } from './tools/index.js'
import { runPendingTodosWithModel } from './sub-agent-runner.js'
import { createTracker, MAX_ITERATIONS, MAX_TOOL_FAILURES } from './types.js'
import { logger } from '../utils/logger.js'

/** 主 Agent 运行参数 */
export interface MainAgentOptions {
  messages: AgentMessage[]
  model: Model<'openai-completions'>
  apiKey: string
  temperature?: number
  signal?: AbortSignal
  onEvent?: (event: AgentEvent) => void
}

/** 主 Agent 运行结果 */
export interface MainAgentResult {
  messages: AgentMessage[]
}

/**
 * 运行主 Agent
 * 接收用户消息，通过 agentLoop 驱动 LLM 对话和工具调用
 */
export async function runMainAgent(options: MainAgentOptions): Promise<MainAgentResult> {
  const { messages, model, apiKey, temperature, signal, onEvent } = options

  const systemPrompt = buildMainSystemPrompt()
  const tools = createAgentTools()
  const tracker = createTracker()

  const abortController = new AbortController()
  const combinedSignal = signal
    ? AbortSignal.any([signal, abortController.signal])
    : abortController.signal

  const stream = agentLoop(
    messages,
    { systemPrompt, messages: [], tools },
    {
      model,
      apiKey,
      temperature,
      convertToLlm: (agentMessages: AgentMessage[]) =>
        agentMessages.filter(
          (m): m is Message => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult',
        ),
      getSteeringMessages: async () => {
        if (
          tracker.iteration >= MAX_ITERATIONS ||
          tracker.toolFailCount >= MAX_TOOL_FAILURES
        ) {
          const reason = tracker.iteration >= MAX_ITERATIONS
            ? `已达到最大迭代次数(${MAX_ITERATIONS}次)`
            : `工具连续失败次数过多(${MAX_TOOL_FAILURES}次)`

          logger.warn(`主 Agent 超限停止: ${reason}`)

          // 安全保障：防止 LLM 忽略停止指令
          abortController.abort()

          return [
            {
              role: 'user' as const,
              content: [{ type: 'text' as const, text: `${reason}，请停止调用工具，基于已有信息总结回答。` }],
              timestamp: Date.now(),
            },
          ]
        }
        return []
      },
    },
    combinedSignal,
  )

  const allMessages: AgentMessage[] = []

  for await (const event of stream) {
    // 迭代跟踪
    if (event.type === 'turn_end') {
      tracker.iteration++
    }
    if (event.type === 'tool_execution_end' && event.isError) {
      tracker.toolFailCount++
    }

    // todo_write 自动执行 pending items
    if (
      event.type === 'tool_execution_end' &&
      event.toolName === 'todo_write' &&
      !event.isError
    ) {
      const result = event.result as { details?: { hasPending?: boolean } }
      if (result?.details?.hasPending) {
        try {
          for await (const [idx, item, subResult] of runPendingTodosWithModel(model, apiKey)) {
            logger.info(`Todo #${idx} (${item.content.slice(0, 30)}) 完成`)
            logger.debug(`子 Agent 结果: ${subResult.slice(0, 200)}`)
          }
        } catch (error) {
          logger.error('自动执行 pending todos 失败:', error)
        }
      }
    }

    // 收集消息
    if (event.type === 'message_end') {
      allMessages.push(event.message)
    }

    // 转发事件给调用方（用于流式推送）
    onEvent?.(event)
  }

  return { messages: allMessages }
}
