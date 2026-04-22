import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { ArtifactTraceItem, ChatAttachment, ClientEventPayloadMap, ServerEventPayloadMap, StepKind, ThinkingConfig } from '@lecquy/shared'
import { WS_BASE } from '../config/api.ts'
import { mergeArtifacts, mergeArtifactTraceItems, type ChatArtifact } from '../lib/artifacts.ts'
import {
  logChatStream,
  previewUnknown,
  previewStreamContent,
  summarizeBlocks,
  summarizeGroups,
} from '../lib/chat-stream-debug.ts'
import {
  appendThinkingDelta,
  appendTextDelta,
  blocksToText,
  closeTrailingThinkingBlock,
  finalizeRunningThinkingBlocks,
  patchToolCall,
  pushToolCallStart,
  type MessageBlock,
  type MessageToolCallBlock,
} from '../lib/message-blocks.ts'
import { getPeerId } from '../lib/session.ts'
import { buildDefaultRoute } from '../lib/session-route.ts'
import { ReconnectableWs, type ConnectionStatus } from '../lib/ws-reconnect.ts'

export type ChatMode = 'simple' | 'plan'
export type MessageRole = 'user' | 'assistant' | 'system' | 'event'

export interface PlanTaskDetail {
  todoIndex: number
  title?: string
  stepId?: string
  content: string
}

export interface ThoughtTiming {
  status: 'running' | 'completed' | 'failed'
  startedAt: number
  finishedAt?: number
  durationMs?: number
}

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  blocks?: MessageBlock[]
  attachments?: ChatAttachment[]
  artifacts?: ChatArtifact[]
  artifactTraceItems?: ArtifactTraceItem[]
  thinkingContent?: string
  hasThinking?: boolean
  isThinkingExpanded?: boolean
  todoItems?: ServerEventPayloadMap['todo_state']['items']
  planDetails?: Record<number, PlanTaskDetail>
  isTodoExpanded?: boolean
  expandedPlanTaskIndexes?: number[]
  timestamp: number
  eventType?: string
  stepId?: string
  stepStatus?: ServerEventPayloadMap['step_state']['status']
  thoughtTiming?: ThoughtTiming
  collapsedThinkingGroupKeys?: string[]
  collapsedToolGroupKeys?: string[]
}

export interface ModelConfig {
  model: string
  temperature: number
  maxTokens: number
  baseUrl: string
  apiKey: string
  enableTools: boolean
  thinking: ThinkingConfig
}

export type SessionResolvedPayload = ServerEventPayloadMap['session_bound']
export type SessionTitleUpdatedPayload = ServerEventPayloadMap['session_title_updated']

interface UseChatOptions {
  modelConfig: ModelConfig
  peerId?: string
  currentSessionKey?: string | null
  onWsEvent?: <T extends keyof ServerEventPayloadMap>(event: T, payload: ServerEventPayloadMap[T]) => void
}

function createId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function appendMessage(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  msg: ChatMessage,
) {
  setMessages((prev) => [...prev, msg])
}

function updateMessage(
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>,
  id: string,
  updater: (message: ChatMessage) => ChatMessage,
) {
  setMessages((prev) => prev.map((message) => (message.id === id ? updater(message) : message)))
}

function renderTodo(items: ServerEventPayloadMap['todo_state']['items']): string {
  if (items.length === 0) return '当前没有任务。'
  return items
    .map((item) => {
      const mark =
        item.status === 'completed' ? '[x]' :
        item.status === 'in_progress' ? '[>]' : '[ ]'
      return `${mark} ${item.content}`
    })
    .join('\n')
}

function toThoughtTiming(
  step: Pick<ServerEventPayloadMap['step_state'], 'status' | 'startedAt' | 'finishedAt' | 'durationMs'>,
  current: ThoughtTiming | undefined,
  fallbackStartedAt?: number,
): ThoughtTiming | undefined {
  const startedAt = step.startedAt ?? current?.startedAt ?? fallbackStartedAt
  if (typeof startedAt !== 'number') return current

  if (step.status === 'started') {
    return {
      status: 'running',
      startedAt,
    }
  }

  const finishedAt = step.finishedAt ?? current?.finishedAt
  const durationMs = typeof step.durationMs === 'number'
    ? step.durationMs
    : typeof finishedAt === 'number'
      ? Math.max(0, finishedAt - startedAt)
      : current?.durationMs

  return {
    status: step.status,
    startedAt,
    finishedAt,
    durationMs,
  }
}

function isToolCallExpanded(block: MessageToolCallBlock): boolean {
  // 与 ToolCallCard.getEffectiveToolCallExpanded 保持一致：
  // 只有失败卡片才参与展开 / 折叠，其它状态视为不可展开
  if (block.status !== 'error') return false
  if (typeof block.manualExpanded === 'boolean') return block.manualExpanded
  return true
}

const CANCELLED_STEP_SUMMARY = '回答已中断'

function extractEventSessionKey(
  payload: ServerEventPayloadMap[keyof ServerEventPayloadMap],
): string | null {
  if (!payload || typeof payload !== 'object' || !('sessionKey' in payload)) return null
  return typeof payload.sessionKey === 'string' ? payload.sessionKey : null
}

function extractEventRunId(
  payload: ServerEventPayloadMap[keyof ServerEventPayloadMap],
): string | null {
  if (!payload || typeof payload !== 'object' || !('runId' in payload)) return null
  return typeof payload.runId === 'string' ? payload.runId : null
}

function sanitizeCancelledAssistantMessage(message: ChatMessage): ChatMessage {
  const blockText = blocksToText(message.blocks).trim()
  const contentText = message.content.trim()
  const retainedText =
    blockText && blockText !== CANCELLED_STEP_SUMMARY
      ? blockText
      : !blockText && contentText && contentText !== CANCELLED_STEP_SUMMARY
        ? contentText
        : ''

  return {
    ...message,
    content: retainedText,
    blocks: retainedText ? appendTextDelta([], retainedText) : [],
    thinkingContent: '',
    hasThinking: false,
    thoughtTiming: undefined,
    stepStatus: 'failed',
  }
}

export function useChat({ modelConfig, peerId, currentSessionKey, onWsEvent }: UseChatOptions) {
  const [mode, setMode] = useState<ChatMode>('simple')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [isWaiting, setIsWaiting] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected')
  const [boundSessionKey, setBoundSessionKey] = useState<string | null>(currentSessionKey ?? null)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)

  const reconnectWsRef = useRef<ReconnectableWs | null>(null)
  const currentRunIdRef = useRef<string | null>(null)
  const currentPauseIdRef = useRef<string | null>(null)
  const stepMessageIdsRef = useRef<Map<string, string>>(new Map())
  const stepMetaRef = useRef<Map<string, { kind: StepKind; todoIndex?: number }>>(new Map())
  const pendingArtifactsRef = useRef<Map<string, ChatArtifact[]>>(new Map())
  const pendingArtifactTraceRef = useRef<Map<string, ArtifactTraceItem[]>>(new Map())
  const todoMessageIdRef = useRef<string | null>(null)
  const pendingUserIdRef = useRef<string | null>(null)
  const currentSessionKeyRef = useRef<string | null>(currentSessionKey ?? null)
  const allowedSessionKeyRef = useRef<string | null>(currentSessionKey ?? null)
  const pendingSessionBindingRef = useRef(false)
  const locallyCancelledRunIdsRef = useRef<Set<string>>(new Set())

  useEffect(() => {
    currentSessionKeyRef.current = currentSessionKey ?? null
    allowedSessionKeyRef.current = currentSessionKey ?? null
    setBoundSessionKey(currentSessionKey ?? null)
  }, [currentSessionKey])

  const clearDerivedState = useCallback(() => {
    currentRunIdRef.current = null
    currentPauseIdRef.current = null
    stepMessageIdsRef.current.clear()
    stepMetaRef.current.clear()
    pendingArtifactsRef.current.clear()
    pendingArtifactTraceRef.current.clear()
    todoMessageIdRef.current = null
    pendingUserIdRef.current = null
    pendingSessionBindingRef.current = false
    locallyCancelledRunIdsRef.current.clear()
    setIsStreaming(false)
    setIsWaiting(false)
  }, [])

  const replaceMessages = useCallback((nextMessages: ChatMessage[]) => {
    clearDerivedState()
    todoMessageIdRef.current = nextMessages.find((message) => message.eventType === 'plan')?.id ?? null
    setMessages(nextMessages)
  }, [clearDerivedState])

  const clearMessages = useCallback(() => {
    replaceMessages([])
  }, [replaceMessages])

  const toggleThinking = useCallback((id: string, groupKey?: string) => {
    updateMessage(setMessages, id, (message) => {
      if (!groupKey) {
        return {
          ...message,
          isThinkingExpanded: !message.isThinkingExpanded,
        }
      }

      const currentKeys = new Set(message.collapsedThinkingGroupKeys ?? [])
      if (currentKeys.has(groupKey)) {
        currentKeys.delete(groupKey)
      } else {
        currentKeys.add(groupKey)
      }

      return {
        ...message,
        collapsedThinkingGroupKeys: Array.from(currentKeys),
      }
    })
  }, [])

  const togglePlanTask = useCallback((id: string, todoIndex: number) => {
    updateMessage(setMessages, id, (message) => {
      const current = new Set(message.expandedPlanTaskIndexes ?? [])
      if (current.has(todoIndex)) {
        current.delete(todoIndex)
      } else {
        current.add(todoIndex)
      }

      return {
        ...message,
        expandedPlanTaskIndexes: Array.from(current).sort((a, b) => a - b),
      }
    })
  }, [])

  const toggleTodo = useCallback((id: string) => {
    updateMessage(setMessages, id, (message) => ({
      ...message,
      isTodoExpanded: !message.isTodoExpanded,
    }))
  }, [])

  const toggleToolCall = useCallback((id: string, blockId: string) => {
    updateMessage(setMessages, id, (message) => ({
      ...message,
      blocks: message.blocks?.map((block) => {
        if (block.kind !== 'tool_call' || block.id !== blockId) return block
        return {
          ...block,
          manualExpanded: !isToolCallExpanded(block),
        }
      }),
    }))
  }, [])

  const toggleToolGroup = useCallback((id: string, groupKey: string) => {
    updateMessage(setMessages, id, (message) => {
      const currentKeys = new Set(message.collapsedToolGroupKeys ?? [])
      if (currentKeys.has(groupKey)) {
        currentKeys.delete(groupKey)
      } else {
        currentKeys.add(groupKey)
      }

      return {
        ...message,
        collapsedToolGroupKeys: Array.from(currentKeys),
      }
    })
  }, [])

  const finalizeRunningThoughts = useCallback((status: 'completed' | 'failed') => {
    const finishedAt = Date.now()
    setMessages((prev) => prev.map((message) => {
      const timing = message.thoughtTiming
      const nextBlocks = message.blocks
        ? finalizeRunningThinkingBlocks(message.blocks, status, finishedAt)
        : message.blocks
      if ((!timing || timing.status !== 'running') && nextBlocks === message.blocks) return message

      return {
        ...message,
        blocks: nextBlocks,
        stepStatus: message.stepStatus === 'started' && status === 'failed' ? 'failed' : message.stepStatus,
        thoughtTiming: timing && timing.status === 'running'
          ? {
              status,
              startedAt: timing.startedAt,
              finishedAt,
              durationMs: Math.max(0, finishedAt - timing.startedAt),
            }
          : timing,
      }
    }))
  }, [])

  const cleanupCancelledRunMessages = useCallback(() => {
    const activeMessageIds = new Set(stepMessageIdsRef.current.values())
    if (activeMessageIds.size === 0) return

    setMessages((prev) => prev.map((message) => (
      activeMessageIds.has(message.id)
        ? sanitizeCancelledAssistantMessage(message)
        : message
    )))

    stepMessageIdsRef.current.clear()
    stepMetaRef.current.clear()
    pendingArtifactsRef.current.clear()
    pendingArtifactTraceRef.current.clear()
  }, [])

  const logAssistantSnapshot = useCallback((
    scope: string,
    meta: Record<string, unknown>,
    message: ChatMessage,
  ) => {
    logChatStream(scope, {
      ...meta,
      messageId: message.id,
      stepId: message.stepId,
      stepStatus: message.stepStatus,
      contentPreview: previewStreamContent(message.content),
      thinkingPreview: previewStreamContent(message.thinkingContent),
      blocks: summarizeBlocks(message.blocks),
      groups: summarizeGroups(message.blocks),
    })
  }, [])

  const ensurePlanMessage = useCallback(() => {
    const existing = todoMessageIdRef.current
    if (existing) return existing

    const id = createId('plan')
    todoMessageIdRef.current = id
    appendMessage(setMessages, {
      id,
      role: 'event',
      content: '',
      todoItems: [],
      planDetails: {},
      isTodoExpanded: true,
      expandedPlanTaskIndexes: [],
      timestamp: Date.now(),
      eventType: 'plan',
    })
    return id
  }, [])

  const ensureStepMessage = useCallback((stepId: string, kind: StepKind, options?: { force?: boolean }) => {
    const existing = stepMessageIdsRef.current.get(stepId)
    if (existing) return existing
    if (!options?.force && kind !== 'simple_reply') return null

    const id = createId('assistant')
    stepMessageIdsRef.current.set(stepId, id)
    appendMessage(setMessages, {
      id,
      role: 'assistant',
      content: '',
      blocks: [],
      thinkingContent: '',
      hasThinking: false,
      isThinkingExpanded: true,
      timestamp: Date.now(),
      eventType: 'step',
      stepId,
      stepStatus: 'started',
    })
    return id
  }, [])

  const flushPendingStepArtifacts = useCallback((stepId: string, kind: StepKind, options?: { force?: boolean }) => {
    const pendingArtifacts = pendingArtifactsRef.current.get(stepId)
    const pendingTraceItems = pendingArtifactTraceRef.current.get(stepId)
    if ((pendingArtifacts?.length ?? 0) === 0 && (pendingTraceItems?.length ?? 0) === 0) {
      return
    }

    const messageId = ensureStepMessage(stepId, kind, options)
    if (!messageId) return

    let consumedArtifacts = false
    let consumedTraceItems = false
    updateMessage(setMessages, messageId, (message) => {
      const nextArtifacts = mergeArtifacts(message.artifacts, pendingArtifacts)
      if ((nextArtifacts?.length ?? 0) === 0) {
        return message
      }

      consumedArtifacts = (pendingArtifacts?.length ?? 0) > 0
      consumedTraceItems = (pendingTraceItems?.length ?? 0) > 0
      return {
        ...message,
        artifacts: nextArtifacts,
        artifactTraceItems: mergeArtifactTraceItems(message.artifactTraceItems, pendingTraceItems),
      }
    })

    if (consumedArtifacts) {
      pendingArtifactsRef.current.delete(stepId)
    }
    if (consumedTraceItems) {
      pendingArtifactTraceRef.current.delete(stepId)
    }
  }, [ensureStepMessage])

  const ensureWs = useCallback(() => {
    if (reconnectWsRef.current) return reconnectWsRef.current

    const ws = new ReconnectableWs({
      url: `${WS_BASE}/api/v1/chat/ws`,
      onMessage: (data) => {
        try {
          const parsed = JSON.parse(data) as { event?: keyof ServerEventPayloadMap; payload?: Record<string, unknown> }
          const event = parsed.event
          if (!event) return
          const payload = (parsed.payload ?? {}) as ServerEventPayloadMap[keyof ServerEventPayloadMap]
          const payloadSessionKey = extractEventSessionKey(payload)
          const payloadRunId = extractEventRunId(payload)

          if (payloadSessionKey) {
            const shouldAcceptSession =
              event === 'session_bound'
                ? pendingSessionBindingRef.current
                  || currentSessionKeyRef.current === null
                  || currentSessionKeyRef.current === payloadSessionKey
                : allowedSessionKeyRef.current === payloadSessionKey

            if (!shouldAcceptSession) {
              if (event === 'run_state') {
                onWsEvent?.(event, payload as ServerEventPayloadMap['run_state'])
              } else if (event === 'session_title_updated') {
                onWsEvent?.(event, payload as ServerEventPayloadMap['session_title_updated'])
              }
              return
            }
          }

          const isLocallyCancelledRun = Boolean(
            payloadRunId
            && locallyCancelledRunIdsRef.current.has(payloadRunId)
          )

          if (isLocallyCancelledRun && event !== 'run_state') {
            return
          }

          if (event === 'session_bound') {
            const bound = payload as ServerEventPayloadMap['session_bound']
            pendingSessionBindingRef.current = false
            allowedSessionKeyRef.current = bound.sessionKey
            setBoundSessionKey(bound.sessionKey)
            setCurrentSessionId(bound.sessionId)
            onWsEvent?.(event, bound)
            return
          }

          if (event === 'session_restored') {
            onWsEvent?.(event, payload as ServerEventPayloadMap['session_restored'])
            return
          }

          if (event === 'session_title_updated') {
            onWsEvent?.(event, payload as ServerEventPayloadMap['session_title_updated'])
            return
          }

          if (event === 'run_state') {
            const run = payload as ServerEventPayloadMap['run_state']
            const wasLocallyCancelled = locallyCancelledRunIdsRef.current.has(run.runId)
            currentRunIdRef.current = run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled'
              ? null
              : run.runId
            setIsStreaming(run.status === 'running')
            setIsWaiting(run.status === 'paused')
            if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
              currentPauseIdRef.current = null
              pendingUserIdRef.current = null
              if (wasLocallyCancelled && run.status !== 'completed') {
                cleanupCancelledRunMessages()
              } else {
                finalizeRunningThoughts(run.status === 'completed' ? 'completed' : 'failed')
              }
              locallyCancelledRunIdsRef.current.delete(run.runId)
            }
            if (run.status === 'failed' && run.error && !wasLocallyCancelled) {
              appendMessage(setMessages, {
                id: createId('system'),
                role: 'system',
                content: run.error,
                timestamp: Date.now(),
              })
            }
            onWsEvent?.(event, run)
            return
          }

          if (event === 'step_state') {
            const step = payload as ServerEventPayloadMap['step_state']
            logChatStream('ws:step_state', {
              sessionKey: step.sessionKey,
              runId: step.runId,
              stepId: step.stepId,
              kind: step.kind,
              status: step.status,
              summaryPreview: previewStreamContent(step.summary),
            })
            stepMetaRef.current.set(step.stepId, { kind: step.kind, todoIndex: step.todoIndex })

            if (step.kind === 'planner') {
              ensurePlanMessage()
              onWsEvent?.(event, step)
              return
            }

            if (step.kind === 'task') {
              const todoIndex = step.todoIndex ?? stepMetaRef.current.get(step.stepId)?.todoIndex
              if (typeof todoIndex === 'number') {
                const planMessageId = ensurePlanMessage()
                updateMessage(setMessages, planMessageId, (message) => {
                  const existing = message.planDetails?.[todoIndex] ?? {
                    todoIndex,
                    content: '',
                  }

                  return {
                    ...message,
                    expandedPlanTaskIndexes: message.expandedPlanTaskIndexes?.includes(todoIndex)
                      ? message.expandedPlanTaskIndexes
                      : [...(message.expandedPlanTaskIndexes ?? []), todoIndex].sort((a, b) => a - b),
                    planDetails: {
                      ...(message.planDetails ?? {}),
                      [todoIndex]: {
                        ...existing,
                        stepId: step.stepId,
                        title: step.title ?? existing.title,
                        content:
                          step.status === 'completed' && step.summary
                            ? step.summary
                            : existing.content,
                      },
                    },
                  }
                })
              }
              if ((pendingArtifactsRef.current.get(step.stepId)?.length ?? 0) > 0) {
                flushPendingStepArtifacts(step.stepId, step.kind, { force: true })
              }
              onWsEvent?.(event, step)
              return
            }

            const messageId = ensureStepMessage(step.stepId, step.kind)
            if (!messageId) {
              onWsEvent?.(event, step)
              return
            }
            updateMessage(setMessages, messageId, (message) => {
              const nextBlocks = step.status === 'started'
                ? message.blocks
                : finalizeRunningThinkingBlocks(message.blocks ?? [], step.status, step.finishedAt ?? Date.now())
              const nextMessage = {
                ...message,
                content:
                  step.summary && !blocksToText(nextBlocks).trim()
                    ? step.summary
                    : message.content,
                blocks:
                  step.summary && !blocksToText(nextBlocks).trim()
                    ? appendTextDelta([], step.summary)
                    : nextBlocks,
                stepStatus: step.status,
                thoughtTiming: toThoughtTiming(step, message.thoughtTiming, message.timestamp),
              }
              logAssistantSnapshot('message:update:step_state', {
                sessionKey: step.sessionKey,
                runId: step.runId,
                kind: step.kind,
                status: step.status,
              }, nextMessage)
              return nextMessage
            })
            flushPendingStepArtifacts(step.stepId, step.kind)
            onWsEvent?.(event, step)
            return
          }

          if (event === 'step_delta') {
            const delta = payload as ServerEventPayloadMap['step_delta']
            logChatStream('ws:step_delta', {
              sessionKey: delta.sessionKey,
              runId: delta.runId,
              stepId: delta.stepId,
              kind: delta.kind,
              stream: delta.stream,
              contentPreview: previewStreamContent(delta.content),
              contentLength: delta.content.length,
            })
            if (delta.kind === 'task') {
              const todoIndex = stepMetaRef.current.get(delta.stepId)?.todoIndex
              if (typeof todoIndex === 'number') {
                const planMessageId = ensurePlanMessage()
                const stream = delta.stream ?? 'text'
                if (stream === 'thinking') {
                  return
                }
                updateMessage(setMessages, planMessageId, (message) => {
                  const existing = message.planDetails?.[todoIndex] ?? {
                    todoIndex,
                    stepId: delta.stepId,
                    content: '',
                  }
                  const nextDetail = {
                    ...existing,
                    content: existing.content + delta.content,
                  }

                  return {
                    ...message,
                    expandedPlanTaskIndexes: message.expandedPlanTaskIndexes?.includes(todoIndex)
                      ? message.expandedPlanTaskIndexes
                      : [...(message.expandedPlanTaskIndexes ?? []), todoIndex].sort((a, b) => a - b),
                    planDetails: {
                      ...(message.planDetails ?? {}),
                      [todoIndex]: nextDetail,
                    },
                  }
                })
              }
              return
            }

            const messageId = ensureStepMessage(delta.stepId, delta.kind)
            if (!messageId) return
            const stream = delta.stream ?? 'text'
            updateMessage(setMessages, messageId, (message) => {
              if (stream === 'thinking') {
                const nextMessage = {
                  ...message,
                  hasThinking: true,
                  blocks: appendThinkingDelta(message.blocks ?? [], delta.content, { startedAt: Date.now() }),
                  thinkingContent: (message.thinkingContent ?? '') + delta.content,
                }
                logAssistantSnapshot('message:update:step_delta:thinking', {
                  sessionKey: delta.sessionKey,
                  runId: delta.runId,
                  stream,
                  contentPreview: previewStreamContent(delta.content),
                }, nextMessage)
                return nextMessage
              }

              const nextMessage = {
                ...message,
                content: message.content + delta.content,
                blocks: appendTextDelta(
                  closeTrailingThinkingBlock(message.blocks ?? [], 'completed', Date.now()),
                  delta.content,
                ),
              }
              logAssistantSnapshot('message:update:step_delta:text', {
                sessionKey: delta.sessionKey,
                runId: delta.runId,
                stream,
                contentPreview: previewStreamContent(delta.content),
              }, nextMessage)
              return nextMessage
            })
            flushPendingStepArtifacts(delta.stepId, delta.kind)
            return
          }

          if (event === 'todo_state') {
            const todo = payload as ServerEventPayloadMap['todo_state']
            const planMessageId = ensurePlanMessage()
            updateMessage(setMessages, planMessageId, (message) => ({
              ...message,
              content: renderTodo(todo.items),
              todoItems: todo.items,
            }))
            onWsEvent?.(event, todo)
            return
          }

          if (event === 'pause_requested') {
            const pause = payload as ServerEventPayloadMap['pause_requested']
            currentPauseIdRef.current = pause.pause.pauseId
            setIsStreaming(false)
            setIsWaiting(true)
            appendMessage(setMessages, {
              id: createId('pause'),
              role: 'event',
              content: pause.pause.prompt,
              timestamp: Date.now(),
              eventType: 'pause',
            })
            onWsEvent?.(event, pause)
            return
          }

          if (event === 'tool_state') {
            const tool = payload as ServerEventPayloadMap['tool_state']
            onWsEvent?.(event, tool)
            return
          }

          if (event === 'tool_call_start') {
            const tool = payload as ServerEventPayloadMap['tool_call_start']
            logChatStream('ws:tool_call_start', {
              sessionKey: tool.sessionKey,
              runId: tool.runId,
              stepId: tool.stepId,
              toolCallId: tool.toolCallId,
              toolName: tool.toolName,
            })
            const stepKind = stepMetaRef.current.get(tool.stepId)?.kind ?? 'simple_reply'
            const messageId = ensureStepMessage(tool.stepId, stepKind, { force: true })
            if (!messageId) {
              onWsEvent?.(event, tool)
              return
            }

            updateMessage(setMessages, messageId, (message) => {
              const nextMessage = {
                ...message,
                blocks: pushToolCallStart(closeTrailingThinkingBlock(message.blocks ?? [], 'completed', Date.now()), {
                  toolCallId: tool.toolCallId,
                  toolName: tool.toolName,
                  args: tool.args,
                }),
              }
              logAssistantSnapshot('message:update:tool_call_start', {
                sessionKey: tool.sessionKey,
                runId: tool.runId,
                toolCallId: tool.toolCallId,
                toolName: tool.toolName,
              }, nextMessage)
              return nextMessage
            })
            onWsEvent?.(event, tool)
            return
          }

          if (event === 'tool_call_delta') {
            const tool = payload as ServerEventPayloadMap['tool_call_delta']
            logChatStream('ws:tool_call_delta', {
              sessionKey: tool.sessionKey,
              runId: tool.runId,
              stepId: tool.stepId,
              toolCallId: tool.toolCallId,
              toolName: tool.toolName,
            })
            const stepKind = stepMetaRef.current.get(tool.stepId)?.kind ?? 'simple_reply'
            const messageId = ensureStepMessage(tool.stepId, stepKind, { force: true })
            if (!messageId) {
              onWsEvent?.(event, tool)
              return
            }

            updateMessage(setMessages, messageId, (message) => {
              const nextMessage = {
                ...message,
                blocks: patchToolCall(
                  closeTrailingThinkingBlock(message.blocks ?? [], 'completed', Date.now()),
                  tool.toolCallId,
                  { args: tool.args },
                  { toolName: tool.toolName, status: 'running' },
                ),
              }
              logAssistantSnapshot('message:update:tool_call_delta', {
                sessionKey: tool.sessionKey,
                runId: tool.runId,
                toolCallId: tool.toolCallId,
                toolName: tool.toolName,
              }, nextMessage)
              return nextMessage
            })
            onWsEvent?.(event, tool)
            return
          }

          if (event === 'tool_call_end') {
            const tool = payload as ServerEventPayloadMap['tool_call_end']
            logChatStream('ws:tool_call_end', {
              sessionKey: tool.sessionKey,
              runId: tool.runId,
              stepId: tool.stepId,
              toolCallId: tool.toolCallId,
              toolName: tool.toolName,
              status: tool.status,
              resultPreview: tool.status === 'success' ? previewUnknown(tool.result) : undefined,
              errorPreview: tool.status === 'error' ? previewStreamContent(tool.errorMessage) : undefined,
            })
            const stepKind = stepMetaRef.current.get(tool.stepId)?.kind ?? 'simple_reply'
            const messageId = ensureStepMessage(tool.stepId, stepKind, { force: true })
            if (!messageId) {
              onWsEvent?.(event, tool)
              return
            }

            if (tool.status === 'success') {
              updateMessage(setMessages, messageId, (message) => {
                const nextMessage = {
                  ...message,
                  blocks: patchToolCall(
                    closeTrailingThinkingBlock(message.blocks ?? [], 'completed', Date.now()),
                    tool.toolCallId,
                    {
                      status: 'success',
                      result: tool.result,
                      endedAt: Date.now(),
                    },
                    { toolName: tool.toolName, status: 'success' },
                  ),
                }
                logAssistantSnapshot('message:update:tool_call_end:success', {
                  sessionKey: tool.sessionKey,
                  runId: tool.runId,
                  toolCallId: tool.toolCallId,
                  toolName: tool.toolName,
                }, nextMessage)
                return nextMessage
              })

              const readyArtifacts = (tool.generatedArtifacts ?? []).map((artifact) => ({
                ...artifact,
                stepId: tool.stepId,
              }))
              pendingArtifactsRef.current.set(
                tool.stepId,
                mergeArtifacts(pendingArtifactsRef.current.get(tool.stepId), readyArtifacts) ?? [],
              )
              pendingArtifactTraceRef.current.set(
                tool.stepId,
                mergeArtifactTraceItems(pendingArtifactTraceRef.current.get(tool.stepId), tool.artifactTraceItems) ?? [],
              )

              if (readyArtifacts.length > 0) {
                flushPendingStepArtifacts(tool.stepId, stepKind, { force: true })
              } else if (stepMessageIdsRef.current.has(tool.stepId)) {
                flushPendingStepArtifacts(tool.stepId, stepKind)
              }
            } else {
              updateMessage(setMessages, messageId, (message) => {
                const nextMessage = {
                  ...message,
                  blocks: patchToolCall(
                    closeTrailingThinkingBlock(message.blocks ?? [], 'failed', Date.now()),
                    tool.toolCallId,
                    {
                      status: 'error',
                      errorMessage: tool.errorMessage,
                      errorDetail: tool.errorDetail,
                      endedAt: Date.now(),
                    },
                    { toolName: tool.toolName, status: 'error' },
                  ),
                }
                logAssistantSnapshot('message:update:tool_call_end:error', {
                  sessionKey: tool.sessionKey,
                  runId: tool.runId,
                  toolCallId: tool.toolCallId,
                  toolName: tool.toolName,
                }, nextMessage)
                return nextMessage
              })
            }

            onWsEvent?.(event, tool)
            return
          }

          if (event === 'session_tool_result') {
            const toolResult = payload as ServerEventPayloadMap['session_tool_result']
            appendMessage(setMessages, {
              id: createId('event'),
              role: 'event',
              content: toolResult.detail ?? JSON.stringify(toolResult, null, 2),
              timestamp: Date.now(),
              eventType: 'session_tool_result',
            })
            onWsEvent?.(event, toolResult)
            return
          }

          if (event === 'error') {
            const error = payload as ServerEventPayloadMap['error']
            appendMessage(setMessages, {
              id: createId('system'),
              role: 'system',
              content: error.message,
              timestamp: Date.now(),
            })
            setIsStreaming(false)
            setIsWaiting(false)
            currentRunIdRef.current = null
            currentPauseIdRef.current = null
            pendingUserIdRef.current = null
            finalizeRunningThoughts('failed')
            onWsEvent?.(event, error)
          }
        } catch {
          appendMessage(setMessages, {
            id: createId('system'),
            role: 'system',
            content: '无法解析 WS 消息',
            timestamp: Date.now(),
          })
        }
      },
      onStatusChange: (status) => {
        setConnectionStatus(status)
        if (status === 'disconnected') {
          setIsStreaming(false)
          setIsWaiting(false)
          currentRunIdRef.current = null
          currentPauseIdRef.current = null
          pendingUserIdRef.current = null
          finalizeRunningThoughts('failed')
          appendMessage(setMessages, {
            id: createId('system'),
            role: 'system',
            content: 'WebSocket 连接已断开',
            timestamp: Date.now(),
          })
        }
      },
    })

    reconnectWsRef.current = ws
    return ws
  }, [WS_BASE, ensurePlanMessage, ensureStepMessage, finalizeRunningThoughts, flushPendingStepArtifacts, logAssistantSnapshot, onWsEvent])

  const buildModelOptions = useCallback(() => ({
    model: modelConfig.model,
    baseUrl: modelConfig.baseUrl || undefined,
    apiKey: modelConfig.apiKey || undefined,
    enableTools: modelConfig.enableTools,
    thinking: modelConfig.thinking,
    options: {
      temperature: modelConfig.temperature,
      maxTokens: modelConfig.maxTokens,
    },
  }), [modelConfig])

  const send = useCallback((payloadInput: { text: string; attachments?: ChatAttachment[] }) => {
    const input = payloadInput.text.trim()
    const attachments = payloadInput.attachments ?? []
    if (!input && attachments.length === 0) return false
    if (isStreaming) return false
    if (isWaiting && mode !== 'plan') return false

    const ws = ensureWs()
    const userId = createId('user')
    pendingUserIdRef.current = userId
    appendMessage(setMessages, {
      id: userId,
      role: 'user',
      content: input,
      attachments,
      timestamp: Date.now(),
    })

    const isPlanResume = Boolean(
      isWaiting &&
      mode === 'plan' &&
      boundSessionKey &&
      currentRunIdRef.current &&
      currentPauseIdRef.current,
    )

    stepMessageIdsRef.current.clear()
    stepMetaRef.current.clear()
    if (!isPlanResume) {
      todoMessageIdRef.current = null
      if (mode === 'plan') {
        ensurePlanMessage()
      }
    }
    setIsStreaming(true)
    setIsWaiting(false)

    if (isPlanResume) {
      const sessionKey = boundSessionKey!
      const runId = currentRunIdRef.current!
      const pauseId = currentPauseIdRef.current!
      const payload: ClientEventPayloadMap['run_resume'] = {
        sessionKey,
        runId,
        pauseId,
        input,
        attachments,
        ...buildModelOptions(),
      }
      ws.send(JSON.stringify({ event: 'run_resume', payload }))
      return true
    }

    pendingSessionBindingRef.current = !boundSessionKey
    const payload: ClientEventPayloadMap['run_start'] = {
      route: buildDefaultRoute({ peerId: peerId ?? getPeerId() }),
      mode,
      input,
      attachments,
      sessionKey: boundSessionKey ?? undefined,
      ...buildModelOptions(),
    }
    ws.send(JSON.stringify({ event: 'run_start', payload }))
    return true
  }, [boundSessionKey, buildModelOptions, ensureWs, isStreaming, isWaiting, mode, peerId])

  const stop = useCallback(() => {
    if (!boundSessionKey) return
    const ws = ensureWs()
    const runId = currentRunIdRef.current ?? undefined
    if (runId) {
      locallyCancelledRunIdsRef.current.add(runId)
    }
    cleanupCancelledRunMessages()
    setIsStreaming(false)
    setIsWaiting(false)
    const payload: ClientEventPayloadMap['run_cancel'] = {
      sessionKey: boundSessionKey,
      runId,
    }
    ws.send(JSON.stringify({ event: 'run_cancel', payload }))
  }, [boundSessionKey, cleanupCancelledRunMessages, ensureWs])

  useEffect(() => {
    return () => {
      reconnectWsRef.current?.close()
      reconnectWsRef.current = null
    }
  }, [])

  return {
    mode,
    setMode,
    messages,
    replaceMessages,
    clearMessages,
    toggleThinking,
    toggleTodo,
    togglePlanTask,
    toggleToolCall,
    toggleToolGroup,
    send,
    stop,
    isStreaming,
    isWaiting,
    connectionStatus,
    currentSessionKey: boundSessionKey,
    currentSessionId,
  }
}
