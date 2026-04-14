/**
 * Manager Agent 运行器
 */

import type { Model, Message } from '@mariozechner/pi-ai'
import { agentLoop, type AgentEvent, type AgentMessage } from '@mariozechner/pi-agent-core'
import type { SessionRouteContext, ThinkingLevel } from '@lecquy/shared'
import { resolveWorkspaceRoot } from '../core/runtime-paths.js'
import { buildManagerPrompt } from '../core/prompts/system-prompts.js'
import type { WorkerReceipt } from '../core/prompts/prompt-layer-types.js'
import { createManagerTools } from './tools/index.js'
import { createPermissionAwareTools, type AgentRuntimeEvent, type ConfirmRequiredEvent } from './tool-permission.js'
import { mutateProviderPayload } from './provider-payload.js'
import { logProviderStreamEvent } from './provider-stream-debug.js'
import {
  AgentExecutionError,
  createTracker,
  extractToolResultText,
  formatAgentFailureMessage,
  MAX_ITERATIONS,
  MAX_TOOL_FAILURES,
} from './types.js'
import type { TodoManager } from '../core/todo/todo-manager.js'
import { logger } from '../utils/logger.js'

export interface ManagerAgentOptions {
  messages: AgentMessage[]
  model: Model<'openai-completions'>
  apiKey: string
  systemPromptOverride?: string
  thinkingLevel?: ThinkingLevel
  temperature?: number
  extraSystemPrompt?: string
  signal?: AbortSignal
  onEvent?: (event: AgentRuntimeEvent) => void
  contextMessages?: AgentMessage[]
  todoManager: TodoManager
  route?: SessionRouteContext
}

export interface ManagerAgentResult {
  messages: AgentMessage[]
  pause?: {
    prompt: string
  }
}

export type ManagerDecision =
  | { action: 'complete'; todoId: string; nextHint?: string }
  | { action: 'retry_with_change'; todoId: string; newPrompt: string }
  | { action: 'split'; todoId: string; subTodos: string[] }
  | { action: 'block'; todoId: string; reason: string }

export function handleWorkerReceipt(receipt: WorkerReceipt, todoId: string): ManagerDecision {
  const normalizedValidation = receipt.validation.trim()
  const normalizedHint = receipt.nextHint?.trim()

  if (receipt.result === 'blocked') {
    if (normalizedHint?.includes('拆分') || normalizedValidation.includes('连续失败')) {
      return { action: 'split', todoId, subTodos: [] }
    }
    if (normalizedHint?.startsWith('retry:')) {
      return {
        action: 'retry_with_change',
        todoId,
        newPrompt: normalizedHint.slice('retry:'.length).trim(),
      }
    }
    return {
      action: 'block',
      todoId,
      reason: normalizedValidation || 'worker 被阻塞',
    }
  }

  return {
    action: 'complete',
    todoId,
    nextHint: normalizedHint,
  }
}

/**
 * Manager Agent
 *
 * 权限等级：仅 auto 档为主，工具集经过白名单过滤。
 * 工具集：read_file, skill, todo_write, request_user_input, session 查询工具
 * 禁止：bash, write_file, edit_file, sessions_spawn
 * 不直接执行高风险副作用，所有高风险操作应回交给 worker 或用户确认。
 */
export async function runManagerAgent(options: ManagerAgentOptions): Promise<ManagerAgentResult> {
  const {
    messages,
    model,
    apiKey,
    systemPromptOverride,
    thinkingLevel,
    temperature,
    extraSystemPrompt,
    signal,
    onEvent,
    contextMessages = [],
    todoManager,
  } = options

  const workspaceDir = resolveWorkspaceRoot()
  const rawTools = createManagerTools(todoManager)
  const layeredPermissionEnabled = process.env.LAYERED_PROMPT === 'true'
  let pendingConfirmEvent: ConfirmRequiredEvent | undefined
  const tools = createPermissionAwareTools(rawTools, {
    role: 'manager',
    workspaceDir,
    enabled: layeredPermissionEnabled,
    onEvent: (event) => {
      if (event.type === 'confirm_required') {
        pendingConfirmEvent = event
      }
      onEvent?.(event)
    },
  })
  const systemPrompt = systemPromptOverride ?? await buildManagerPrompt({
    mode: 'plan',
    route: options.route,
    modelId: model.id,
    thinkingLevel,
    tools: rawTools,
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
        if (pendingConfirmEvent) {
          logger.warn('Manager 命中 confirm 档工具，已停止继续执行', {
            toolName: pendingConfirmEvent.toolName,
          })
          if (stopInstructionIssued) {
            abortController.abort()
            return []
          }
          stopInstructionIssued = true
          forcedStopReason = pendingConfirmEvent.description
          return [
            {
              role: 'user' as const,
              content: [{
                type: 'text' as const,
                text: `刚才的操作需要用户确认：${pendingConfirmEvent.toolName}。请停止继续调用工具，只输出规划结论或待确认事项。`,
              }],
              timestamp: Date.now(),
            },
          ]
        }

        if (
          tracker.iteration >= MAX_ITERATIONS ||
          tracker.toolFailCount >= MAX_TOOL_FAILURES
        ) {
          const reason = tracker.iteration >= MAX_ITERATIONS
            ? `已达到最大迭代次数(${MAX_ITERATIONS}次)`
            : `工具连续失败次数过多(${MAX_TOOL_FAILURES}次)`

          forcedStopReason = reason
          logger.warn(`Manager 超限停止: ${reason}`)
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
                text: `${reason}，请停止调用工具并输出规划结果。${lastToolError ? `最近一次工具错误：${lastToolError}` : ''}`,
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

    if (event.type === 'message_end') {
      allMessages.push(event.message)
      if (event.message.role === 'assistant') {
        lastAssistantMessage = event.message as AgentMessage & { stopReason?: string; errorMessage?: string }
      }
    }

    logProviderStreamEvent(model, event)
    onEvent?.(event as AgentEvent)
  }

  const mergedMessages = [...contextMessages, ...allMessages]

  if (lastAssistantMessage?.stopReason === 'error' || lastAssistantMessage?.stopReason === 'aborted') {
    throw new AgentExecutionError(formatAgentFailureMessage(
      lastAssistantMessage.errorMessage ?? forcedStopReason ?? '计划生成失败',
      lastToolError,
    ), {
      messages: mergedMessages,
      stopReason: lastAssistantMessage.stopReason,
    })
  }

  return {
    messages: mergedMessages,
    pause: pausePrompt ? { prompt: pausePrompt } : undefined,
  }
}
