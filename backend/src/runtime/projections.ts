import type {
  PausePacket,
  SessionEntry,
  SessionMessageRecord,
  SessionProjection,
  SessionRouteContext,
  SessionStats,
  SessionTitleSource,
  SessionTitleStatus,
  StepKind,
  TodoProjection,
  WorkflowProjection,
  WorkflowStatus,
} from '@webclaw/shared'
import { extractSessionText } from '@webclaw/shared'
import type { SessionManager } from './pi-session-core/session-manager.js'

function normalizePreview(text: string): string | undefined {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.length > 120 ? `${normalized.slice(0, 120)}...` : normalized
}

function createEmptyStats(): SessionStats {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    contextTokens: 0,
  }
}

function coerceRoleMessage(entry: { role?: string; content?: unknown }): boolean {
  return entry.role === 'user' || entry.role === 'assistant'
}

function inferWorkflowStatus(
  currentStatus: WorkflowStatus | undefined,
  nextStatus: WorkflowStatus,
): WorkflowStatus {
  if (!currentStatus) return nextStatus
  if (currentStatus === 'paused' && nextStatus === 'running') return nextStatus
  return nextStatus
}

export interface ProjectionSnapshot {
  projection: SessionProjection
  messages: SessionMessageRecord[]
}

export function rebuildSessionProjection(
  baseEntry: SessionEntry,
  manager: SessionManager,
  limit = 50,
): ProjectionSnapshot {
  const entries = manager.getEntries()
  let title = baseEntry.title
  let titleSource = baseEntry.titleSource
  let titleStatus = baseEntry.titleStatus
  let model = baseEntry.model
  let preview = baseEntry.latestPreview
  let workflow: WorkflowProjection | undefined
  let currentTodo: TodoProjection | undefined
  let currentPause: PausePacket | undefined
  let currentStepId: string | undefined
  let currentStepKind: StepKind | undefined
  let currentRunId: string | undefined
  let currentRunMode = workflow?.mode
  let currentRunStatus: WorkflowStatus | undefined
  let currentRunStartedAt: number | undefined
  let currentRunCompletedAt: number | undefined
  let currentRunError: string | undefined
  let updatedAt = baseEntry.updatedAt
  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  const messages: SessionMessageRecord[] = []

  for (const entry of entries) {
    const timestamp = new Date(entry.timestamp).getTime()
    if (!Number.isNaN(timestamp)) {
      updatedAt = Math.max(updatedAt, timestamp)
    }

    if (entry.type === 'session_info' && entry.name?.trim()) {
      title = entry.name.trim()
      titleSource = 'manual'
      titleStatus = 'ready'
      continue
    }

    if (entry.type === 'model_change') {
      model = entry.modelId
      continue
    }

    if (entry.type === 'message') {
      if (!coerceRoleMessage(entry.message)) continue
      const record = entry.message
      messages.push(record)
      preview = normalizePreview(extractSessionText(record.content)) ?? preview
      if (record.role === 'assistant') {
        const usage = record as { usage?: { input?: number; output?: number; totalTokens?: number } }
        inputTokens += usage.usage?.input ?? 0
        outputTokens += usage.usage?.output ?? 0
        totalTokens += usage.usage?.totalTokens ?? 0
      }
      continue
    }

    if (entry.type === 'run_started') {
      currentRunId = entry.runId
      currentRunMode = entry.mode
      currentRunStatus = inferWorkflowStatus(currentRunStatus, 'running')
      currentRunStartedAt = timestamp
      currentRunCompletedAt = undefined
      currentRunError = undefined
      currentPause = undefined
      currentTodo = undefined
      currentStepId = undefined
      currentStepKind = undefined
      continue
    }

    if (entry.type === 'step_started' && entry.runId === currentRunId) {
      currentStepId = entry.stepId
      currentStepKind = entry.kind
      continue
    }

    if (entry.type === 'step_finished' && entry.runId === currentRunId) {
      if (currentStepId === entry.stepId) {
        currentStepId = undefined
        currentStepKind = undefined
      }
      continue
    }

    if (entry.type === 'todo_updated' && entry.runId === currentRunId) {
      currentTodo = {
        items: entry.items.map((item) => ({ ...item })),
        updatedAt: timestamp,
      }
      continue
    }

    if (entry.type === 'pause_requested' && entry.pause.runId === currentRunId) {
      currentPause = entry.pause
      currentRunStatus = inferWorkflowStatus(currentRunStatus, 'paused')
      continue
    }

    if (entry.type === 'pause_resolved' && entry.runId === currentRunId) {
      if (currentPause?.pauseId === entry.pauseId) {
        currentPause = undefined
      }
      currentRunStatus = inferWorkflowStatus(currentRunStatus, 'running')
      continue
    }

    if (entry.type === 'run_finished' && entry.runId === currentRunId) {
      currentRunStatus = entry.status
      currentRunCompletedAt = timestamp
      currentRunError = entry.error
    }
  }

  if (messages.length >= 2 && (!title || !title.trim())) {
    const firstUser = messages.find((message) => message.role === 'user')
    const candidate = normalizePreview(extractSessionText(firstUser?.content ?? ''))
    if (candidate) {
      title = candidate.slice(0, 24)
      titleSource = 'auto'
      titleStatus = 'ready'
    }
  }

  if (currentRunId && currentRunMode && currentRunStatus && currentRunStartedAt) {
    workflow = {
      runId: currentRunId as WorkflowProjection['runId'],
      mode: currentRunMode,
      status: currentRunStatus,
      currentStepId: currentStepId as WorkflowProjection['currentStepId'],
      currentStepKind,
      todo: currentTodo,
      pause: currentPause,
      error: currentRunError,
      startedAt: currentRunStartedAt,
      updatedAt,
      completedAt: currentRunCompletedAt,
    }
  }

  return {
    projection: {
      ...baseEntry,
      branchId: manager.getLeafId() ?? baseEntry.branchId,
      updatedAt,
      model,
      title,
      titleSource: titleSource as SessionTitleSource | undefined,
      titleStatus: titleStatus as SessionTitleStatus | undefined,
      latestPreview: preview,
      stats: {
        ...createEmptyStats(),
        inputTokens,
        outputTokens,
        totalTokens,
      },
      workflow,
    },
    messages: messages.slice(-Math.max(1, limit)),
  }
}

export function createSessionProjectionBase(args: {
  key: string
  sessionId: string
  branchId: string
  kind: SessionEntry['kind']
  channel: SessionEntry['channel']
  route: SessionRouteContext
}): SessionProjection {
  const now = Date.now()
  const title = args.route.conversationLabel?.trim() || undefined
  const displayName = title ?? args.route.senderName ?? args.route.peerId ?? '未命名会话'

  return {
    key: args.key,
    sessionId: args.sessionId,
    branchId: args.branchId,
    kind: args.kind,
    channel: args.channel,
    updatedAt: now,
    createdAt: now,
    title,
    titleSource: title ? 'route' : undefined,
    titleStatus: title ? 'ready' : undefined,
    displayName,
    origin: {
      label: args.route.conversationLabel,
      provider: args.channel,
      accountId: args.route.accountId,
      threadId: args.route.threadId,
      peerId: args.route.peerId,
      groupId: args.route.groupId,
      channelId: args.route.channelId,
    },
    route: args.route,
    deliveryContext: {
      channel: args.channel,
      accountId: args.route.accountId,
    },
    stats: createEmptyStats(),
  }
}
