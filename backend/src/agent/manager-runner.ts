/**
 * Manager Agent 运行器
 */

import type { Model, Message } from '@mariozechner/pi-ai'
import { agentLoop, type AgentEvent, type AgentMessage } from '@mariozechner/pi-agent-core'
import type { ThinkingLevel } from '@webclaw/shared'
import { buildManagerPrompt } from '../core/prompts/system-prompts.js'
import { createManagerTools } from './tools/index.js'
import { createTracker, MAX_ITERATIONS, MAX_TOOL_FAILURES } from './types.js'
import type { TodoManager } from '../core/todo/todo-manager.js'
import { logger } from '../utils/logger.js'

export interface ManagerAgentOptions {
  messages: AgentMessage[]
  model: Model<'openai-completions'>
  apiKey: string
  thinkingLevel?: ThinkingLevel
  temperature?: number
  extraSystemPrompt?: string
  signal?: AbortSignal
  onEvent?: (event: AgentEvent) => void
  contextMessages?: AgentMessage[]
  todoManager: TodoManager
}

export interface ManagerAgentResult {
  messages: AgentMessage[]
  pause?: {
    prompt: string
  }
}

export async function runManagerAgent(options: ManagerAgentOptions): Promise<ManagerAgentResult> {
  const {
    messages,
    model,
    apiKey,
    thinkingLevel,
    temperature,
    extraSystemPrompt,
    signal,
    onEvent,
    contextMessages = [],
    todoManager,
  } = options

  const baseSystemPrompt = buildManagerPrompt()
  const systemPrompt = [baseSystemPrompt, extraSystemPrompt?.trim()]
    .filter((part): part is string => Boolean(part && part.length > 0))
    .join('\n\n')

  const tools = createManagerTools(todoManager)
  const tracker = createTracker()

  const abortController = new AbortController()
  const combinedSignal = signal
    ? AbortSignal.any([signal, abortController.signal])
    : abortController.signal

  const stream = agentLoop(
    messages,
    { systemPrompt, messages: contextMessages, tools },
    {
      model,
      apiKey,
      reasoning: thinkingLevel && thinkingLevel !== 'off' ? thinkingLevel : undefined,
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

          logger.warn(`Manager 超限停止: ${reason}`)
          abortController.abort()
          return [
            {
              role: 'user' as const,
              content: [{ type: 'text' as const, text: `${reason}，请停止调用工具并输出规划结果。` }],
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
  let pausePrompt: string | undefined

  for await (const event of stream) {
    if (event.type === 'turn_end') {
      tracker.iteration++
    }
    if (event.type === 'tool_execution_end' && event.isError) {
      tracker.toolFailCount++
    }

    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'toolcall_end') {
      const toolCall = (event.assistantMessageEvent as { toolCall?: { name?: string; arguments?: { prompt?: unknown } } }).toolCall
      if (toolCall?.name === 'request_user_input' && typeof toolCall.arguments?.prompt === 'string' && toolCall.arguments.prompt.trim()) {
        pausePrompt = toolCall.arguments.prompt.trim()
      }
    }

    if (event.type === 'message_end') {
      allMessages.push(event.message)
    }

    onEvent?.(event)
  }

  return {
    messages: [...contextMessages, ...allMessages],
    pause: pausePrompt ? { prompt: pausePrompt } : undefined,
  }
}
