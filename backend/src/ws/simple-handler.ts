/**
 * WS Simple 模式处理器
 */

import type { WebSocket } from 'ws'
import { createVllmModel } from '../agent/vllm-model.js'
import { runSimpleAgent } from '../agent/index.js'
import { isCoreAgentEvent } from '../agent/tool-permission.js'
import type { SessionRuntimeState } from '../session-v2/index.js'
import type { SessionService } from '../session-v2/index.js'
import { getConfig } from '../config/index.js'
import { normalizeIncomingMessages } from '../agent/message-utils.js'
import { forwardAgentEvent, sendEvent } from './event-sender.js'
import { z } from 'zod'
import { chatRequestSchema } from '../types/api.js'
import { logger } from '../utils/logger.js'
import { clearCurrentToolSessionKey, setCurrentToolSessionKey } from '../agent/tools/session-tools/index.js'

type ChatPayload = z.infer<typeof chatRequestSchema>

function extractLastAssistantText(messages: readonly { role: string; content: unknown }[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'assistant')
  if (!last) return ''
  const content = last.content as Array<{ type: string; text?: string }> | string
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((c) => c.type === 'text' && c.text)
    .map((c) => c.text!)
    .join('\n')
}

function summarizeAssistantContent(content: unknown): string {
  if (typeof content === 'string') return content.slice(0, 300)
  if (!Array.isArray(content)) return ''
  return content
    .filter((c) => c && typeof c === 'object' && (c as { type?: string }).type === 'text')
    .map((c) => (c as { text?: string }).text ?? '')
    .join('\n')
    .slice(0, 300)
}

function describeContentShape(content: unknown): { kind: string; types?: string[]; length?: number } {
  if (typeof content === 'string') {
    return { kind: 'string', length: content.length }
  }
  if (Array.isArray(content)) {
    const types = content
      .map((c) => (c && typeof c === 'object' && 'type' in c ? String((c as { type?: unknown }).type) : 'unknown'))
    return { kind: 'array', types, length: content.length }
  }
  return { kind: typeof content }
}

export async function handleSimpleChat(
  ws: WebSocket,
  state: SessionRuntimeState,
  payload: ChatPayload,
  sessionService: SessionService,
): Promise<void> {
  if (state.isRunning) {
    sendEvent(ws, 'error', { message: '当前会话正在运行，请稍后再试。' })
    return
  }

  state.isRunning = true
  state.isWaiting = false
  state.resumeHint = undefined
  state.waitingTodoIndex = undefined

  const config = getConfig()
  const { messages, model: modelId, baseUrl, apiKey: reqApiKey, options, enableTools } = payload
  const piModel = createVllmModel({
    modelId,
    baseUrl,
    maxTokens: options?.maxTokens,
  })
  const apiKey = reqApiKey ?? config.LLM_API_KEY

  const normalized = normalizeIncomingMessages(messages, piModel.id)
  if (normalized.promptMessages.length === 0) {
    sendEvent(ws, 'error', { message: '至少需要一条 user 消息' })
    state.isRunning = false
    return
  }

  const persistedContext = sessionService.getPrunedContext(state)
  const contextMessages = normalized.contextMessages.length > 0
    ? normalized.contextMessages
    : persistedContext

  state.abortController = new AbortController()

  try {
    setCurrentToolSessionKey(state.sessionKey)
    const result = await runSimpleAgent({
      messages: normalized.promptMessages,
      contextMessages,
      model: piModel,
      apiKey,
      temperature: options?.temperature,
      extraSystemPrompt: normalized.extraSystemPrompt,
      signal: state.abortController.signal,
      enableTools,
      onEvent: (event) => {
        if (event.type === 'message_update') {
          if (
            event.assistantMessageEvent.type !== 'text_delta' &&
            event.assistantMessageEvent.type !== 'toolcall_end'
          ) {
            logger.debug('Simple message_update (other)', {
              sessionId: state.sessionId,
              type: event.assistantMessageEvent.type,
            })
          }
          if (event.assistantMessageEvent.type === 'text_delta') {
            logger.debug('Simple message_delta', {
              sessionId: state.sessionId,
              deltaLength: event.assistantMessageEvent.delta?.length ?? 0,
            })
          }
          if (event.assistantMessageEvent.type === 'toolcall_end') {
            const toolCall = (event.assistantMessageEvent as { toolCall?: { name?: string; arguments?: unknown } }).toolCall
            logger.debug('Simple toolcall_end', {
              sessionId: state.sessionId,
              toolName: toolCall?.name,
              args: toolCall?.arguments,
            })
          }
        }
        if (event.type === 'tool_execution_start') {
          logger.debug('Simple tool_execution_start', {
            sessionId: state.sessionId,
            toolName: event.toolName,
            args: event.args,
          })
        }
        if (event.type === 'tool_execution_end') {
          logger.debug('Simple tool_execution_end', {
            sessionId: state.sessionId,
            toolName: event.toolName,
            isError: event.isError,
          })
        }
        if (event.type === 'message_end') {
          logger.debug('Simple message_end', {
            sessionId: state.sessionId,
            role: event.message.role,
            summary: summarizeAssistantContent(event.message.content),
            contentShape: describeContentShape(event.message.content),
          })
        }
        if (isCoreAgentEvent(event)) {
          forwardAgentEvent(ws, event, { deltaEvent: 'message_delta', sendMessageEnd: true })
        }
      },
    })

    sessionService.touchModelCall(state)
    const newMessages = result.messages.slice(contextMessages.length)
    await sessionService.recordRunResult(state, piModel.id, normalized.promptMessages, newMessages, result.messages)

    state.contextMessages = result.messages
    sessionService.queueTitleGeneration(state, {
      modelId,
      baseUrl,
      apiKey,
      messages: result.messages,
    })
    const finalText = extractLastAssistantText(result.messages)
    logger.info('Simple 模式响应完成', {
      sessionId: state.sessionId,
      model: piModel.id,
      content: finalText.slice(0, 1000),
    })
    sendEvent(ws, 'done')
  } catch (error) {
    sendEvent(ws, 'error', { message: error instanceof Error ? error.message : String(error) })
  } finally {
    clearCurrentToolSessionKey()
    state.isRunning = false
    state.abortController = undefined
    await sessionService.persistState(state)
  }
}
