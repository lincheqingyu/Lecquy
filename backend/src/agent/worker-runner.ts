/**
 * Worker Agent 运行器
 */

import type { Model, Message } from '@mariozechner/pi-ai'
import { agentLoop, type AgentEvent, type AgentMessage } from '@mariozechner/pi-agent-core'
import type { RunId, SessionRouteContext, ThinkingLevel } from '@lecquy/shared'
import type { WorkerReceipt } from '../core/prompts/prompt-layer-types.js'
import { resolveWorkspaceRoot } from '../core/runtime-paths.js'
import { buildWorkerPrompt } from '../core/prompts/system-prompts.js'
import { createWorkerTools } from './tools/index.js'
import {
  createPermissionAwareTools,
  type AgentRuntimeEvent,
} from './tool-permission.js'
import { getPermissionManager } from './permission-manager-registry.js'
import { mutateProviderPayload } from './provider-payload.js'
import { logProviderStreamEvent } from './provider-stream-debug.js'
import {
  AgentExecutionError,
  createTracker,
  extractToolResultText,
  formatAgentFailureMessage,
  MAX_SUB_ITERATIONS,
  MAX_SUB_TOOL_FAILURES,
} from './types.js'
import type { ConfirmationBroker } from '../runtime/confirmation-broker.js'

const MAX_CONSECUTIVE_FAILURES = 2

export interface WorkerRunOptions {
  todoId: string
  todoSnapshot: string
  systemPrompt: string
  memoryRecall?: AgentMessage[]
  model: Model<'openai-completions'>
  apiKey: string
  workspaceDir: string
  onEvent?: (event: AgentRuntimeEvent) => void
  signal?: AbortSignal
  sessionKey?: string
  sessionId?: string
  runId?: RunId
  confirmationBroker?: ConfirmationBroker
}

interface LegacyWorkerRunOptions {
  prompt: string
  model: Model<'openai-completions'>
  apiKey: string
  systemPromptOverride?: string
  thinkingLevel?: ThinkingLevel
  temperature?: number
  extraSystemPrompt?: string
  signal?: AbortSignal
  onEvent?: (event: AgentRuntimeEvent) => void
  route?: SessionRouteContext
  sessionKey?: string
  sessionId?: string
  runId?: RunId
  confirmationBroker?: ConfirmationBroker
}

interface NormalizedWorkerRunOptions {
  todoId: string
  todoSnapshot: string
  systemPrompt: string
  memoryRecall: AgentMessage[]
  model: Model<'openai-completions'>
  apiKey: string
  workspaceDir: string
  onEvent?: (event: AgentRuntimeEvent) => void
  signal?: AbortSignal
  thinkingLevel?: ThinkingLevel
  temperature?: number
  sessionKey?: string
  sessionId?: string
  runId?: RunId
  confirmationBroker?: ConfirmationBroker
}

export interface WorkerResult {
  receipt: WorkerReceipt
  messages: AgentMessage[]
  pause?: {
    prompt: string
  }
}

export type WorkerAgentOptions = WorkerRunOptions | LegacyWorkerRunOptions
export type WorkerAgentResult = WorkerResult

function isLegacyWorkerOptions(options: WorkerAgentOptions): options is LegacyWorkerRunOptions {
  return 'prompt' in options
}

function createWorkerUserMessage(todoSnapshot: string): AgentMessage {
  return {
    role: 'user' as const,
    content: todoSnapshot,
    timestamp: Date.now(),
  }
}

function extractMessageText(message: AgentMessage | null | undefined): string {
  if (!message || !('content' in message)) {
    return ''
  }

  const { content } = message
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
}

function buildBlockedReceipt(validation: string, nextHint: string): WorkerReceipt {
  return {
    result: 'blocked',
    validation,
    nextHint,
  }
}

async function normalizeWorkerRunOptions(options: WorkerAgentOptions): Promise<NormalizedWorkerRunOptions> {
  if (!isLegacyWorkerOptions(options)) {
    return {
      ...options,
      memoryRecall: options.memoryRecall ?? [],
    }
  }

  const tools = createWorkerTools()
  const systemPrompt = options.systemPromptOverride ?? await buildWorkerPrompt({
    mode: 'plan',
    route: options.route,
    modelId: options.model.id,
    thinkingLevel: options.thinkingLevel,
    tools,
    extraInstructions: options.extraSystemPrompt,
  })

  return {
    todoId: 'legacy-worker-task',
    todoSnapshot: options.prompt,
    systemPrompt,
    memoryRecall: [],
    model: options.model,
    apiKey: options.apiKey,
    workspaceDir: resolveWorkspaceRoot(),
    onEvent: options.onEvent,
    signal: options.signal,
    thinkingLevel: options.thinkingLevel,
    temperature: options.temperature,
    sessionKey: options.sessionKey,
    sessionId: options.sessionId,
    runId: options.runId,
    confirmationBroker: options.confirmationBroker,
  }
}

export async function runWorkerAgent(options: WorkerAgentOptions): Promise<WorkerResult> {
  const normalized = await normalizeWorkerRunOptions(options)
  const rawTools = createWorkerTools()
  const layeredPermissionEnabled = process.env.LAYERED_PROMPT === 'true'
  const tracker = createTracker()
  let forcedStopReason: string | undefined
  let stopInstructionIssued = false
  let lastToolError: string | undefined
  let lastAssistantMessage: (AgentMessage & { stopReason?: string; errorMessage?: string }) | null = null
  let lastAssistantText = ''
  let pausePrompt: string | undefined
  let consecutiveFailures = 0
  let failureBlocked = false

  const abortController = new AbortController()
  const combinedSignal = normalized.signal
    ? AbortSignal.any([normalized.signal, abortController.signal])
    : abortController.signal

  const permissionManager = await getPermissionManager(normalized.workspaceDir)
  const tools = createPermissionAwareTools(rawTools, {
    role: 'worker',
    workspaceDir: normalized.workspaceDir,
    enabled: layeredPermissionEnabled,
    sessionKey: normalized.sessionKey,
    sessionId: normalized.sessionId,
    runId: normalized.runId,
    broker: normalized.confirmationBroker,
    manager: permissionManager,
    onEvent: normalized.onEvent,
  })

  const promptMessages: AgentMessage[] = [
    ...normalized.memoryRecall,
    createWorkerUserMessage(normalized.todoSnapshot),
  ]

  const stream = agentLoop(
    promptMessages,
    { systemPrompt: normalized.systemPrompt, messages: [], tools },
    {
      model: normalized.model,
      apiKey: normalized.apiKey,
      reasoning: normalized.thinkingLevel && normalized.thinkingLevel !== 'off'
        ? normalized.thinkingLevel
        : undefined,
      temperature: normalized.temperature,
      onPayload: (payload) => mutateProviderPayload(normalized.model, payload),
      convertToLlm: (messages: AgentMessage[]) =>
        messages.filter(
          (message): message is Message =>
            message.role === 'user' || message.role === 'assistant' || message.role === 'toolResult',
        ),
      getSteeringMessages: async () => {
        if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          failureBlocked = true
          forcedStopReason = `连续失败 ${MAX_CONSECUTIVE_FAILURES} 次`
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
                text: `${forcedStopReason}，请停止继续调用工具，并说明当前阻塞原因。${lastToolError ? `最近一次工具错误：${lastToolError}` : ''}`,
              }],
              timestamp: Date.now(),
            },
          ]
        }

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
              content: [{
                type: 'text' as const,
                text: `${forcedStopReason}，请停止调用工具并输出执行摘要。${lastToolError ? `最近一次工具错误：${lastToolError}` : ''}`,
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

  const messages: AgentMessage[] = [...promptMessages]

  for await (const event of stream) {
    if (event.type === 'turn_end') {
      tracker.iteration++
    }

    if (event.type === 'tool_execution_end') {
      if (event.isError) {
        tracker.toolFailCount++
        consecutiveFailures++
        lastToolError = extractToolResultText(event.result)
      } else {
        consecutiveFailures = 0
      }
    }

    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'toolcall_end') {
      const toolCall = (event.assistantMessageEvent as {
        toolCall?: { name?: string; arguments?: { prompt?: unknown } }
      }).toolCall
      if (
        toolCall?.name === 'request_user_input'
        && typeof toolCall.arguments?.prompt === 'string'
        && toolCall.arguments.prompt.trim()
      ) {
        pausePrompt = toolCall.arguments.prompt.trim()
      }
    }

    if (event.type === 'message_end') {
      messages.push(event.message)
      if (event.message.role === 'assistant') {
        lastAssistantMessage = event.message as AgentMessage & {
          stopReason?: string
          errorMessage?: string
        }
        const assistantText = extractMessageText(event.message).trim()
        if (assistantText) {
          lastAssistantText = assistantText
        }
      }
    }

    logProviderStreamEvent(normalized.model, event)
    normalized.onEvent?.(event as AgentEvent)
  }

  if (failureBlocked) {
    return {
      receipt: buildBlockedReceipt(
        `连续失败 ${MAX_CONSECUTIVE_FAILURES} 次`,
        '建议拆分',
      ),
      messages,
      pause: pausePrompt ? { prompt: pausePrompt } : undefined,
    }
  }

  if (lastAssistantMessage?.stopReason === 'error' || lastAssistantMessage?.stopReason === 'aborted') {
    throw new AgentExecutionError(formatAgentFailureMessage(
      lastAssistantMessage.errorMessage ?? forcedStopReason ?? '子任务执行失败',
      lastToolError,
    ), {
      messages,
      stopReason: lastAssistantMessage.stopReason,
    })
  }

  return {
    receipt: {
      result: lastAssistantText || '(Worker 未返回文本)',
      validation: pausePrompt ? '等待用户补充信息' : '执行完成',
    },
    messages,
    pause: pausePrompt ? { prompt: pausePrompt } : undefined,
  }
}
