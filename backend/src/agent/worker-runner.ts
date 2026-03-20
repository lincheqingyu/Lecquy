/**
 * Worker Agent 运行器
 */

import type { Model, Message } from '@mariozechner/pi-ai'
import { agentLoop, type AgentEvent, type AgentMessage } from '@mariozechner/pi-agent-core'
import type { SessionRouteContext, ThinkingLevel } from '@webclaw/shared'
import { buildWorkerPrompt } from '../core/prompts/system-prompts.js'
import { createWorkerTools } from './tools/index.js'
import { mutateProviderPayload } from './provider-payload.js'
import { logProviderStreamEvent } from './provider-stream-debug.js'
import {
  createTracker,
  extractToolResultText,
  formatAgentFailureMessage,
  MAX_SUB_ITERATIONS,
  MAX_SUB_TOOL_FAILURES,
} from './types.js'

export interface WorkerAgentOptions {
  prompt: string
  model: Model<'openai-completions'>
  apiKey: string
  thinkingLevel?: ThinkingLevel
  temperature?: number
  extraSystemPrompt?: string
  signal?: AbortSignal
  onEvent?: (event: AgentEvent) => void
  route?: SessionRouteContext
}

export interface WorkerAgentResult {
  result: string
  pause?: {
    prompt: string
  }
}

export async function runWorkerAgent(options: WorkerAgentOptions): Promise<WorkerAgentResult> {
  const { prompt, model, apiKey, thinkingLevel, temperature, extraSystemPrompt, signal, onEvent } = options

  const tools = createWorkerTools()
  const systemPrompt = await buildWorkerPrompt({
    mode: 'plan',
    route: options.route,
    modelId: model.id,
    thinkingLevel,
    tools,
    extraInstructions: extraSystemPrompt,
  })
  const tracker = createTracker()
  let forcedStopReason: string | undefined
  let stopInstructionIssued = false
  let lastToolError: string | undefined
  let lastAssistantMessage: (AgentMessage & { stopReason?: string; errorMessage?: string }) | null = null

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
      reasoning: thinkingLevel && thinkingLevel !== 'off' ? thinkingLevel : undefined,
      temperature,
      onPayload: (payload) => mutateProviderPayload(model, payload),
      convertToLlm: (messages: AgentMessage[]) =>
        messages.filter(
          (m): m is Message => m.role === 'user' || m.role === 'assistant' || m.role === 'toolResult',
        ),
      getSteeringMessages: async () => {
        if (
          tracker.iteration >= MAX_SUB_ITERATIONS ||
          tracker.toolFailCount >= MAX_SUB_TOOL_FAILURES
        ) {
          forcedStopReason = tracker.iteration >= MAX_SUB_ITERATIONS
            ? `已达到最大迭代次数(${MAX_SUB_ITERATIONS}次)`
            : `工具连续失败次数过多(${MAX_SUB_TOOL_FAILURES}次)`
          if (stopInstructionIssued) {
            abortController.abort()
            return []
          }
          stopInstructionIssued = true
          return [
            {
              role: 'user' as const,
              content: [
                {
                  type: 'text' as const,
                  text: `${forcedStopReason}，请停止调用工具并输出执行摘要。${lastToolError ? `最近一次工具错误：${lastToolError}` : ''}`,
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
  let pausePrompt: string | undefined

  for await (const event of stream) {
    if (event.type === 'turn_end') {
      tracker.iteration++
    }
    if (event.type === 'tool_execution_end' && event.isError) {
      tracker.toolFailCount++
      lastToolError = extractToolResultText(event.result)
    }
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'toolcall_end') {
      const toolCall = (event.assistantMessageEvent as { toolCall?: { name?: string; arguments?: { prompt?: unknown } } }).toolCall
      if (toolCall?.name === 'request_user_input' && typeof toolCall.arguments?.prompt === 'string' && toolCall.arguments.prompt.trim()) {
        pausePrompt = toolCall.arguments.prompt.trim()
      }
    }
    if (event.type === 'message_end' && event.message.role === 'assistant') {
      lastAssistantMessage = event.message as AgentMessage & { stopReason?: string; errorMessage?: string }
      const textParts = (event.message.content as Array<{ type: string; text?: string }>)
        .filter((c) => c.type === 'text' && c.text)
        .map((c) => c.text!)
      if (textParts.length > 0) {
        lastAssistantText = textParts.join('\n')
      }
    }

    logProviderStreamEvent(model, event)
    onEvent?.(event)
  }

  if (lastAssistantMessage?.stopReason === 'error' || lastAssistantMessage?.stopReason === 'aborted') {
    throw new Error(formatAgentFailureMessage(
      lastAssistantMessage.errorMessage ?? forcedStopReason ?? '子任务执行失败',
      lastToolError,
    ))
  }

  return {
    result: lastAssistantText || '(Worker 未返回文本)',
    pause: pausePrompt ? { prompt: pausePrompt } : undefined,
  }
}
