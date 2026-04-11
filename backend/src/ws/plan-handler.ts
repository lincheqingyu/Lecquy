/**
 * WS Plan 模式处理器
 */

import type { WebSocket } from 'ws'
import { z } from 'zod'
import { createVllmModel } from '../agent/vllm-model.js'
import { runManagerAgent, runWorkerAgent } from '../agent/index.js'
import { isCoreAgentEvent } from '../agent/tool-permission.js'
import type { SessionRuntimeState } from '../session-v2/index.js'
import type { SessionService } from '../session-v2/index.js'
import { getConfig } from '../config/index.js'
import { normalizeIncomingMessages } from '../agent/message-utils.js'
import { forwardAgentEvent, sendEvent } from './event-sender.js'
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

function shouldWaitForUserInput(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return false
  if (normalized.includes('？') || normalized.includes('?')) return true
  if (normalized.includes('请') && (normalized.includes('提供') || normalized.includes('告诉'))) {
    return true
  }
  return false
}

async function executePendingTodos(
  ws: WebSocket,
  state: SessionRuntimeState,
  payload: ChatPayload,
): Promise<void> {
  const config = getConfig()
  const piModel = createVllmModel({
    modelId: payload.model,
    baseUrl: payload.baseUrl,
    maxTokens: payload.options?.maxTokens,
  })
  const apiKey = payload.apiKey ?? config.LLM_API_KEY

  while (true) {
    const inProgress = state.todoManager.getInProgress()
    const pending = inProgress ?? state.todoManager.getPending()
    if (!pending) break

    const [idx, item] = pending
    if (item.status !== 'in_progress') {
      state.todoManager.markInProgress(idx)
    }

    sendEvent(ws, 'worker_start', { todoIndex: idx, content: item.content, activeForm: item.activeForm })

    const prompt = state.resumeHint
      ? `${item.content}\n\n用户补充信息:\n${state.resumeHint}`
      : item.content

    state.resumeHint = undefined

    try {
      const result = await runWorkerAgent({
        prompt,
        model: piModel,
        apiKey,
        temperature: payload.options?.temperature,
        signal: state.abortController?.signal,
        onEvent: (event) => {
          if (event.type === 'message_update') {
            if (event.assistantMessageEvent.type === 'text_delta') {
              logger.debug('Worker message_delta', {
                sessionId: state.sessionId,
                todoIndex: idx,
                deltaLength: event.assistantMessageEvent.delta?.length ?? 0,
              })
            }
            if (event.assistantMessageEvent.type === 'toolcall_end') {
              const toolCall = (event.assistantMessageEvent as { toolCall?: { name?: string; arguments?: unknown } }).toolCall
              logger.debug('Worker toolcall_end', {
                sessionId: state.sessionId,
                todoIndex: idx,
                toolName: toolCall?.name,
                args: toolCall?.arguments,
              })
            }
          }
          if (event.type === 'tool_execution_start') {
            logger.debug('Worker tool_execution_start', {
              sessionId: state.sessionId,
              todoIndex: idx,
              toolName: event.toolName,
              args: event.args,
            })
          }
          if (event.type === 'tool_execution_end') {
            logger.debug('Worker tool_execution_end', {
              sessionId: state.sessionId,
              todoIndex: idx,
              toolName: event.toolName,
              isError: event.isError,
            })
          }
          if (event.type === 'message_end') {
            logger.debug('Worker message_end', {
              sessionId: state.sessionId,
              todoIndex: idx,
              role: event.message.role,
              summary: summarizeAssistantContent(event.message.content),
            })
          }
          if (isCoreAgentEvent(event)) {
            forwardAgentEvent(ws, event, { deltaEvent: 'worker_delta', sendMessageEnd: false })
          }
        },
      })

      const workerText = result.receipt.result === 'blocked'
        ? result.receipt.validation
        : result.receipt.result

      if (result.pause) {
        state.isWaiting = true
        state.waitingTodoIndex = idx
        sendEvent(ws, 'need_user_input', { prompt: result.pause.prompt })
        return
      }

      if (shouldWaitForUserInput(workerText)) {
        state.isWaiting = true
        state.waitingTodoIndex = idx
        sendEvent(ws, 'need_user_input', { prompt: workerText })
        return
      }

      state.todoManager.markCompleted(
        idx,
        result.receipt.result === 'blocked' ? undefined : workerText,
        result.receipt.result === 'blocked' ? workerText : undefined,
      )
      sendEvent(ws, 'worker_end', {
        todoIndex: idx,
        result: workerText,
        isError: result.receipt.result === 'blocked',
      })
      sendEvent(ws, 'todo_update', { todos: state.todoManager.getItems() })
      logger.info('Worker 执行完成', {
        sessionId: state.sessionId,
        todoIndex: idx,
        result: workerText.slice(0, 1000),
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      state.todoManager.markCompleted(idx, undefined, errorMessage)
      sendEvent(ws, 'worker_end', { todoIndex: idx, result: errorMessage, isError: true })
      sendEvent(ws, 'todo_update', { todos: state.todoManager.getItems() })
      logger.warn('Worker 执行失败', {
        sessionId: state.sessionId,
        todoIndex: idx,
        error: errorMessage,
      })
    }
  }
}

export async function handlePlanChat(
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
  const { messages, model: modelId, baseUrl, apiKey: reqApiKey, options } = payload
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
    state.todoManager.loadItems([])
    const result = await runManagerAgent({
      messages: normalized.promptMessages,
      contextMessages,
      model: piModel,
      apiKey,
      temperature: options?.temperature,
      extraSystemPrompt: normalized.extraSystemPrompt,
      signal: state.abortController.signal,
      todoManager: state.todoManager,
      onEvent: (event) => {
        if (event.type === 'message_update') {
          if (event.assistantMessageEvent.type === 'text_delta') {
            logger.debug('Manager message_delta', {
              sessionId: state.sessionId,
              deltaLength: event.assistantMessageEvent.delta?.length ?? 0,
            })
          }
          if (event.assistantMessageEvent.type === 'toolcall_end') {
            const toolCall = (event.assistantMessageEvent as { toolCall?: { name?: string; arguments?: unknown } }).toolCall
            logger.debug('Manager toolcall_end', {
              sessionId: state.sessionId,
              toolName: toolCall?.name,
              args: toolCall?.arguments,
            })
          }
        }
        if (event.type === 'tool_execution_start') {
          logger.debug('Manager tool_execution_start', {
            sessionId: state.sessionId,
            toolName: event.toolName,
            args: event.args,
          })
        }
        if (event.type === 'tool_execution_end') {
          logger.debug('Manager tool_execution_end', {
            sessionId: state.sessionId,
            toolName: event.toolName,
            isError: event.isError,
          })
        }
        if (event.type === 'message_end') {
          logger.debug('Manager message_end', {
            sessionId: state.sessionId,
            role: event.message.role,
            summary: summarizeAssistantContent(event.message.content),
          })
        }
        if (isCoreAgentEvent(event)) {
          forwardAgentEvent(ws, event, { deltaEvent: 'message_delta', sendMessageEnd: true })
        }
        if (isCoreAgentEvent(event) && event.type === 'tool_execution_end' && event.toolName === 'todo_write' && !event.isError) {
          sendEvent(ws, 'plan_created', { todos: state.todoManager.getItems() })
        }
      },
    })

    sessionService.touchModelCall(state)
    const managerMessages = result.messages.slice(contextMessages.length)
    await sessionService.recordRunResult(state, piModel.id, normalized.promptMessages, managerMessages, result.messages)

    state.contextMessages = result.messages
    sessionService.queueTitleGeneration(state, {
      modelId,
      baseUrl,
      apiKey,
      messages: result.messages,
    })
    const managerText = extractLastAssistantText(result.messages)
    logger.info('Manager 规划完成', {
      sessionId: state.sessionId,
      model: piModel.id,
      summary: managerText.slice(0, 1000),
      todos: state.todoManager.getItems(),
    })

    await executePendingTodos(ws, state, payload)

    if (!state.isWaiting) {
      sendEvent(ws, 'done')
    }
  } catch (error) {
    sendEvent(ws, 'error', { message: error instanceof Error ? error.message : String(error) })
  } finally {
    clearCurrentToolSessionKey()
    state.isRunning = false
    state.abortController = undefined
    await sessionService.persistState(state)
  }
}

export async function resumePlanChat(
  ws: WebSocket,
  state: SessionRuntimeState,
  payload: ChatPayload,
  sessionService: SessionService,
): Promise<void> {
  state.isRunning = true
  state.isWaiting = false

  state.abortController = new AbortController()

  try {
    await executePendingTodos(ws, state, payload)
    if (!state.isWaiting) {
      sendEvent(ws, 'done')
    }
  } catch (error) {
    sendEvent(ws, 'error', { message: error instanceof Error ? error.message : String(error) })
  } finally {
    clearCurrentToolSessionKey()
    state.isRunning = false
    state.abortController = undefined
    await sessionService.persistState(state)
  }
}
