import { join } from 'node:path'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { AssistantMessage, UserMessage } from '@mariozechner/pi-ai'
import type { SessionEntry, SessionRouteContext, SessionStats } from '@webclaw/shared'
import { createSessionId } from '@webclaw/shared'
import { getConfig, type Env } from '../config/index.js'
import { logger } from '../utils/logger.js'
import { createVllmModel } from '../agent/vllm-model.js'
import { runSimpleAgent, runWorkerAgent } from '../agent/index.js'
import { resolveSessionKey } from './session-key.js'
import { shouldRotateSession } from './session-policy.js'
import { applyContextPruning } from './session-pruner.js'
import { SessionStore } from './session-store.js'
import {
  createRuntimeState,
  restoreRuntimeState,
  serializeRuntimeState,
  type ActiveSession,
  type SessionPruningConfig,
  type SessionRouteEnvelope,
  type SessionRuntimeState,
} from './types.js'

function parseDurationMs(input: string): number {
  const m = input.trim().match(/^(\d+)(ms|s|m|h)$/i)
  if (!m) return 5 * 60 * 1000
  const value = Number(m[1])
  const unit = m[2].toLowerCase()
  if (unit === 'ms') return value
  if (unit === 's') return value * 1000
  if (unit === 'm') return value * 60 * 1000
  return value * 60 * 60 * 1000
}

function extractAssistantText(messages: AgentMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'assistant') as AssistantMessage | undefined
  if (!last) return ''
  if (typeof last.content === 'string') return last.content
  if (!Array.isArray(last.content)) return ''
  return last.content
    .filter((part) => part && typeof part === 'object' && (part as { type?: string }).type === 'text')
    .map((part) => ((part as { text?: string }).text ?? ''))
    .join('\n')
}

function estimateContextTokens(messages: AgentMessage[]): number {
  const chars = messages.reduce((sum, m) => {
    if (typeof m.content === 'string') return sum + m.content.length
    try {
      return sum + JSON.stringify(m.content).length
    } catch {
      return sum
    }
  }, 0)
  return Math.ceil(chars / 4)
}

function extractUsageStats(messages: AgentMessage[]): Pick<SessionStats, 'inputTokens' | 'outputTokens' | 'totalTokens'> {
  const last = [...messages].reverse().find((m) => m.role === 'assistant') as AssistantMessage | undefined
  if (!last || !last.usage) return { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  return {
    inputTokens: last.usage.input ?? 0,
    outputTokens: last.usage.output ?? 0,
    totalTokens: last.usage.totalTokens ?? 0,
  }
}

interface SendRunResult {
  runId: string
  status: 'ok' | 'error'
  reply?: string
  error?: string
}

export interface SessionDetail {
  entry: SessionEntry
  snapshot: ReturnType<typeof serializeRuntimeState> | null
  isActive: boolean
}

export class SessionService {
  private readonly cfg: Env
  private readonly store: SessionStore
  private readonly states = new Map<string, SessionRuntimeState>()
  private readonly entries = new Map<string, SessionEntry>()
  private readonly pruner: SessionPruningConfig
  private readonly locks = new Map<string, Promise<void>>()
  private readonly pendingRuns = new Map<string, Promise<SendRunResult>>()
  private readonly notifiers = new Map<string, (event: string, payload: Record<string, unknown>) => void>()

  constructor(config = getConfig()) {
    this.cfg = config
    this.store = new SessionStore(join(process.cwd(), this.cfg.SESSION_STORE_DIR))
    this.pruner = {
      mode: this.cfg.SESSION_PRUNING_MODE,
      ttlMs: parseDurationMs(this.cfg.SESSION_PRUNING_TTL),
      keepLastAssistants: this.cfg.SESSION_PRUNING_KEEP_LAST_ASSISTANTS,
      softTrimRatio: this.cfg.SESSION_PRUNING_SOFT_RATIO,
      hardClearRatio: this.cfg.SESSION_PRUNING_HARD_RATIO,
      minPrunableToolChars: this.cfg.SESSION_PRUNING_MIN_TOOL_CHARS,
    }
  }

  async init(): Promise<void> {
    await this.store.init()
    const loaded = await this.store.loadIndex()
    for (const [key, entry] of Object.entries(loaded)) {
      this.entries.set(key, entry)
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all(Array.from(this.states.values()).map((s) => this.persistState(s)))
    await this.persistIndex()
  }

  setNotifier(sessionKey: string, notify: (event: string, payload: Record<string, unknown>) => void): void {
    this.notifiers.set(sessionKey, notify)
  }

  clearNotifier(sessionKey: string): void {
    this.notifiers.delete(sessionKey)
  }

  private notify(sessionKey: string, event: string, payload: Record<string, unknown>): void {
    this.notifiers.get(sessionKey)?.(event, payload)
  }

  private async persistIndex(): Promise<void> {
    const entries = Object.fromEntries(this.entries.entries())
    await this.store.saveIndex(entries)
  }

  private createEntry(
    sessionKey: string,
    route: SessionRouteEnvelope,
    kind: SessionEntry['kind'],
    channel: SessionEntry['channel'],
    sessionId: string,
  ): SessionEntry {
    const now = Date.now()
    return {
      key: sessionKey,
      sessionId,
      kind,
      channel,
      createdAt: now,
      updatedAt: now,
      displayName: route.conversationLabel ?? route.senderName,
      origin: {
        label: route.conversationLabel,
        provider: channel,
        from: route.from,
        to: route.to,
        accountId: route.accountId,
        threadId: route.threadId,
      },
      deliveryContext: { channel, to: route.to, accountId: route.accountId },
      stats: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        contextTokens: 0,
      },
    }
  }

  async resolveActiveSession(route: SessionRouteEnvelope): Promise<ActiveSession & { newSession: boolean }> {
    const resolved = resolveSessionKey(route, 'default', this.cfg.SESSION_MAIN_KEY)
    const existing = this.entries.get(resolved.key)
    const rotate = existing ? shouldRotateSession(existing, this.cfg) : true

    const entry = (!existing || rotate)
      ? this.createEntry(resolved.key, route, resolved.kind, resolved.channel, createSessionId())
      : {
          ...existing,
          updatedAt: Date.now(),
        }

    let restored = false
    let state = this.states.get(resolved.key)

    if (!state || state.sessionId !== entry.sessionId) {
      const snapshot = await this.store.loadSnapshot(entry.sessionId)
      if (snapshot) {
        state = restoreRuntimeState(snapshot, resolved.key)
        restored = true
      } else {
        state = createRuntimeState(resolved.key, entry.sessionId as ReturnType<typeof createSessionId>)
      }
      this.states.set(resolved.key, state)
    }

    state.lastActiveAt = Date.now()
    this.entries.set(resolved.key, entry)
    await this.persistIndex()

    return { state, entry, restored, newSession: !existing || rotate }
  }

  getEntryByKeyOrSessionId(keyOrSessionId: string): SessionEntry | null {
    const direct = this.entries.get(keyOrSessionId)
    if (direct) return direct
    for (const entry of this.entries.values()) {
      if (entry.sessionId === keyOrSessionId) return entry
    }
    return null
  }

  async getSession(keyOrSessionId: string): Promise<SessionDetail | null> {
    const entry = this.getEntryByKeyOrSessionId(keyOrSessionId)
    if (!entry) return null
    const state = this.states.get(entry.key)
    const snapshot = state
      ? serializeRuntimeState(state)
      : await this.store.loadSnapshot(entry.sessionId)

    return {
      entry,
      snapshot,
      isActive: this.states.has(entry.key),
    }
  }

  async listSessions(args: { limit?: number; activeMinutes?: number; messageLimit?: number } = {}): Promise<Array<SessionEntry & { messages?: unknown[] }>> {
    const now = Date.now()
    let rows = Array.from(this.entries.values())
      .sort((a, b) => b.updatedAt - a.updatedAt)

    if (args.activeMinutes && args.activeMinutes > 0) {
      const threshold = now - args.activeMinutes * 60 * 1000
      rows = rows.filter((r) => r.updatedAt >= threshold)
    }
    rows = rows.slice(0, args.limit ?? 50)

    if (!args.messageLimit || args.messageLimit <= 0) {
      return rows
    }

    const enriched = await Promise.all(rows.map(async (entry) => ({
      ...entry,
      messages: (await this.store.readTranscript(entry.sessionId, args.messageLimit))
        .filter((m) => m.role !== 'toolResult'),
    })))

    return enriched
  }

  async history(sessionKeyOrSessionId: string, limit = 50, includeTools = false): Promise<unknown[]> {
    const entry = this.getEntryByKeyOrSessionId(sessionKeyOrSessionId)
    if (!entry) throw new Error(`会话不存在: ${sessionKeyOrSessionId}`)
    const rows = await this.store.readTranscript(entry.sessionId, limit)
    if (includeTools) return rows
    return rows.filter((row) => row.role !== 'toolResult')
  }

  async deleteSession(keyOrSessionId: string): Promise<boolean> {
    const entry = this.getEntryByKeyOrSessionId(keyOrSessionId)
    if (!entry) return false

    this.states.delete(entry.key)
    this.notifiers.delete(entry.key)
    this.entries.delete(entry.key)

    await Promise.all([
      this.store.deleteSnapshot(entry.sessionId),
      this.store.deleteTranscript(entry.sessionId),
    ])
    await this.persistIndex()
    return true
  }

  private async withLock<T>(sessionKey: string, task: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(sessionKey) ?? Promise.resolve()
    let release = () => {}
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = prev.then(() => current)
    this.locks.set(sessionKey, queued)
    await prev
    try {
      return await task()
    } finally {
      release()
      if (this.locks.get(sessionKey) === queued) {
        this.locks.delete(sessionKey)
      }
    }
  }

  async runSend(sessionKeyOrSessionId: string, message: string): Promise<SendRunResult> {
    const entry = this.getEntryByKeyOrSessionId(sessionKeyOrSessionId)
    if (!entry) {
      return { runId: createSessionId(), status: 'error', error: `会话不存在: ${sessionKeyOrSessionId}` }
    }
    const runId = createSessionId()
    const run = this.withLock(entry.key, async () => {
      try {
        const state = this.states.get(entry.key) ?? createRuntimeState(entry.key, entry.sessionId as ReturnType<typeof createSessionId>)
        this.states.set(entry.key, state)

        const pruned = this.getPrunedContext(state)
        const userMessage: UserMessage = { role: 'user', content: message, timestamp: Date.now() }
        const model = createVllmModel({})
        const result = await runSimpleAgent({
          messages: [userMessage],
          contextMessages: pruned,
          model,
          apiKey: this.cfg.LLM_API_KEY,
          enableTools: false,
        })

        const newMessages = result.messages.slice(pruned.length)
        state.contextMessages = result.messages
        state.lastActiveAt = Date.now()
        this.touchModelCall(state)
        await this.recordRunResult(
          state,
          model.id,
          [userMessage as unknown as AgentMessage],
          newMessages,
          result.messages,
        )

        return {
          runId,
          status: 'ok' as const,
          reply: extractAssistantText(result.messages),
        }
      } catch (error) {
        return {
          runId,
          status: 'error' as const,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })

    this.pendingRuns.set(runId, run)
    run.finally(() => this.pendingRuns.delete(runId)).catch(() => undefined)
    return run
  }

  async spawnTask(requesterSessionKey: string, task: string): Promise<{ status: 'accepted'; runId: string; childSessionKey: string }> {
    const runId = createSessionId()
    const childSessionKey = `agent:default:subagent:${runId}`
    const childState = createRuntimeState(childSessionKey)
    this.states.set(childSessionKey, childState)
    const entry: SessionEntry = {
      key: childSessionKey,
      sessionId: childState.sessionId,
      kind: 'other',
      channel: 'internal',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      stats: { inputTokens: 0, outputTokens: 0, totalTokens: 0, contextTokens: 0 },
    }
    this.entries.set(childSessionKey, entry)
    await this.persistIndex()

    void this.withLock(childSessionKey, async () => {
      try {
        const result = await runWorkerAgent({
          prompt: task,
          model: createVllmModel({}),
          apiKey: this.cfg.LLM_API_KEY,
        })
        const assistant: AssistantMessage = {
          role: 'assistant',
          content: [{ type: 'text', text: result.result }],
          api: 'openai-completions',
          provider: 'openai',
          model: 'worker',
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason: 'stop',
          timestamp: Date.now(),
        }
        childState.contextMessages = [assistant]
        await this.store.appendTranscript(childState.sessionId, [assistant])
        await this.persistState(childState)

        this.notify(requesterSessionKey, 'session_tool_result', {
          tool: 'sessions_spawn',
          status: 'ok',
          runId,
          sessionKey: childSessionKey,
          detail: result.result.slice(0, 400),
        })
      } catch (error) {
        this.notify(requesterSessionKey, 'session_tool_result', {
          tool: 'sessions_spawn',
          status: 'error',
          runId,
          sessionKey: childSessionKey,
          detail: error instanceof Error ? error.message : String(error),
        })
      }
    })

    return { status: 'accepted', runId, childSessionKey }
  }

  getPrunedContext(state: SessionRuntimeState): AgentMessage[] {
    if (this.pruner.mode === 'off') return state.contextMessages
    const now = Date.now()
    if (state.lastAnthropicCallAt && now - state.lastAnthropicCallAt <= this.pruner.ttlMs) {
      return state.contextMessages
    }

    const pruned = applyContextPruning(state.contextMessages, this.pruner, 200_000)
    if (pruned.prunedCount > 0) {
      logger.info('session pruning applied', {
        sessionKey: state.sessionKey,
        prunedCount: pruned.prunedCount,
        prunedChars: pruned.prunedChars,
      })
    }
    return pruned.messages
  }

  async recordRunResult(
    state: SessionRuntimeState,
    modelId: string,
    promptMessages: AgentMessage[],
    newMessages: AgentMessage[],
    mergedMessages: AgentMessage[],
  ): Promise<void> {
    const entry = this.entries.get(state.sessionKey)
    if (!entry) return

    const usage = extractUsageStats(mergedMessages)
    const contextTokens = estimateContextTokens(mergedMessages)
    const now = Date.now()
    this.entries.set(state.sessionKey, {
      ...entry,
      updatedAt: now,
      model: modelId,
      stats: {
        inputTokens: entry.stats.inputTokens + usage.inputTokens,
        outputTokens: entry.stats.outputTokens + usage.outputTokens,
        totalTokens: entry.stats.totalTokens + usage.totalTokens,
        contextTokens,
      },
    })

    await this.store.appendTranscript(state.sessionId, [...promptMessages, ...newMessages])
    await this.persistState(state)
    await this.persistIndex()
  }

  touchModelCall(state: SessionRuntimeState): void {
    state.lastAnthropicCallAt = Date.now()
  }

  async persistState(state: SessionRuntimeState): Promise<void> {
    await this.store.saveSnapshot(state.sessionId, serializeRuntimeState(state))
  }
}

let globalSessionService: SessionService | null = null

export async function createSessionService(): Promise<SessionService> {
  const service = new SessionService()
  await service.init()
  globalSessionService = service
  return service
}

export function getSessionService(): SessionService {
  if (!globalSessionService) {
    throw new Error('SessionService 未初始化')
  }
  return globalSessionService
}
