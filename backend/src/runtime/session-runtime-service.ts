import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentEvent, AgentMessage } from '@mariozechner/pi-agent-core'
import type { Message, Model } from '@mariozechner/pi-ai'
import type {
  ClientEventPayloadMap,
  ClientModelOptions,
  PausePacket,
  RunId,
  SerializedTodoItem,
  ServerEventPayloadMap,
  SessionEntry,
  SessionMessageRecord,
  SessionMode,
  SessionProjection,
  SessionRouteContext,
  StepDeltaStream,
  StepId,
  StepKind,
  WorkflowStatus,
} from '@webclaw/shared'
import {
  createPauseId,
  createRunId,
  createSessionId,
  createStepId,
  extractSessionText,
  normalizeSessionAssistantContent,
  resolveThinkingLevel,
} from '@webclaw/shared'
import { getConfig, type Env } from '../config/index.js'
import { logger } from '../utils/logger.js'
import { createVllmModel } from '../agent/vllm-model.js'
import { runManagerAgent, runSimpleAgent, runWorkerAgent } from '../agent/index.js'
import { createTodoManager } from '../core/todo/todo-manager.js'
import { clearCurrentToolSessionKey, setCurrentToolSessionKey } from '../agent/tools/session-tools/index.js'
import { resolveSessionKey } from './session-key.js'
import { SessionManager } from './pi-session-core/session-manager.js'
import { createSessionProjectionBase, rebuildSessionProjection } from './projections.js'

interface SessionIndexShape {
  entries: Record<string, SessionProjection>
}

interface ActiveRunHandle {
  readonly runId: RunId
  readonly mode: SessionMode
  readonly abortController: AbortController
}

export interface SessionDetail {
  entry: SessionProjection
  snapshot: { projection: SessionProjection } | null
  isActive: boolean
}

interface BoundSession {
  projection: SessionProjection
  manager: SessionManager
  created: boolean
  restored: boolean
  messageCount: number
}

interface StepLifecycle {
  readonly stepId: StepId
  readonly kind: StepKind
  readonly title?: string
  readonly todoIndex?: number
}

export interface SendRunResult {
  runId: string
  status: 'ok' | 'error'
  reply?: string
  error?: string
}

export interface SpawnTaskResult {
  status: 'accepted' | 'error'
  sessionKey?: string
  runId?: string
  error?: string
}

function summarizeContent(content: unknown): string {
  const text = extractSessionText(content).trim()
  return text.length > 240 ? `${text.slice(0, 240)}...` : text
}

function lastAssistantText(messages: AgentMessage[]): string {
  const last = [...messages].reverse().find((message) => message.role === 'assistant') as
    | (SessionMessageRecord & { content: unknown })
    | undefined
  return last ? extractSessionText(last.content) : ''
}

function toSessionMessageRecord(message: AgentMessage): SessionMessageRecord {
  const raw = message as unknown as SessionMessageRecord
  return {
    ...raw,
    role: message.role,
    content: message.role === 'assistant'
      ? normalizeSessionAssistantContent(raw.content)
      : extractSessionText(raw.content),
    timestamp: typeof raw.timestamp === 'number' ? raw.timestamp : Date.now(),
    provider: raw.provider,
    model: raw.model,
  }
}

function messageCount(manager: SessionManager): number {
  return manager.getEntries().filter((entry) => entry.type === 'message' && (entry.message.role === 'user' || entry.message.role === 'assistant')).length
}

function createSessionStorePaths(rootDir: string) {
  return {
    rootDir,
    indexFile: join(rootDir, 'sessions.json'),
    sessionDir: join(rootDir, 'sessions'),
  }
}

function createAutoTitle(input: string): string | undefined {
  const normalized = input.replace(/\s+/g, ' ').trim()
  if (!normalized) return undefined
  return normalized.length > 24 ? normalized.slice(0, 24) : normalized
}

async function readJsonOrFallback<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, 'utf8')
    const trimmed = raw.trim()
    if (!trimmed) return fallback
    return JSON.parse(trimmed) as T
  } catch {
    return fallback
  }
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const tmpPath = `${path}.tmp`
  await writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8')
  await rename(tmpPath, path)
}

export class SessionRuntimeService {
  private readonly cfg: Env
  private readonly paths: ReturnType<typeof createSessionStorePaths>
  private readonly projections = new Map<string, SessionProjection>()
  private readonly managers = new Map<string, SessionManager>()
  private readonly notifiers = new Map<string, (event: keyof ServerEventPayloadMap, payload: ServerEventPayloadMap[keyof ServerEventPayloadMap]) => void>()
  private readonly activeRuns = new Map<string, ActiveRunHandle>()
  private readonly locks = new Map<string, Promise<void>>()

  constructor(config = getConfig()) {
    this.cfg = config
    this.paths = createSessionStorePaths(join(process.cwd(), this.cfg.SESSION_STORE_DIR))
  }

  async init(): Promise<void> {
    await mkdir(this.paths.rootDir, { recursive: true })
    await mkdir(this.paths.sessionDir, { recursive: true })
    if (!existsSync(this.paths.indexFile)) {
      await writeJsonAtomic(this.paths.indexFile, { entries: {} } satisfies SessionIndexShape)
    }
    const parsed = await readJsonOrFallback<SessionIndexShape>(this.paths.indexFile, { entries: {} })
    for (const [key, projection] of Object.entries(parsed.entries ?? {})) {
      this.projections.set(key, projection)
    }
  }

  async shutdown(): Promise<void> {
    await this.persistIndex()
  }

  setNotifier(
    sessionKey: string,
    notify: (event: keyof ServerEventPayloadMap, payload: ServerEventPayloadMap[keyof ServerEventPayloadMap]) => void,
  ): void {
    this.notifiers.set(sessionKey, notify)
  }

  clearNotifier(sessionKey: string): void {
    this.notifiers.delete(sessionKey)
  }

  private notify<T extends keyof ServerEventPayloadMap>(sessionKey: string, event: T, payload: ServerEventPayloadMap[T]): void {
    this.notifiers.get(sessionKey)?.(event, payload)
  }

  private async persistIndex(): Promise<void> {
    const entries = Object.fromEntries(this.projections.entries())
    await writeJsonAtomic(this.paths.indexFile, { entries } satisfies SessionIndexShape)
  }

  private sessionFilePath(sessionId: string): string {
    return join(this.paths.sessionDir, `${sessionId}.jsonl`)
  }

  private getOrCreateManager(sessionKey: string, projection: SessionProjection): SessionManager {
    const existing = this.managers.get(sessionKey)
    if (existing) return existing

    const manager = new SessionManager({
      cwd: process.cwd(),
      sessionDir: this.paths.sessionDir,
      sessionFile: this.sessionFilePath(projection.sessionId),
      persist: true,
    })
    this.managers.set(sessionKey, manager)
    return manager
  }

  private async refreshProjection(sessionKey: string): Promise<SessionProjection> {
    const projection = this.projections.get(sessionKey)
    if (!projection) {
      throw new Error(`会话不存在: ${sessionKey}`)
    }
    const manager = this.getOrCreateManager(sessionKey, projection)
    const beforeTitle = projection.title
    const snapshot = rebuildSessionProjection(projection, manager, 20)
    const nextProjection = snapshot.projection
    this.projections.set(sessionKey, nextProjection)
    await this.persistIndex()

    if (nextProjection.title && nextProjection.title !== beforeTitle) {
      this.notify(sessionKey, 'session_title_updated', {
        sessionKey,
        sessionId: nextProjection.sessionId,
        title: nextProjection.title,
        titleSource: nextProjection.titleSource ?? 'auto',
      })
    }
    return nextProjection
  }

  private async withLock<T>(sessionKey: string, task: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(sessionKey) ?? Promise.resolve()
    let release = () => {}
    const current = new Promise<void>((resolve) => {
      release = resolve
    })
    const queued = previous.then(() => current)
    this.locks.set(sessionKey, queued)
    await previous
    try {
      return await task()
    } finally {
      release()
      if (this.locks.get(sessionKey) === queued) {
        this.locks.delete(sessionKey)
      }
    }
  }

  async resolveSession(route: SessionRouteContext, preferredSessionKey?: string): Promise<BoundSession> {
    const binding = preferredSessionKey
      ? {
          key: preferredSessionKey,
          kind: this.projections.get(preferredSessionKey)?.kind ?? 'main',
          channel: this.projections.get(preferredSessionKey)?.channel ?? route.channel,
        }
      : resolveSessionKey(route, 'default', this.cfg.SESSION_MAIN_KEY)

    const existing = this.projections.get(binding.key)
    const created = !existing

    const projection = existing ?? createSessionProjectionBase({
      key: binding.key,
      sessionId: createSessionId(),
      branchId: 'root',
      kind: binding.kind,
      channel: binding.channel,
      route,
    })

    if (created) {
      const manager = new SessionManager({
        cwd: process.cwd(),
        sessionDir: this.paths.sessionDir,
        sessionFile: this.sessionFilePath(projection.sessionId),
        persist: true,
      })
      manager.appendThinkingLevelChange('off')
      if (projection.title?.trim()) {
        manager.appendSessionInfo(projection.title)
      }
      this.managers.set(binding.key, manager)
    }

    this.projections.set(binding.key, {
      ...projection,
      route,
      origin: {
        ...projection.origin,
        provider: binding.channel,
        peerId: route.peerId,
        groupId: route.groupId,
        channelId: route.channelId,
        threadId: route.threadId,
        accountId: route.accountId,
        label: route.conversationLabel,
      },
      updatedAt: Date.now(),
    })
    await this.persistIndex()

    const manager = this.getOrCreateManager(binding.key, this.projections.get(binding.key)!)
    const latest = await this.refreshProjection(binding.key)
    return {
      projection: latest,
      manager,
      created,
      restored: !created,
      messageCount: messageCount(manager),
    }
  }

  getProjection(sessionKey: string): SessionProjection | null {
    return this.projections.get(sessionKey) ?? null
  }

  async listSessions(args: { limit?: number; activeMinutes?: number; messageLimit?: number } = {}): Promise<Array<SessionProjection & { recentMessages?: SessionMessageRecord[] }>> {
    const now = Date.now()
    let rows = Array.from(this.projections.values()).sort((a, b) => b.updatedAt - a.updatedAt)
    if (args.activeMinutes && args.activeMinutes > 0) {
      const threshold = now - args.activeMinutes * 60 * 1000
      rows = rows.filter((entry) => entry.updatedAt >= threshold)
    }
    rows = rows.slice(0, args.limit ?? 50)

    if (!args.messageLimit || args.messageLimit <= 0) {
      return rows
    }

    return rows.map((entry) => {
      const manager = this.getOrCreateManager(entry.key, entry)
      const snapshot = rebuildSessionProjection(entry, manager, args.messageLimit)
      return {
        ...snapshot.projection,
        recentMessages: snapshot.messages,
      }
    })
  }

  async history(sessionKeyOrSessionId: string, limit = 50): Promise<SessionMessageRecord[]> {
    const projection = this.findProjection(sessionKeyOrSessionId)
    if (!projection) throw new Error(`会话不存在: ${sessionKeyOrSessionId}`)
    const manager = this.getOrCreateManager(projection.key, projection)
    const snapshot = rebuildSessionProjection(projection, manager, limit)
    return snapshot.messages
  }

  async getSession(sessionKeyOrSessionId: string): Promise<SessionDetail | null> {
    const projection = this.findProjection(sessionKeyOrSessionId)
    if (!projection) return null
    const latest = await this.refreshProjection(projection.key)
    return {
      entry: latest,
      snapshot: { projection: latest },
      isActive: this.managers.has(projection.key),
    }
  }

  async updateSessionTitle(sessionKeyOrSessionId: string, title: string): Promise<SessionProjection | null> {
    const projection = this.findProjection(sessionKeyOrSessionId)
    if (!projection) return null
    const manager = this.getOrCreateManager(projection.key, projection)
    manager.appendSessionInfo(title)
    const latest = await this.refreshProjection(projection.key)
    return {
      ...latest,
      title,
      titleSource: 'manual',
      titleStatus: 'ready',
    }
  }

  async deleteSession(sessionKeyOrSessionId: string): Promise<boolean> {
    const projection = this.findProjection(sessionKeyOrSessionId)
    if (!projection) return false
    this.activeRuns.delete(projection.key)
    this.notifiers.delete(projection.key)
    this.projections.delete(projection.key)
    const manager = this.managers.get(projection.key)
    if (manager) {
      manager.deleteSessionFile()
    } else {
      await rm(this.sessionFilePath(projection.sessionId), { force: true })
    }
    this.managers.delete(projection.key)
    await this.persistIndex()
    return true
  }

  cancelRun(sessionKey: string, runId?: string): boolean {
    const active = this.activeRuns.get(sessionKey)
    if (!active) return false
    if (runId && active.runId !== runId) return false
    active.abortController.abort()
    return true
  }

  async startRun(payload: ClientEventPayloadMap['run_start']): Promise<{ sessionKey: string; sessionId: string; runId: RunId }> {
    const bound = await this.resolveSession(payload.route, payload.sessionKey)
    if (this.activeRuns.has(bound.projection.key)) {
      throw new Error('当前会话正在运行，请稍后再试。')
    }
    const runId = createRunId()
    await this.withLock(bound.projection.key, async () => {
      await this.executeRun(bound, runId, payload.mode, payload.input, payload)
    })
    return {
      sessionKey: bound.projection.key,
      sessionId: bound.projection.sessionId,
      runId,
    }
  }

  async resumeRun(payload: ClientEventPayloadMap['run_resume']): Promise<{ sessionKey: string; sessionId: string; runId: RunId }> {
    const projection = this.findProjection(payload.sessionKey)
    if (!projection) {
      throw new Error(`会话不存在: ${payload.sessionKey}`)
    }
    if (this.activeRuns.has(projection.key)) {
      throw new Error('当前会话正在运行，请稍后再试。')
    }
    const latest = await this.refreshProjection(projection.key)
    const pause = latest.workflow?.pause
    if (!pause || pause.pauseId !== payload.pauseId) {
      throw new Error('当前会话没有匹配的暂停节点')
    }

    const manager = this.getOrCreateManager(projection.key, latest)
    const bound: BoundSession = {
      projection: latest,
      manager,
      created: false,
      restored: true,
      messageCount: messageCount(manager),
    }

    await this.withLock(projection.key, async () => {
      await this.executeRun(bound, pause.runId, 'plan', payload.input, payload, pause)
    })

    return {
      sessionKey: projection.key,
      sessionId: latest.sessionId,
      runId: pause.runId,
    }
  }

  async runSend(sessionKeyOrSessionId: string, message: string): Promise<SendRunResult> {
    const projection = this.findProjection(sessionKeyOrSessionId)
    if (!projection) {
      return { runId: createRunId(), status: 'error', error: `会话不存在: ${sessionKeyOrSessionId}` }
    }

    if (this.activeRuns.has(projection.key)) {
      return { runId: createRunId(), status: 'error', error: '目标会话正在运行' }
    }

    const route = projection.route
    if (!route) {
      return { runId: createRunId(), status: 'error', error: '目标会话缺少路由上下文' }
    }

    const runId = createRunId()
    const bound = await this.resolveSession(route, projection.key)
    let reply = ''

    await this.withLock(projection.key, async () => {
      reply = await this.executeRun(bound, runId, 'simple', message, { enableTools: false }, undefined, true)
    })

    return { runId, status: 'ok', reply }
  }

  async spawnTask(requesterSessionKey: string, task: string): Promise<SpawnTaskResult> {
    const route: SessionRouteContext = {
      channel: 'internal',
      chatType: 'dm',
      peerId: `spawn-${Date.now()}`,
      senderName: 'Session Tool',
      conversationLabel: '子任务会话',
    }
    const bound = await this.resolveSession(route)
    const runId = createRunId()
    void this.withLock(bound.projection.key, async () => {
      try {
        await this.executeRun(bound, runId, 'simple', task, { enableTools: true })
        this.notify(requesterSessionKey, 'session_tool_result', {
          tool: 'sessions_spawn',
          status: 'completed',
          runId,
          sessionKey: bound.projection.key,
          detail: '子任务会话执行完成',
        })
      } catch (error) {
        this.notify(requesterSessionKey, 'session_tool_result', {
          tool: 'sessions_spawn',
          status: 'failed',
          runId,
          sessionKey: bound.projection.key,
          detail: error instanceof Error ? error.message : String(error),
        })
      }
    })

    return {
      status: 'accepted',
      sessionKey: bound.projection.key,
      runId,
    }
  }

  private findProjection(keyOrSessionId: string): SessionProjection | null {
    const direct = this.projections.get(keyOrSessionId)
    if (direct) return direct
    for (const projection of this.projections.values()) {
      if (projection.sessionId === keyOrSessionId) return projection
    }
    return null
  }

  private createModel(options: ClientModelOptions): Model<'openai-completions'> {
    return createVllmModel({
      modelId: options.model,
      baseUrl: options.baseUrl,
      maxTokens: options.options?.maxTokens,
      thinkingProtocol: options.thinking?.protocol ?? 'off',
    })
  }

  private createUserMessage(input: string): SessionMessageRecord {
    return {
      role: 'user',
      content: input,
      timestamp: Date.now(),
    }
  }

  private emitRunState(sessionKey: string, projection: SessionProjection, runId: RunId, mode: SessionMode, status: WorkflowStatus, error?: string): void {
    this.notify(sessionKey, 'run_state', {
      sessionKey,
      sessionId: projection.sessionId,
      runId,
      mode,
      status,
      error,
    })
  }

  private emitStepState(
    sessionKey: string,
    runId: RunId,
    step: StepLifecycle,
    status: 'started' | 'completed' | 'failed',
    summary?: string,
  ): void {
    this.notify(sessionKey, 'step_state', {
      sessionKey,
      runId,
      stepId: step.stepId,
      kind: step.kind,
      status,
      title: step.title,
      todoIndex: step.todoIndex,
      summary,
    })
  }

  private emitStepDelta(
    sessionKey: string,
    runId: RunId,
    step: StepLifecycle,
    stream: StepDeltaStream,
    content: string,
  ): void {
    this.notify(sessionKey, 'step_delta', {
      sessionKey,
      runId,
      stepId: step.stepId,
      kind: step.kind,
      stream,
      content,
    })
  }

  private emitToolState(
    sessionKey: string,
    runId: RunId,
    stepId: StepId | undefined,
    status: 'start' | 'end',
    toolName: string,
    extra: { args?: unknown; summary?: string; isError?: boolean } = {},
  ): void {
    this.notify(sessionKey, 'tool_state', {
      sessionKey,
      runId,
      stepId,
      toolName,
      status,
      args: extra.args,
      summary: extra.summary,
      isError: extra.isError,
    })
  }

  private async executeRun(
    bound: BoundSession,
    runId: RunId,
    mode: SessionMode,
    input: string,
    modelOptions: ClientModelOptions & { systemPrompt?: string },
    resumePause?: PausePacket,
    returnReply = false,
  ): Promise<string> {
    const sessionKey = bound.projection.key
    const manager = bound.manager
    const model = this.createModel(modelOptions)
    const thinkingLevel = resolveThinkingLevel(modelOptions.thinking)
    const apiKey = modelOptions.apiKey ?? this.cfg.LLM_API_KEY
    const abortController = new AbortController()
    this.activeRuns.set(sessionKey, { runId, mode, abortController })
    setCurrentToolSessionKey(sessionKey)

    manager.appendThinkingLevelChange(thinkingLevel)

    if (bound.projection.model !== model.id) {
      manager.appendModelChange(model.provider, model.id)
    }

    if (resumePause) {
      manager.appendPauseResolved(resumePause.pauseId, runId, input)
    }

    const userMessage = this.createUserMessage(input)
    const contextBeforeInput = manager.buildSessionContext().messages
    manager.appendMessage(userMessage)
    manager.appendRunStarted(runId, mode)

    let latestProjection = await this.refreshProjection(sessionKey)
    this.emitRunState(sessionKey, latestProjection, runId, mode, 'running')

    try {
      if (mode === 'simple') {
        const reply = await this.executeSimple(bound, runId, userMessage, contextBeforeInput, model, apiKey, modelOptions, abortController.signal, thinkingLevel)
        manager.appendRunFinished(runId, 'completed')
        latestProjection = await this.refreshProjection(sessionKey)
        this.emitRunState(sessionKey, latestProjection, runId, mode, 'completed')
        return reply
      }

      const reply = await this.executePlan(bound, runId, userMessage, contextBeforeInput, model, apiKey, modelOptions, abortController.signal, thinkingLevel, resumePause)
      latestProjection = await this.refreshProjection(sessionKey)
      if (latestProjection.workflow?.status === 'paused') {
        this.emitRunState(sessionKey, latestProjection, runId, mode, 'paused')
      } else {
        manager.appendRunFinished(runId, 'completed')
        latestProjection = await this.refreshProjection(sessionKey)
        this.emitRunState(sessionKey, latestProjection, runId, mode, 'completed')
      }
      return reply
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      manager.appendRunFinished(runId, abortController.signal.aborted ? 'cancelled' : 'failed', message)
      latestProjection = await this.refreshProjection(sessionKey)
      this.emitRunState(sessionKey, latestProjection, runId, mode, abortController.signal.aborted ? 'cancelled' : 'failed', message)
      throw error
    } finally {
      const autoTitle = createAutoTitle(input)
      if (autoTitle && !bound.projection.title?.trim()) {
        manager.appendSessionInfo(autoTitle)
        await this.refreshProjection(sessionKey)
      }
      this.activeRuns.delete(sessionKey)
      clearCurrentToolSessionKey()
      await this.refreshProjection(sessionKey)
    }
  }

  private async executeSimple(
    bound: BoundSession,
    runId: RunId,
    _userMessage: SessionMessageRecord,
    contextMessages: AgentMessage[],
    model: Model<'openai-completions'>,
    apiKey: string,
    modelOptions: ClientModelOptions & { systemPrompt?: string },
    signal: AbortSignal,
    thinkingLevel: ReturnType<typeof resolveThinkingLevel>,
  ): Promise<string> {
    const step: StepLifecycle = {
      stepId: createStepId(),
      kind: 'simple_reply',
      title: '生成回复',
    }

    const sessionKey = bound.projection.key
    bound.manager.appendStepStarted(runId, step.stepId, step.kind, step.title)
    await this.refreshProjection(sessionKey)
    this.emitStepState(sessionKey, runId, step, 'started')

    const result = await runSimpleAgent({
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: extractSessionText((_userMessage as SessionMessageRecord).content) }],
          timestamp: Date.now(),
        },
      ],
      contextMessages,
      model,
      apiKey,
      thinkingLevel,
      temperature: modelOptions.options?.temperature,
      extraSystemPrompt: modelOptions.systemPrompt,
      signal,
      enableTools: modelOptions.enableTools ?? false,
      onEvent: (event) => {
        this.handleAgentEvent(sessionKey, runId, step, event)
      },
    })

    const newMessages = result.messages.slice(contextMessages.length)
    for (const message of newMessages) {
      if (message.role === 'assistant') {
        bound.manager.appendMessage(toSessionMessageRecord(message))
      }
    }

    const reply = lastAssistantText(newMessages)
    bound.manager.appendStepFinished(runId, step.stepId, step.kind, 'completed', reply)
    await this.refreshProjection(sessionKey)
    this.emitStepState(sessionKey, runId, step, 'completed', reply)
    return reply
  }

  private async executePlan(
    bound: BoundSession,
    runId: RunId,
    _userMessage: SessionMessageRecord,
    contextMessages: AgentMessage[],
    model: Model<'openai-completions'>,
    apiKey: string,
    modelOptions: ClientModelOptions & { systemPrompt?: string },
    signal: AbortSignal,
    thinkingLevel: ReturnType<typeof resolveThinkingLevel>,
    resumePause?: PausePacket,
  ): Promise<string> {
    const sessionKey = bound.projection.key
    const todoManager = createTodoManager()
    const currentItems = bound.projection.workflow?.todo?.items
    if (currentItems && currentItems.length > 0) {
      todoManager.loadItems(currentItems.map((item) => ({ ...item })))
    }

    if (!resumePause) {
      const plannerStep: StepLifecycle = {
        stepId: createStepId(),
        kind: 'planner',
        title: '生成计划',
      }
      bound.manager.appendStepStarted(runId, plannerStep.stepId, plannerStep.kind, plannerStep.title)
      await this.refreshProjection(sessionKey)
      this.emitStepState(sessionKey, runId, plannerStep, 'started')

      const managerResult = await runManagerAgent({
        messages: [
          {
            role: 'user',
            content: [{ type: 'text', text: extractSessionText((_userMessage as SessionMessageRecord).content) }],
            timestamp: Date.now(),
          },
        ],
        contextMessages,
        model,
        apiKey,
        thinkingLevel,
        temperature: modelOptions.options?.temperature,
        extraSystemPrompt: modelOptions.systemPrompt,
        signal,
        todoManager,
        onEvent: (event) => {
          this.handleAgentEvent(sessionKey, runId, plannerStep, event)
        },
      })

      if (managerResult.pause) {
        const pause: PausePacket = {
          pauseId: createPauseId(),
          runId,
          stepId: plannerStep.stepId,
          prompt: managerResult.pause.prompt,
          createdAt: Date.now(),
        }
        bound.manager.appendStepFinished(runId, plannerStep.stepId, plannerStep.kind, 'completed', '等待用户补充信息')
        bound.manager.appendPauseRequested(pause)
        bound.manager.appendRunFinished(runId, 'paused')
        await this.refreshProjection(sessionKey)
        this.emitStepState(sessionKey, runId, plannerStep, 'completed', '等待用户补充信息')
        this.notify(sessionKey, 'pause_requested', {
          sessionKey,
          runId,
          pause,
        })
        return ''
      }

      const managerMessages = managerResult.messages.slice(contextMessages.length)
      for (const message of managerMessages) {
        if (message.role === 'assistant') {
          bound.manager.appendMessage(toSessionMessageRecord(message))
        }
      }

      const items = todoManager.getItems().map((item) => ({ ...item }))
      bound.manager.appendTodoUpdated(runId, items)
      await this.refreshProjection(sessionKey)
      this.notify(sessionKey, 'todo_state', {
        sessionKey,
        runId,
        items,
      })

      bound.manager.appendStepFinished(runId, plannerStep.stepId, plannerStep.kind, 'completed', `生成 ${items.length} 个任务`)
      await this.refreshProjection(sessionKey)
      this.emitStepState(sessionKey, runId, plannerStep, 'completed', `生成 ${items.length} 个任务`)
    }

    let injectedInput = resumePause ? extractSessionText((_userMessage as SessionMessageRecord).content) : undefined
    while (true) {
      const inProgress = todoManager.getInProgress()
      const pending = inProgress ?? todoManager.getPending()
      if (!pending) break

      const [index, item] = pending
      if (item.status !== 'in_progress') {
        todoManager.markInProgress(index)
        bound.manager.appendTodoUpdated(runId, todoManager.getItems().map((todo) => ({ ...todo })))
        await this.refreshProjection(sessionKey)
        this.notify(sessionKey, 'todo_state', {
          sessionKey,
          runId,
          items: todoManager.getItems().map((todo) => ({ ...todo })),
        })
      }

      const step: StepLifecycle = {
        stepId: createStepId(),
        kind: 'task',
        title: item.activeForm,
        todoIndex: index,
      }
      bound.manager.appendStepStarted(runId, step.stepId, step.kind, step.title, step.todoIndex)
      await this.refreshProjection(sessionKey)
      this.emitStepState(sessionKey, runId, step, 'started')

      const prompt = injectedInput
        ? `${item.content}\n\n用户补充信息：\n${injectedInput}`
        : item.content
      injectedInput = undefined

      const workerResult = await runWorkerAgent({
        prompt,
        model,
        apiKey,
        thinkingLevel,
        temperature: modelOptions.options?.temperature,
        extraSystemPrompt: modelOptions.systemPrompt,
        signal,
        onEvent: (event) => {
          this.handleAgentEvent(sessionKey, runId, step, event)
        },
      })

      if (workerResult.pause) {
        const pause: PausePacket = {
          pauseId: createPauseId(),
          runId,
          stepId: step.stepId,
          prompt: workerResult.pause.prompt,
          createdAt: Date.now(),
        }
        bound.manager.appendPauseRequested(pause)
        bound.manager.appendStepFinished(runId, step.stepId, step.kind, 'completed', '等待用户补充信息', index)
        bound.manager.appendTodoUpdated(runId, todoManager.getItems().map((todo) => ({ ...todo })))
        bound.manager.appendRunFinished(runId, 'paused')
        await this.refreshProjection(sessionKey)
        this.emitStepState(sessionKey, runId, step, 'completed', '等待用户补充信息')
        this.notify(sessionKey, 'pause_requested', {
          sessionKey,
          runId,
          pause,
        })
        return ''
      }

      todoManager.markCompleted(index, workerResult.result)
      bound.manager.appendCustomMessageEntry(
        'task_result',
        [{ type: 'text', text: `任务 ${index + 1} 执行结果：\n${workerResult.result}` }],
        false,
      )
      bound.manager.appendTodoUpdated(runId, todoManager.getItems().map((todo) => ({ ...todo })))
      bound.manager.appendStepFinished(runId, step.stepId, step.kind, 'completed', workerResult.result, index)
      await this.refreshProjection(sessionKey)
      this.notify(sessionKey, 'todo_state', {
        sessionKey,
        runId,
        items: todoManager.getItems().map((todo) => ({ ...todo })),
      })
      this.emitStepState(sessionKey, runId, step, 'completed', workerResult.result)
    }

    return '计划执行完成'
  }

  private handleAgentEvent(
    sessionKey: string,
    runId: RunId,
    step: StepLifecycle,
    event: AgentEvent,
  ): void {
    if (event.type === 'message_update') {
      if (event.assistantMessageEvent.type === 'text_delta' && event.assistantMessageEvent.delta) {
        this.emitStepDelta(sessionKey, runId, step, 'text', event.assistantMessageEvent.delta)
        return
      }

      if (event.assistantMessageEvent.type === 'thinking_delta' && event.assistantMessageEvent.delta) {
        this.emitStepDelta(sessionKey, runId, step, 'thinking', event.assistantMessageEvent.delta)
      }
      return
    }

    if (event.type === 'tool_execution_start') {
      this.emitToolState(sessionKey, runId, step.stepId, 'start', event.toolName, { args: event.args })
      return
    }

    if (event.type === 'tool_execution_end') {
      this.emitToolState(sessionKey, runId, step.stepId, 'end', event.toolName, {
        summary: event.isError ? 'tool error' : 'tool completed',
        isError: event.isError,
      })
    }
  }
}

let runtimeService: SessionRuntimeService | null = null

export async function createSessionRuntimeService(config = getConfig()): Promise<SessionRuntimeService> {
  if (runtimeService) return runtimeService
  const service = new SessionRuntimeService(config)
  await service.init()
  runtimeService = service
  return service
}

export function getSessionRuntimeService(): SessionRuntimeService {
  if (!runtimeService) {
    throw new Error('SessionRuntimeService 未初始化')
  }
  return runtimeService
}
