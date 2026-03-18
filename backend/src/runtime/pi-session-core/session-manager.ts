/**
 * Vendored and adapted from:
 * /Users/hqy/Documents/zxh/github/pi-mono/packages/coding-agent/src/core/session-manager.ts
 *
 * WebClaw adaptation notes:
 * - 保留 append-only tree 与 buildSessionContext 的核心语义
 * - 删除 CLI/TUI label/tree 渲染相关表面
 * - 新增 WebClaw workflow/runtime entries，但这些 entries 不参与 LLM context
 * - buildSessionContext 只输出当前 agent runners 可消费的 user/assistant 消息
 */

import { randomUUID } from 'node:crypto'
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join, resolve } from 'node:path'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { AssistantMessage, UserMessage } from '@mariozechner/pi-ai'
import {
  createSessionId,
  extractSessionText,
  normalizeSessionAssistantContent,
} from '@webclaw/shared'
import type {
  BranchSummaryEntry,
  CompactionEntry,
  CustomEntry,
  CustomMessageEntry,
  FileEntry,
  ModelChangeEntry,
  PausePacket,
  PauseRequestedEntry,
  PauseResolvedEntry,
  RunFinishedEntry,
  RunId,
  RunStartedEntry,
  SerializedTodoItem,
  SessionEventEntry,
  SessionHeader,
  SessionInfoEntry,
  SessionMessageEntry,
  SessionMessageRecord,
  SessionProjection,
  SessionToolFinishedEntry,
  SessionToolInvokedEntry,
  SessionId,
  SessionMode,
  StepFinishedEntry,
  StepId,
  StepKind,
  StepStartedEntry,
  ThinkingLevel,
  ThinkingLevelChangeEntry,
  TodoUpdatedEntry,
  WorkflowStatus,
} from '@webclaw/shared'

export const CURRENT_SESSION_VERSION = 1

export interface SessionContext {
  messages: AgentMessage[]
  thinkingLevel: ThinkingLevel
  model: { provider: string; modelId: string } | null
}

export interface NewSessionOptions {
  id?: SessionId
  parentSession?: string
}

function generateId(byId: Map<string, SessionEventEntry>): string {
  for (let i = 0; i < 100; i++) {
    const id = randomUUID().slice(0, 8)
    if (!byId.has(id)) return id
  }
  return randomUUID()
}

function toIsoTimestamp(input?: number | string): string {
  if (typeof input === 'string') return input
  return new Date(input ?? Date.now()).toISOString()
}

function createContextUserMessage(text: string, timestamp: string): UserMessage {
  return {
    role: 'user',
    content: text,
    timestamp: new Date(timestamp).getTime(),
  }
}

function createContextAssistantMessage(record: SessionMessageRecord, timestamp: string): AssistantMessage {
  const content = normalizeSessionAssistantContent(record.content)

  const raw = record as Partial<AssistantMessage> & { provider?: string; model?: string }
  return {
    role: 'assistant',
    content,
    api: raw.api ?? 'openai-completions',
    provider: raw.provider ?? 'unknown',
    model: raw.model ?? 'unknown',
    usage: raw.usage ?? {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: raw.stopReason ?? 'stop',
    timestamp: typeof record.timestamp === 'number' ? record.timestamp : new Date(timestamp).getTime(),
  }
}

function createCompactionSummaryMessage(entry: CompactionEntry): UserMessage {
  return createContextUserMessage(
    `此前的对话已被压缩为以下摘要：\n\n${entry.summary}`,
    entry.timestamp,
  )
}

function createBranchSummaryMessage(entry: BranchSummaryEntry): UserMessage {
  return createContextUserMessage(
    `你正在继续一条分支，会话在 ${entry.fromId} 处分叉。此前分支摘要：\n\n${entry.summary}`,
    entry.timestamp,
  )
}

function createCustomMessage(entry: CustomMessageEntry): UserMessage {
  const text = extractSessionText(entry.content)
  return createContextUserMessage(text, entry.timestamp)
}

function toAgentMessage(record: SessionMessageRecord, timestamp: string): AgentMessage | null {
  if (record.role === 'user') {
    return createContextUserMessage(
      extractSessionText(record.content),
      timestamp,
    )
  }

  if (record.role === 'assistant') {
    return createContextAssistantMessage(record, timestamp)
  }

  return null
}

export function buildSessionContext(
  entries: SessionEventEntry[],
  leafId?: string | null,
  byId?: Map<string, SessionEventEntry>,
): SessionContext {
  if (!byId) {
    byId = new Map<string, SessionEventEntry>()
    for (const entry of entries) {
      byId.set(entry.id, entry)
    }
  }

  if (leafId === null) {
    return { messages: [], thinkingLevel: 'off', model: null }
  }

  let leaf: SessionEventEntry | undefined = undefined
  if (leafId) {
    leaf = byId.get(leafId)
  }
  if (!leaf) {
    leaf = entries[entries.length - 1]
  }
  if (!leaf) {
    return { messages: [], thinkingLevel: 'off', model: null }
  }

  const path: SessionEventEntry[] = []
  let current: SessionEventEntry | undefined = leaf
  while (current) {
    path.unshift(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }

  let thinkingLevel: ThinkingLevel = 'off'
  let model: { provider: string; modelId: string } | null = null
  let compaction: CompactionEntry | null = null

  for (const entry of path) {
    if (entry.type === 'thinking_level_change') {
      thinkingLevel = entry.thinkingLevel
    } else if (entry.type === 'model_change') {
      model = { provider: entry.provider, modelId: entry.modelId }
    } else if (entry.type === 'message' && entry.message.role === 'assistant') {
      model = {
        provider: entry.message.provider ?? 'unknown',
        modelId: entry.message.model ?? 'unknown',
      }
    } else if (entry.type === 'compaction') {
      compaction = entry
    }
  }

  const messages: AgentMessage[] = []

  const appendContextMessage = (entry: SessionEventEntry) => {
    if (entry.type === 'message') {
      const message = toAgentMessage(entry.message, entry.timestamp)
      if (message) messages.push(message)
      return
    }
    if (entry.type === 'custom_message') {
      messages.push(createCustomMessage(entry))
      return
    }
    if (entry.type === 'branch_summary') {
      messages.push(createBranchSummaryMessage(entry))
    }
  }

  if (compaction) {
    messages.push(createCompactionSummaryMessage(compaction))

    const compactionIndex = path.findIndex((entry) => entry.type === 'compaction' && entry.id === compaction.id)
    let foundFirstKept = false

    for (let i = 0; i < compactionIndex; i++) {
      const entry = path[i]
      if (entry.id === compaction.firstKeptEntryId) {
        foundFirstKept = true
      }
      if (foundFirstKept) {
        appendContextMessage(entry)
      }
    }

    for (let i = compactionIndex + 1; i < path.length; i++) {
      appendContextMessage(path[i])
    }
  } else {
    for (const entry of path) {
      appendContextMessage(entry)
    }
  }

  return { messages, thinkingLevel, model }
}

function loadEntriesFromFile(filePath: string): FileEntry[] {
  if (!existsSync(filePath)) return []
  const content = readFileSync(filePath, 'utf8').trim()
  if (!content) return []
  const lines = content.split('\n').map((line) => line.trim()).filter(Boolean)
  const entries: FileEntry[] = []
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as FileEntry)
    } catch {
      // ignore malformed lines
    }
  }
  return entries
}

function writeJsonLines(path: string, entries: FileEntry[]): void {
  const tmpPath = `${path}.tmp`
  writeFileSync(tmpPath, entries.map((entry) => JSON.stringify(entry)).join('\n') + '\n', 'utf8')
  renameSync(tmpPath, path)
}

export class SessionManager {
  private readonly cwd: string
  private readonly sessionDir: string
  private readonly persist: boolean
  private sessionFile: string | undefined
  private sessionId: SessionId = createSessionId()
  private flushed = false
  private fileEntries: FileEntry[] = []
  private byId = new Map<string, SessionEventEntry>()
  private leafId: string | null = null

  constructor(options: { cwd: string; sessionDir: string; sessionFile?: string; persist?: boolean }) {
    this.cwd = options.cwd
    this.sessionDir = options.sessionDir
    this.persist = options.persist ?? true
    if (this.persist && !existsSync(this.sessionDir)) {
      mkdirSync(this.sessionDir, { recursive: true })
    }

    if (options.sessionFile) {
      this.setSessionFile(options.sessionFile)
    } else {
      this.newSession()
    }
  }

  getSessionId(): SessionId {
    return this.sessionId
  }

  getSessionFile(): string | undefined {
    return this.sessionFile
  }

  getSessionDir(): string {
    return this.sessionDir
  }

  getCwd(): string {
    return this.cwd
  }

  getLeafId(): string | null {
    return this.leafId
  }

  getLeafEntry(): SessionEventEntry | undefined {
    return this.leafId ? this.byId.get(this.leafId) : undefined
  }

  getEntry(id: string): SessionEventEntry | undefined {
    return this.byId.get(id)
  }

  getHeader(): SessionHeader | null {
    const header = this.fileEntries.find((entry) => entry.type === 'session')
    return (header as SessionHeader | undefined) ?? null
  }

  getEntries(): SessionEventEntry[] {
    return this.fileEntries.filter((entry): entry is SessionEventEntry => entry.type !== 'session')
  }

  getSessionName(): string | undefined {
    const entries = this.getEntries()
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i]
      if (entry.type === 'session_info' && entry.name?.trim()) {
        return entry.name.trim()
      }
    }
    return undefined
  }

  newSession(options?: NewSessionOptions): string | undefined {
    const id = options?.id ?? createSessionId()
    const timestamp = new Date().toISOString()
    const header: SessionHeader = {
      type: 'session',
      version: CURRENT_SESSION_VERSION,
      id,
      timestamp,
      cwd: this.cwd,
      parentSession: options?.parentSession,
    }

    this.sessionId = id
    this.fileEntries = [header]
    this.byId.clear()
    this.leafId = null
    this.flushed = false

    if (this.persist) {
      const safeTimestamp = timestamp.replace(/[:.]/g, '-')
      this.sessionFile = join(this.sessionDir, `${safeTimestamp}_${id}.jsonl`)
    }
    return this.sessionFile
  }

  setSessionFile(sessionFile: string): void {
    this.sessionFile = resolve(sessionFile)
    if (!existsSync(this.sessionFile)) {
      const explicitPath = this.sessionFile
      this.newSession()
      this.sessionFile = explicitPath
      this.flush()
      return
    }

    const entries = loadEntriesFromFile(this.sessionFile)
    const header = entries.find((entry) => entry.type === 'session') as SessionHeader | undefined
    if (!header) {
      rmSync(this.sessionFile, { force: true })
      const explicitPath = this.sessionFile
      this.newSession()
      this.sessionFile = explicitPath
      this.flush()
      return
    }

    this.fileEntries = entries
    this.sessionId = header.id as SessionId
    this._buildIndex()
    this.flushed = true
  }

  flush(): void {
    if (!this.persist || !this.sessionFile) return
    writeJsonLines(this.sessionFile, this.fileEntries)
    this.flushed = true
  }

  buildSessionContext(): SessionContext {
    return buildSessionContext(this.getEntries(), this.leafId, this.byId)
  }

  getBranch(fromId?: string): SessionEventEntry[] {
    const path: SessionEventEntry[] = []
    const startId = fromId ?? this.leafId
    let current = startId ? this.byId.get(startId) : undefined
    while (current) {
      path.unshift(current)
      current = current.parentId ? this.byId.get(current.parentId) : undefined
    }
    return path
  }

  branch(branchFromId: string): void {
    if (!this.byId.has(branchFromId)) {
      throw new Error(`Entry ${branchFromId} not found`)
    }
    this.leafId = branchFromId
  }

  resetLeaf(): void {
    this.leafId = null
  }

  branchWithSummary(branchFromId: string | null, summary: string, details?: unknown): string {
    if (branchFromId !== null && !this.byId.has(branchFromId)) {
      throw new Error(`Entry ${branchFromId} not found`)
    }
    this.leafId = branchFromId
    const entry: BranchSummaryEntry = {
      type: 'branch_summary',
      id: generateId(this.byId),
      parentId: branchFromId,
      timestamp: new Date().toISOString(),
      fromId: branchFromId ?? 'root',
      summary,
      details,
    }
    this._appendEntry(entry)
    return entry.id
  }

  createBranchedSession(leafId: string): string | undefined {
    const path = this.getBranch(leafId)
    if (path.length === 0) {
      throw new Error(`Entry ${leafId} not found`)
    }

    const previousSessionFile = this.sessionFile
    const newSessionFile = this.newSession({ parentSession: previousSessionFile })
    const header = this.getHeader()
    const currentHeader = header ? [header] : []
    const pathEntries = path.slice()
    this.fileEntries = [...currentHeader, ...pathEntries]
    this._buildIndex()
    this.flush()
    return newSessionFile
  }

  appendMessage(message: SessionMessageRecord): string {
    const entry: SessionMessageEntry = {
      type: 'message',
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: toIsoTimestamp(message.timestamp),
      message,
    }
    this._appendEntry(entry)
    return entry.id
  }

  appendThinkingLevelChange(thinkingLevel: ThinkingLevel): string {
    const entry: ThinkingLevelChangeEntry = {
      type: 'thinking_level_change',
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      thinkingLevel,
    }
    this._appendEntry(entry)
    return entry.id
  }

  appendModelChange(provider: string, modelId: string): string {
    const entry: ModelChangeEntry = {
      type: 'model_change',
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      provider,
      modelId,
    }
    this._appendEntry(entry)
    return entry.id
  }

  appendCompaction(summary: string, firstKeptEntryId: string, tokensBefore: number, details?: unknown): string {
    const entry: CompactionEntry = {
      type: 'compaction',
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      summary,
      firstKeptEntryId,
      tokensBefore,
      details,
    }
    this._appendEntry(entry)
    return entry.id
  }

  appendCustomEntry(customType: string, data?: unknown): string {
    const entry: CustomEntry = {
      type: 'custom',
      customType,
      data,
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
    }
    this._appendEntry(entry)
    return entry.id
  }

  appendCustomMessageEntry(customType: string, content: string | Array<{ type: 'text'; text: string }>, display: boolean, details?: unknown): string {
    const entry: CustomMessageEntry = {
      type: 'custom_message',
      customType,
      content,
      display,
      details,
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
    }
    this._appendEntry(entry)
    return entry.id
  }

  appendSessionInfo(name: string): string {
    const entry: SessionInfoEntry = {
      type: 'session_info',
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      name: name.trim(),
    }
    this._appendEntry(entry)
    return entry.id
  }

  appendRunStarted(runId: RunId, mode: SessionMode): string {
    const entry: RunStartedEntry = {
      type: 'run_started',
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      runId,
      mode,
    }
    this._appendEntry(entry)
    return entry.id
  }

  appendRunFinished(runId: RunId, status: Exclude<WorkflowStatus, 'queued' | 'running'>, error?: string): string {
    const entry: RunFinishedEntry = {
      type: 'run_finished',
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      runId,
      status,
      error,
    }
    this._appendEntry(entry)
    return entry.id
  }

  appendStepStarted(runId: RunId, stepId: StepId, kind: StepKind, title?: string, todoIndex?: number): string {
    const entry: StepStartedEntry = {
      type: 'step_started',
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      runId,
      stepId,
      kind,
      title,
      todoIndex,
    }
    this._appendEntry(entry)
    return entry.id
  }

  appendStepFinished(
    runId: RunId,
    stepId: StepId,
    kind: StepKind,
    status: 'completed' | 'failed',
    summary?: string,
    todoIndex?: number,
  ): string {
    const entry: StepFinishedEntry = {
      type: 'step_finished',
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      runId,
      stepId,
      kind,
      status,
      summary,
      todoIndex,
    }
    this._appendEntry(entry)
    return entry.id
  }

  appendTodoUpdated(runId: RunId, items: SerializedTodoItem[]): string {
    const entry: TodoUpdatedEntry = {
      type: 'todo_updated',
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      runId,
      items: items.map((item) => ({ ...item })),
    }
    this._appendEntry(entry)
    return entry.id
  }

  appendPauseRequested(pause: PausePacket): string {
    const entry: PauseRequestedEntry = {
      type: 'pause_requested',
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      pause,
    }
    this._appendEntry(entry)
    return entry.id
  }

  appendPauseResolved(pauseId: PausePacket['pauseId'], runId: RunId, input: string): string {
    const entry: PauseResolvedEntry = {
      type: 'pause_resolved',
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      pauseId,
      runId,
      resolvedAt: Date.now(),
      input,
    }
    this._appendEntry(entry)
    return entry.id
  }

  appendSessionToolInvoked(runId: RunId, stepId: StepId, toolName: string, detail?: string): string {
    const entry: SessionToolInvokedEntry = {
      type: 'session_tool_invoked',
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      runId,
      stepId,
      toolName,
      detail,
    }
    this._appendEntry(entry)
    return entry.id
  }

  appendSessionToolFinished(
    runId: RunId,
    stepId: StepId,
    toolName: string,
    status: 'completed' | 'failed',
    detail?: string,
  ): string {
    const entry: SessionToolFinishedEntry = {
      type: 'session_tool_finished',
      id: generateId(this.byId),
      parentId: this.leafId,
      timestamp: new Date().toISOString(),
      runId,
      stepId,
      toolName,
      status,
      detail,
    }
    this._appendEntry(entry)
    return entry.id
  }

  deleteSessionFile(): void {
    if (this.sessionFile) {
      rmSync(this.sessionFile, { force: true })
    }
  }

  private _buildIndex(): void {
    this.byId.clear()
    this.leafId = null
    for (const entry of this.fileEntries) {
      if (entry.type === 'session') continue
      this.byId.set(entry.id, entry)
      this.leafId = entry.id
    }
  }

  private _persist(entry: SessionEventEntry): void {
    if (!this.persist || !this.sessionFile) return
    if (!existsSync(dirname(this.sessionFile))) {
      mkdirSync(dirname(this.sessionFile), { recursive: true })
    }
    if (!this.flushed) {
      writeJsonLines(this.sessionFile, this.fileEntries)
      this.flushed = true
      return
    }
    appendFileSync(this.sessionFile, `${JSON.stringify(entry)}\n`, 'utf8')
  }

  private _appendEntry(entry: SessionEventEntry): void {
    this.fileEntries.push(entry)
    this.byId.set(entry.id, entry)
    this.leafId = entry.id
    this._persist(entry)
  }
}

function dirname(path: string): string {
  return path.split('/').slice(0, -1).join('/') || '.'
}

export function createProjectionFromManager(manager: SessionManager, baseProjection: SessionProjection): SessionProjection {
  return {
    ...baseProjection,
    branchId: manager.getLeafId() ?? baseProjection.branchId,
  }
}
