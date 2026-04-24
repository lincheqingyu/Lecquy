import { randomUUID } from 'node:crypto'
import type {
  PermissionDecisionOption,
  RunId,
  ServerRequestPayload,
  ServerRequestResolvedPayload,
  ServerRequestResponsePayload,
} from '@lecquy/shared'

export const RESOLVED_MESSAGES = {
  declined: '用户拒绝了审批请求',
  cancelled: '本次运行已取消',
  expired: '审批超时',
  clientCancelled: '用户取消了审批请求',
  serverCancelled: '服务端取消了审批请求',
} as const

export interface ConfirmationBrokerCreateInput {
  readonly sessionKey: string
  readonly sessionId?: string
  readonly runId: RunId
  readonly itemId: string
  readonly title: string
  readonly description: string
  readonly approval: ServerRequestPayload['approval']
}

export interface ConfirmationBrokerResolveResult {
  ok: boolean
  reason?: 'not_found' | 'already_resolved' | 'sessionKey_mismatch' | 'runId_mismatch' | 'itemId_mismatch'
}

export interface ConfirmationOutcome {
  readonly request: ServerRequestPayload
  readonly status: ServerRequestResolvedPayload['status']
  readonly message?: string
}

interface PendingEntry {
  readonly request: ServerRequestPayload
  readonly resolveOutcome: (outcome: ConfirmationOutcome) => void
  readonly timer: ReturnType<typeof setTimeout>
  resolved: boolean
}

interface ConfirmationBrokerOptions {
  readonly ttlMs?: number
  readonly now?: () => number
  readonly onRequest?: (request: ServerRequestPayload) => void
  readonly onResolved?: (resolved: ServerRequestResolvedPayload, request: ServerRequestPayload) => void
}

function mapDecisionToStatus(decision: PermissionDecisionOption): ServerRequestResolvedPayload['status'] {
  switch (decision) {
    case 'accept':
      return 'accepted'
    case 'accept_for_session':
      return 'accepted_for_session'
    case 'accept_for_project':
      return 'accepted_for_project'
    case 'decline':
      return 'declined'
    case 'cancel':
      return 'cancelled'
  }
}

export class ConfirmationBroker {
  private readonly ttlMs: number
  private readonly now: () => number
  private readonly onRequest?: (request: ServerRequestPayload) => void
  private readonly onResolved?: (resolved: ServerRequestResolvedPayload, request: ServerRequestPayload) => void
  private readonly pending = new Map<string, PendingEntry>()
  private readonly resolvedRequestIds = new Set<string>()

  constructor(options: ConfirmationBrokerOptions = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000
    this.now = options.now ?? (() => Date.now())
    this.onRequest = options.onRequest
    this.onResolved = options.onResolved
  }

  create(input: ConfirmationBrokerCreateInput): Promise<ConfirmationOutcome> {
    const createdAt = this.now()
    const request: ServerRequestPayload = {
      sessionKey: input.sessionKey,
      sessionId: input.sessionId,
      runId: input.runId,
      requestId: randomUUID(),
      itemId: input.itemId,
      kind: 'tool_approval',
      status: 'pending',
      createdAt,
      expiresAt: createdAt + this.ttlMs,
      title: input.title,
      description: input.description,
      approval: input.approval,
    }

    return new Promise<ConfirmationOutcome>((resolveOutcome) => {
      const timer = setTimeout(() => {
        this.finish(request.requestId, {
          sessionKey: request.sessionKey,
          runId: request.runId,
          requestId: request.requestId,
          itemId: request.itemId,
          kind: request.kind,
          status: 'expired',
          resolvedAt: this.now(),
          source: 'timeout',
          message: RESOLVED_MESSAGES.expired,
        })
      }, Math.max(0, this.ttlMs))

      this.pending.set(request.requestId, {
        request,
        resolveOutcome,
        timer,
        resolved: false,
      })

      this.onRequest?.(request)
    })
  }

  resolve(payload: ServerRequestResponsePayload): ConfirmationBrokerResolveResult {
    const entry = this.pending.get(payload.requestId)
    if (!entry) {
      return this.resolvedRequestIds.has(payload.requestId)
        ? { ok: false, reason: 'already_resolved' }
        : { ok: false, reason: 'not_found' }
    }
    if (entry.resolved) {
      return { ok: false, reason: 'already_resolved' }
    }
    if (entry.request.sessionKey !== payload.sessionKey) {
      return { ok: false, reason: 'sessionKey_mismatch' }
    }
    if (entry.request.runId !== payload.runId) {
      return { ok: false, reason: 'runId_mismatch' }
    }
    if (entry.request.itemId !== payload.itemId) {
      return { ok: false, reason: 'itemId_mismatch' }
    }

    this.finish(payload.requestId, {
      sessionKey: entry.request.sessionKey,
      runId: entry.request.runId,
      requestId: entry.request.requestId,
      itemId: entry.request.itemId,
      kind: entry.request.kind,
      status: mapDecisionToStatus(payload.decision),
      resolvedAt: this.now(),
      source: 'client',
      message:
        payload.decision === 'decline'
          ? RESOLVED_MESSAGES.declined
          : payload.decision === 'cancel'
            ? RESOLVED_MESSAGES.clientCancelled
            : undefined,
    })

    return { ok: true }
  }

  cancelByRun(sessionKey: string, runId: RunId, source: 'run_cancel' | 'server' = 'run_cancel'): void {
    for (const [requestId, entry] of this.pending.entries()) {
      if (entry.resolved) continue
      if (entry.request.sessionKey !== sessionKey || entry.request.runId !== runId) continue

      this.finish(requestId, {
        sessionKey,
        runId,
        requestId: entry.request.requestId,
        itemId: entry.request.itemId,
        kind: entry.request.kind,
        status: 'cancelled',
        resolvedAt: this.now(),
        source,
        message: source === 'run_cancel' ? RESOLVED_MESSAGES.cancelled : RESOLVED_MESSAGES.serverCancelled,
      })
    }
  }

  getPending(sessionKey: string): ServerRequestPayload[] {
    return [...this.pending.values()]
      .filter((entry) => !entry.resolved && entry.request.sessionKey === sessionKey)
      .map((entry) => entry.request)
  }

  private finish(requestId: string, resolved: ServerRequestResolvedPayload): void {
    const entry = this.pending.get(requestId)
    if (!entry || entry.resolved) return

    entry.resolved = true
    clearTimeout(entry.timer)
    this.pending.delete(requestId)
    this.resolvedRequestIds.add(requestId)
    this.onResolved?.(resolved, entry.request)
    entry.resolveOutcome({
      request: entry.request,
      status: resolved.status,
      message: resolved.message,
    })
  }
}
