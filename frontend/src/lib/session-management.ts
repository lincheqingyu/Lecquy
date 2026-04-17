import {
  type ArtifactTraceItem,
  extractSessionAttachments,
  extractSessionText,
  type SessionEventEntry,
  type SessionMessageRecord,
  type SessionProjection,
} from '@lecquy/shared'
import type { ChatMessage } from '../hooks/useChat'
import {
  isArtifactTraceItem,
  isGeneratedFileArtifact,
  mergeArtifacts,
  mergeArtifactTraceItems,
  type ChatArtifact,
} from './artifacts'
import {
  appendThinkingDelta,
  appendTextDelta,
  blocksFromAssistantContent,
  blocksToText,
  createTextBlocks,
  type MessageBlock,
} from './message-blocks'

export interface SessionListItemVm {
  id: string
  title: string
  preview: string
  updatedAt: number
  createdAt: number
  sessionId: string
  channel: string
  peerId?: string
}

export function extractMessageText(content: unknown): string {
  return extractSessionText(content)
}

function normalizePreview(text: string): string {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return '暂无消息'
  return normalized.length > 40 ? `${normalized.slice(0, 40)}...` : normalized
}

export function toSessionListItemVm(entry: SessionProjection): SessionListItemVm {
  const latest = entry.recentMessages?.[entry.recentMessages.length - 1]
  const latestText = latest ? extractMessageText(latest.content) : ''

  return {
    id: entry.key,
    title: entry.title?.trim() || entry.displayName?.trim() || '未命名会话',
    preview: normalizePreview(latestText),
    updatedAt: entry.updatedAt,
    createdAt: entry.createdAt,
    sessionId: entry.sessionId,
    channel: entry.channel,
    peerId: entry.origin?.peerId,
  }
}

export function toChatMessages(records: SessionMessageRecord[]): ChatMessage[] {
  return records
    .filter((record) => record.role === 'user' || record.role === 'assistant')
    .map((record, index) => {
      const { blocks, thinkingContent } = record.role === 'assistant'
        ? blocksFromAssistantContent(record.content)
        : { blocks: createTextBlocks(extractMessageText(record.content)), thinkingContent: '' }

      return {
        id: `history_${record.role}_${record.timestamp ?? Date.now()}_${index}`,
        role: record.role as ChatMessage['role'],
        content: record.role === 'assistant' ? blocksToText(blocks) : extractMessageText(record.content),
        blocks,
        attachments: record.role === 'user' ? extractSessionAttachments(record.content) : undefined,
        thinkingContent: thinkingContent || undefined,
        hasThinking: thinkingContent.trim().length > 0,
        isThinkingExpanded: thinkingContent.trim().length > 0,
        timestamp: record.timestamp ?? Date.now(),
      }
    })
}

function toEntryTimestamp(timestamp: string): number {
  const value = new Date(timestamp).getTime()
  return Number.isNaN(value) ? Date.now() : value
}

function toHistoryThoughtTiming(step: {
  status?: 'running' | 'completed' | 'failed'
  startedAt?: number
  finishedAt?: number
  durationMs?: number
}): ChatMessage['thoughtTiming'] {
  if (typeof step.startedAt !== 'number') return undefined

  if (step.status !== 'completed' && step.status !== 'failed') {
    return {
      status: 'running',
      startedAt: step.startedAt,
    }
  }

  return {
    status: step.status,
    startedAt: step.startedAt,
    finishedAt: step.finishedAt,
    durationMs: step.durationMs ?? (typeof step.finishedAt === 'number' ? Math.max(0, step.finishedAt - step.startedAt) : undefined),
  }
}

function extractGeneratedArtifacts(data: unknown): ChatArtifact[] {
  if (!data || typeof data !== 'object') return []
  const generatedArtifacts = 'generatedArtifacts' in data
    ? (data as { generatedArtifacts?: unknown }).generatedArtifacts
    : 'generatedFiles' in data
      ? (data as { generatedFiles?: unknown }).generatedFiles
      : undefined
  if (!Array.isArray(generatedArtifacts)) return []
  return generatedArtifacts.filter(isGeneratedFileArtifact)
}

function extractArtifactTraceItems(data: unknown): ArtifactTraceItem[] {
  if (!data || typeof data !== 'object') return []
  const artifactTraceItems = 'artifactTraceItems' in data ? (data as { artifactTraceItems?: unknown }).artifactTraceItems : undefined
  if (!Array.isArray(artifactTraceItems)) return []
  return artifactTraceItems.filter(isArtifactTraceItem)
}

function mergeMessageBlocks(
  current: MessageBlock[] | undefined,
  incoming: MessageBlock[],
): MessageBlock[] | undefined {
  let next = [...(current ?? [])]

  for (const block of incoming) {
    if (block.kind === 'text') {
      next = appendTextDelta(next, block.content)
      continue
    }
    if (block.kind === 'thinking') {
      next = appendThinkingDelta(next, block.content)
      continue
    }
    next = [...next, block]
  }

  return next.length > 0 ? next : undefined
}

function appendAssistantContent(message: ChatMessage, content: unknown): void {
  const { blocks, thinkingContent } = blocksFromAssistantContent(content)
  message.blocks = mergeMessageBlocks(message.blocks, blocks)
  message.content = blocksToText(message.blocks)

  if (thinkingContent.trim()) {
    message.thinkingContent = message.thinkingContent?.trim()
      ? `${message.thinkingContent}\n\n${thinkingContent}`
      : thinkingContent
    message.hasThinking = true
  }
}

export function toChatMessagesFromHistoryView(projection: SessionProjection, entries: SessionEventEntry[]): ChatMessage[] {
  const messages: ChatMessage[] = []
  const messageById = new Map<string, ChatMessage>()
  const stepById = new Map<string, {
    kind: string
    todoIndex?: number
    runId: string
    title?: string
    status?: 'running' | 'completed' | 'failed'
    startedAt?: number
    finishedAt?: number
    durationMs?: number
  }>()
  const stepMessageById = new Map<string, string>()
  const artifactsByStepId = new Map<string, ChatArtifact[]>()
  const artifactTraceByStepId = new Map<string, ArtifactTraceItem[]>()
  const activeRunById = new Map<string, { mode: string; planMessageId?: string }>()
  let activeStepId: string | null = null

  const createHistoryId = (prefix: string, index: number) => `history_${prefix}_${index}`

  const appendMessage = (message: ChatMessage) => {
    messages.push(message)
    messageById.set(message.id, message)
  }

  const finalizeStep = (
    stepId: string,
    finishedAt: number,
    status: 'completed' | 'failed',
    fallbackIndex: number,
  ) => {
    const step = stepById.get(stepId)
    if (!step || step.status !== 'running') return

    const durationMs = typeof step.startedAt === 'number'
      ? Math.max(0, finishedAt - step.startedAt)
      : undefined
    stepById.set(stepId, {
      ...step,
      status,
      finishedAt,
      durationMs,
    })

    const assistantMessageId = stepMessageById.get(stepId)
    const assistantMessage = assistantMessageId ? messageById.get(assistantMessageId) : undefined
    if (assistantMessage) {
      assistantMessage.stepStatus = status
      assistantMessage.thoughtTiming = toHistoryThoughtTiming(stepById.get(stepId) ?? {})
      attachPendingArtifacts(stepId, assistantMessage)
    }

    if (!assistantMessage && (artifactsByStepId.get(stepId)?.length ?? 0) > 0) {
      const syntheticMessage = ensureAssistantStepMessage(stepId, fallbackIndex)
      if (syntheticMessage) {
        syntheticMessage.timestamp = finishedAt
        syntheticMessage.stepStatus = status
        syntheticMessage.thoughtTiming = toHistoryThoughtTiming(stepById.get(stepId) ?? {})
      }
    }

    if (activeStepId === stepId) {
      activeStepId = null
    }
  }

  const attachPendingArtifacts = (stepId: string, message: ChatMessage) => {
    const pendingArtifacts = artifactsByStepId.get(stepId)
    if ((pendingArtifacts?.length ?? 0) === 0) return

    message.artifacts = mergeArtifacts(message.artifacts, pendingArtifacts)
    message.artifactTraceItems = mergeArtifactTraceItems(message.artifactTraceItems, artifactTraceByStepId.get(stepId))
    artifactsByStepId.delete(stepId)
    artifactTraceByStepId.delete(stepId)
  }

  const ensureAssistantStepMessage = (stepId: string, index: number) => {
    const existingId = stepMessageById.get(stepId)
    if (existingId) {
      const existingMessage = messageById.get(existingId) ?? null
      if (existingMessage) {
        attachPendingArtifacts(stepId, existingMessage)
      }
      return existingMessage
    }

    const id = createHistoryId(`assistant_${stepId}`, index)
    const message: ChatMessage = {
      id,
      role: 'assistant',
      content: '',
      blocks: [],
      thinkingContent: '',
      hasThinking: false,
      isThinkingExpanded: true,
      timestamp: Date.now(),
      stepId,
      stepStatus: 'started',
      thoughtTiming: toHistoryThoughtTiming(stepById.get(stepId) ?? {}),
    }
    appendMessage(message)
    stepMessageById.set(stepId, id)
    attachPendingArtifacts(stepId, message)
    return message
  }

  entries.forEach((entry, index) => {
    if (entry.type === 'run_started') {
      const planMessageId = entry.mode === 'plan' ? createHistoryId('plan', index) : undefined
      activeRunById.set(entry.runId, { mode: entry.mode, planMessageId })

      if (entry.mode === 'plan' && planMessageId) {
        appendMessage({
          id: planMessageId,
          role: 'event',
          content: '',
          todoItems: [],
          planDetails: {},
          isTodoExpanded: true,
          expandedPlanTaskIndexes: [],
          timestamp: new Date(entry.timestamp).getTime(),
          eventType: 'plan',
        })
      }
      return
    }

    if (entry.type === 'step_started') {
      const startedAt = entry.startedAt ?? toEntryTimestamp(entry.timestamp)
      stepById.set(entry.stepId, {
        kind: entry.kind,
        todoIndex: entry.todoIndex,
        runId: entry.runId,
        title: entry.title,
        status: 'running',
        startedAt,
      })
      activeStepId = entry.stepId

      const assistantMessageId = stepMessageById.get(entry.stepId)
      const assistantMessage = assistantMessageId ? messageById.get(assistantMessageId) : undefined
      if (assistantMessage) {
        assistantMessage.stepStatus = 'started'
        assistantMessage.thoughtTiming = toHistoryThoughtTiming(stepById.get(entry.stepId) ?? {})
      }

      if (entry.kind === 'task' && typeof entry.todoIndex === 'number') {
        const run = activeRunById.get(entry.runId)
        const planMessage = run?.planMessageId ? messageById.get(run.planMessageId) : undefined
        if (planMessage) {
          planMessage.expandedPlanTaskIndexes = planMessage.expandedPlanTaskIndexes?.includes(entry.todoIndex)
            ? planMessage.expandedPlanTaskIndexes
            : [...(planMessage.expandedPlanTaskIndexes ?? []), entry.todoIndex].sort((a, b) => a - b)

          planMessage.planDetails = {
            ...(planMessage.planDetails ?? {}),
            [entry.todoIndex]: {
              todoIndex: entry.todoIndex,
              title: entry.title,
              content: planMessage.planDetails?.[entry.todoIndex]?.content ?? '',
              stepId: entry.stepId,
            },
          }
        }
      }
      return
    }

    if (entry.type === 'message') {
      if (entry.message.role === 'user') {
        const textContent = extractSessionText(entry.message.content)
        appendMessage({
          id: createHistoryId('user', index),
          role: 'user',
          content: textContent,
          blocks: createTextBlocks(textContent),
          attachments: extractSessionAttachments(entry.message.content),
          timestamp: entry.message.timestamp ?? new Date(entry.timestamp).getTime(),
        })
        return
      }

      if (entry.message.role === 'assistant') {
        const step = activeStepId ? stepById.get(activeStepId) : undefined
        const run = step ? activeRunById.get(step.runId) : undefined

        if (step?.kind === 'planner' && run?.mode === 'plan') {
          return
        }

        if (step?.kind === 'task' && run?.mode === 'plan' && typeof step.todoIndex === 'number' && run.planMessageId) {
          const parsedAssistantContent = blocksFromAssistantContent(entry.message.content)
          const planMessage = messageById.get(run.planMessageId)
          if (planMessage) {
            const content = blocksToText(parsedAssistantContent.blocks)
            const existing = planMessage.planDetails?.[step.todoIndex] ?? {
              todoIndex: step.todoIndex,
              content: '',
              stepId: activeStepId ?? undefined,
            }

            planMessage.planDetails = {
              ...(planMessage.planDetails ?? {}),
              [step.todoIndex]: {
                ...existing,
                content: content || existing.content,
              },
            }
          }

          const hasToolCallBlock = parsedAssistantContent.blocks.some((block) => block.kind === 'tool_call')
          if (!hasToolCallBlock) {
            return
          }
        }

        if (step?.kind === 'simple_reply' && activeStepId) {
          const assistantMessage = ensureAssistantStepMessage(activeStepId, index)
          if (assistantMessage) {
            assistantMessage.timestamp = entry.message.timestamp ?? toEntryTimestamp(entry.timestamp)
            appendAssistantContent(assistantMessage, entry.message.content)
            attachPendingArtifacts(activeStepId, assistantMessage)
          }
          return
        }

        const { blocks, thinkingContent } = blocksFromAssistantContent(entry.message.content)
        const content = blocksToText(blocks)

        appendMessage({
          id: createHistoryId('assistant', index),
          role: 'assistant',
          content,
          blocks,
          thinkingContent: thinkingContent || undefined,
          hasThinking: thinkingContent.trim().length > 0,
          isThinkingExpanded: thinkingContent.trim().length > 0,
          timestamp: entry.message.timestamp ?? new Date(entry.timestamp).getTime(),
        })
      }
      return
    }

    if (entry.type === 'todo_updated') {
      const run = activeRunById.get(entry.runId)
      const planMessage = run?.planMessageId ? messageById.get(run.planMessageId) : undefined
      if (planMessage) {
        planMessage.todoItems = entry.items.map((item) => ({ ...item }))
      }
      return
    }

    if (entry.type === 'custom' && entry.customType === 'generated_files') {
      const stepId = entry.data && typeof entry.data === 'object' && 'stepId' in entry.data
        ? (entry.data as { stepId?: unknown }).stepId
        : undefined
      const generatedArtifacts = extractGeneratedArtifacts(entry.data)
      if (typeof stepId === 'string' && generatedArtifacts.length > 0) {
        artifactsByStepId.set(stepId, mergeArtifacts(artifactsByStepId.get(stepId), generatedArtifacts) ?? [])
        const assistantMessageId = stepMessageById.get(stepId)
        const assistantMessage = assistantMessageId ? messageById.get(assistantMessageId) : undefined
        if (assistantMessage) {
          attachPendingArtifacts(stepId, assistantMessage)
        }
      }
      return
    }

    if (entry.type === 'custom' && entry.customType === 'artifact_trace') {
      const stepId = entry.data && typeof entry.data === 'object' && 'stepId' in entry.data
        ? (entry.data as { stepId?: unknown }).stepId
        : undefined
      const artifactTraceItems = extractArtifactTraceItems(entry.data)
      if (typeof stepId === 'string' && artifactTraceItems.length > 0) {
        artifactTraceByStepId.set(stepId, mergeArtifactTraceItems(artifactTraceByStepId.get(stepId), artifactTraceItems) ?? [])
        const assistantMessageId = stepMessageById.get(stepId)
        const assistantMessage = assistantMessageId ? messageById.get(assistantMessageId) : undefined
        if (assistantMessage && (assistantMessage.artifacts?.length ?? 0) > 0) {
          attachPendingArtifacts(stepId, assistantMessage)
        }
      }
      return
    }

    if (entry.type === 'step_finished') {
      const step = stepById.get(entry.stepId)
      const startedAt = entry.startedAt ?? step?.startedAt
      const finishedAt = entry.finishedAt ?? toEntryTimestamp(entry.timestamp)
      const durationMs = entry.durationMs ?? (typeof startedAt === 'number' ? Math.max(0, finishedAt - startedAt) : undefined)
      if (step) {
        stepById.set(entry.stepId, {
          ...step,
          status: entry.status,
          startedAt,
          finishedAt,
          durationMs,
        })
      }
      if (step?.kind === 'task' && typeof entry.todoIndex === 'number') {
        const run = activeRunById.get(entry.runId)
        const planMessage = run?.planMessageId ? messageById.get(run.planMessageId) : undefined
        if (planMessage) {
          const existing = planMessage.planDetails?.[entry.todoIndex] ?? {
            todoIndex: entry.todoIndex,
            content: '',
            stepId: entry.stepId,
          }
          planMessage.planDetails = {
            ...(planMessage.planDetails ?? {}),
            [entry.todoIndex]: {
              ...existing,
              title: step.title ?? existing.title,
              content: entry.summary ?? existing.content,
            },
          }
        }
      }

      if (step?.kind === 'simple_reply') {
        const assistantMessageId = stepMessageById.get(entry.stepId)
        const assistantMessage = assistantMessageId ? messageById.get(assistantMessageId) : undefined
        if (assistantMessage && entry.summary?.trim() && !blocksToText(assistantMessage.blocks).trim()) {
          assistantMessage.content = entry.summary
          assistantMessage.blocks = appendTextDelta([], entry.summary)
        }
        if (assistantMessage) {
          assistantMessage.stepStatus = entry.status
          assistantMessage.thoughtTiming = toHistoryThoughtTiming(stepById.get(entry.stepId) ?? {})
          attachPendingArtifacts(entry.stepId, assistantMessage)
        }
      }

      if (!stepMessageById.has(entry.stepId) && (artifactsByStepId.get(entry.stepId)?.length ?? 0) > 0) {
        const assistantMessage = ensureAssistantStepMessage(entry.stepId, index)
        if (assistantMessage) {
          assistantMessage.timestamp = finishedAt
          assistantMessage.stepStatus = entry.status
        }
      }

      if (activeStepId === entry.stepId) {
        activeStepId = null
      }
      return
    }

    if (entry.type === 'run_finished') {
      const finishedAt = toEntryTimestamp(entry.timestamp)
      const fallbackStatus = entry.status === 'completed' || entry.status === 'paused' ? 'completed' : 'failed'
      for (const [stepId, step] of stepById.entries()) {
        if (step.runId === entry.runId && step.status === 'running') {
          finalizeStep(stepId, finishedAt, fallbackStatus, index)
        }
      }
      activeRunById.delete(entry.runId)
    }
  })

  if (projection.workflow && projection.workflow.status !== 'queued' && projection.workflow.status !== 'running') {
    const fallbackStatus = projection.workflow.status === 'completed' || projection.workflow.status === 'paused'
      ? 'completed'
      : 'failed'
    for (const [stepId, step] of stepById.entries()) {
      if (step.status === 'running') {
        finalizeStep(stepId, projection.workflow.updatedAt, fallbackStatus, messages.length)
      }
    }
  }

  if (projection.workflow?.mode === 'plan' && projection.workflow.todo?.items?.length) {
    const hasPlanMessage = messages.some((message) => message.eventType === 'plan')
    if (!hasPlanMessage) {
      messages.unshift({
        id: 'history_plan_fallback',
        role: 'event',
        content: '',
        todoItems: projection.workflow.todo.items.map((item) => ({ ...item })),
        planDetails: Object.fromEntries(
          projection.workflow.todo.items.map((item, index) => [
            index,
            {
              todoIndex: index,
              content: item.result ?? '',
            },
          ]),
        ),
        isTodoExpanded: true,
        expandedPlanTaskIndexes: projection.workflow.todo.items.map((_, index) => index),
        timestamp: projection.workflow.updatedAt,
        eventType: 'plan',
      })
    }
  }

  return messages
}

export function parsePeerIdFromSessionKey(sessionKey: string): string | null {
  const match = sessionKey.match(/^agent:[^:]+:[^:]+:[^:]+:dm:(.+)$/)
  return match?.[1] ?? null
}
