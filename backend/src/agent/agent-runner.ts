/**
 * Simple Agent 运行器
 * 对应旧代码 src/agents2/agent-loop/
 * 使用 pi-agent-core 的 agentLoop 替代 LangGraph StateGraph
 */

import type { Model, Message } from '@mariozechner/pi-ai'
import { agentLoop, type AgentMessage, type AgentEvent } from '@mariozechner/pi-agent-core'
import type { SessionMode, SessionRouteContext, ThinkingLevel } from '@webclaw/shared'
import { buildSimpleSystemPrompt } from '../core/prompts/system-prompts.js'
import { createSimpleTools } from './tools/index.js'
import { mutateProviderPayload } from './provider-payload.js'
import { logProviderStreamEvent } from './provider-stream-debug.js'
import {
  createTracker,
  extractToolResultText,
  formatAgentFailureMessage,
  MAX_ITERATIONS,
  MAX_TOOL_FAILURES,
} from './types.js'
import { logger } from '../utils/logger.js'
import { ensureMemoryFiles, recordMemoryTurnAndMaybeFlush } from '../memory/index.js'

/** 记忆轮次计数状态（会话级） */
export interface TurnState {
  counter: number
}

/** Simple Agent 运行参数 */
export interface SimpleAgentOptions {
  messages: AgentMessage[]
  model: Model<'openai-completions'>
  apiKey: string
  thinkingLevel?: ThinkingLevel
  temperature?: number
  extraSystemPrompt?: string
  signal?: AbortSignal
  onEvent?: (event: AgentEvent) => void
  contextMessages?: AgentMessage[]
  turnState?: TurnState
  enableTools?: boolean
  route?: SessionRouteContext
  mode?: SessionMode
}

/** Simple Agent 运行结果 */
export interface SimpleAgentResult {
  messages: AgentMessage[]
}

/**
 * 运行 Simple Agent
 * 接收用户消息，通过 agentLoop 驱动 LLM 对话和工具调用
 */
export async function runSimpleAgent(options: SimpleAgentOptions): Promise<SimpleAgentResult> {
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
    turnState,
    enableTools = false,
  } = options
	
  await ensureMemoryFiles()
  const tools = enableTools ? createSimpleTools() : []
  const systemPrompt = await buildSimpleSystemPrompt({
    mode: options.mode ?? 'simple',
    route: options.route,
    modelId: model.id,
    thinkingLevel,
    tools,
    toolsEnabled: enableTools,
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

  const stream = agentLoop(
    messages,
    { systemPrompt, messages: contextMessages, tools },
    {
      model,
      apiKey,
      reasoning: thinkingLevel && thinkingLevel !== 'off' ? thinkingLevel : undefined,
      temperature,
      onPayload: (payload) => mutateProviderPayload(model, payload),
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

          forcedStopReason = reason
          logger.warn(`主 Agent 超限停止: ${reason}`)
          if (stopInstructionIssued) {
            abortController.abort()
            return []
          }
          stopInstructionIssued = true

          return [
            {
              role: 'user' as const,
              content: [{
                type: 'text' as const,
                text: `${reason}，请停止调用工具，基于已有信息总结回答。${lastToolError ? `最近一次工具错误：${lastToolError}` : ''}`,
              }],
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
      lastToolError = extractToolResultText(event.result)
    }

    // 收集消息
    if (event.type === 'message_end') {
      allMessages.push(event.message)
      if (event.message.role === 'assistant') {
        lastAssistantMessage = event.message as AgentMessage & { stopReason?: string; errorMessage?: string }
      }
    }

    // 转发事件给调用方（用于流式推送）
    logProviderStreamEvent(model, event)
    onEvent?.(event)
  }

  if (lastAssistantMessage?.stopReason === 'error' || lastAssistantMessage?.stopReason === 'aborted') {
    throw new Error(formatAgentFailureMessage(
      lastAssistantMessage.errorMessage ?? forcedStopReason ?? '主 Agent 执行失败',
      lastToolError,
    ))
  }

  const mergedMessages = [...contextMessages, ...allMessages]
  await recordMemoryTurnAndMaybeFlush(mergedMessages, turnState)
  return { messages: mergedMessages }
}
