import { existsSync } from 'node:fs'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type { AgentEvent, AgentMessage, AgentTool } from '@mariozechner/pi-agent-core'
import type { ImageContent, Message, Model, TextContent, UserMessage } from '@mariozechner/pi-ai'
import type {
  ArtifactDetail,
  ArtifactTraceItem,
  ChatAttachment,
  ChatFileAttachment,
  ClientEventPayloadMap,
  ClientModelOptions,
  GeneratedFileArtifact,
  PausePacket,
  RunId,
  SerializedTodoItem,
  ServerEventPayloadMap,
  SessionEntry,
  SessionEventEntry,
  SessionMessageRecord,
  SessionMode,
  SessionProjection,
  SessionRouteContext,
  StepDeltaStream,
  StepId,
  StepKind,
  WorkflowStatus,
} from '@lecquy/shared'
import {
  createPauseId,
  createRunId,
  createSessionId,
  createStepId,
  extractSessionText,
  normalizeSessionAssistantContent,
  normalizeSessionUserContent,
  resolveThinkingLevel,
} from '@lecquy/shared'
import { getConfig, type Env } from '../config/index.js'
import { logger } from '../utils/logger.js'
import { createVllmModel } from '../agent/vllm-model.js'
import {
  AgentExecutionError,
  createManagerTools,
  createSimpleTools,
  createWorkerTools,
  handleWorkerReceipt,
  runManagerAgent,
  runSimpleAgent,
  runWorkerAgent,
} from '../agent/index.js'
import type { AgentRuntimeEvent } from '../agent/tool-permission.js'
import { loadStartupSlices } from '../core/prompts/context-files.js'
import { buildLayeredSystemPrompt } from '../core/prompts/prompt-serializer.js'
import type { AgentRole, BuildLayeredPromptOptions, CapabilityBlock } from '../core/prompts/prompt-layer-types.js'
import { SkillSession } from '../core/skills/skill-session.js'
import { buildSystemPromptLegacy } from '../core/prompts/system-prompts.js'
import { createTodoManager } from '../core/todo/todo-manager.js'
import { migrateLegacyRuntimeStorage } from '../core/runtime-storage-migration.js'
import {
  type RuntimePaths,
  isWithinRoot,
  normalizeWorkspaceRelativePath,
  resolvePathWithinRoot,
  resolveRuntimePaths,
} from '../core/runtime-paths.js'
import { clearCurrentToolSessionKey, setCurrentToolSessionKey } from '../agent/tools/session-tools/index.js'
import { getPool } from '../db/client.js'
import { deleteRuntimeSession, syncRuntimeSession } from '../db/runtime-session-repository.js'
import { applyCompactionIfNeeded } from '../memory/compact.js'
import { getMemoryCoordinator } from '../memory/coordinator.js'
import { syncTodosToForesight } from '../memory/foresight-sync.js'
import { buildMemoryRecallBlockLegacy, buildMemoryRecallMessages } from '../memory/prompt-injector.js'
import { buildAugmentedContext } from './context/augmented-context-builder.js'
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

interface ResolvedArtifactHandle {
  readonly artifact: GeneratedFileArtifact
  readonly fullPath: string
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
  readonly startedAt?: number
  readonly finishedAt?: number
  readonly durationMs?: number
}

interface PromptBuildRequest {
  readonly sessionId: string
  readonly role: AgentRole
  readonly mode: SessionMode
  readonly route?: SessionRouteContext
  readonly modelId: string
  readonly thinkingLevel: ReturnType<typeof resolveThinkingLevel>
  readonly tools: ReadonlyArray<AgentTool<any>>
  readonly toolsEnabled: boolean
  readonly extraInstructions?: string
  readonly activeSkillName?: string
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

function summarizeToolResultDetail(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined
  const content = 'content' in result ? (result as { content?: unknown }).content : undefined
  const summary = summarizeContent(content)
  return summary.length > 0 ? summary : undefined
}

function extractPartialToolCall(event: AgentEvent): { toolName: string; args: unknown } | null {
  if (event.type !== 'message_update' || event.assistantMessageEvent.type !== 'toolcall_delta') {
    return null
  }

  const partial = 'partial' in event.assistantMessageEvent
    ? (event.assistantMessageEvent as { partial?: unknown }).partial
    : undefined
  const contentIndex = 'contentIndex' in event.assistantMessageEvent
    ? (event.assistantMessageEvent as { contentIndex?: unknown }).contentIndex
    : undefined
  if (!partial || typeof partial !== 'object' || typeof contentIndex !== 'number') {
    return null
  }

  const content = 'content' in partial ? (partial as { content?: unknown }).content : undefined
  if (!Array.isArray(content)) return null
  const toolCall = content[contentIndex]
  if (!toolCall || typeof toolCall !== 'object') return null

  const type = 'type' in toolCall ? (toolCall as { type?: unknown }).type : undefined
  const toolName = 'name' in toolCall ? (toolCall as { name?: unknown }).name : undefined
  const args = 'arguments' in toolCall ? (toolCall as { arguments?: unknown }).arguments : undefined
  if (type !== 'toolCall' || typeof toolName !== 'string') return null

  return {
    toolName,
    args,
  }
}

const WHITESPACE_PATTERN = /\s+/g

function resolveArtifactPath(filePath: string, paths: RuntimePaths): string {
  const normalized = normalizeWorkspaceRelativePath(filePath)
  const absolutePath = resolvePathWithinRoot(paths.workspaceDir, normalized)
  if (!isWithinRoot(paths.artifactsDocsDir, absolutePath)) {
    throw new Error(`artifact 路径不在允许目录内: ${filePath}`)
  }
  return absolutePath
}

function summarizeCommand(command: string): string {
  const normalized = command.replace(WHITESPACE_PATTERN, ' ').trim()
  if (!normalized) return 'command'

  const redacted = normalized
    .replace(/(\b(?:api[_-]?key|token|secret|password)\b\s*[:=]\s*)(["']?)[^\s"']+\2/gi, '$1[REDACTED]')
    .replace(/(--(?:api-key|token|secret|password)\s+)(\S+)/gi, '$1[REDACTED]')
    .replace(/\bsk-[A-Za-z0-9_-]+\b/g, '[REDACTED]')

  return redacted.length > 120 ? `${redacted.slice(0, 117)}...` : redacted
}

function isGeneratedFileArtifact(value: unknown): value is GeneratedFileArtifact {
  if (!value || typeof value !== 'object') return false
  const artifactId = 'artifactId' in value ? (value as { artifactId?: unknown }).artifactId : undefined
  const filePath = 'filePath' in value ? (value as { filePath?: unknown }).filePath : undefined
  const name = 'name' in value ? (value as { name?: unknown }).name : undefined
  const mimeType = 'mimeType' in value ? (value as { mimeType?: unknown }).mimeType : undefined
  const size = 'size' in value ? (value as { size?: unknown }).size : undefined
  const createdAt = 'createdAt' in value ? (value as { createdAt?: unknown }).createdAt : undefined
  const updatedAt = 'updatedAt' in value ? (value as { updatedAt?: unknown }).updatedAt : undefined

  return (
    typeof artifactId === 'string'
    && typeof filePath === 'string'
    && typeof name === 'string'
    && typeof mimeType === 'string'
    && typeof size === 'number'
    && typeof createdAt === 'number'
    && typeof updatedAt === 'number'
  )
}

function extractGeneratedArtifactsFromToolResult(result: unknown): GeneratedFileArtifact[] {
  if (!result || typeof result !== 'object') return []
  const details = 'details' in result ? (result as { details?: unknown }).details : undefined
  if (!details || typeof details !== 'object') return []
  const generatedFiles = 'generatedFiles' in details ? (details as { generatedFiles?: unknown }).generatedFiles : undefined
  if (!Array.isArray(generatedFiles)) return []
  return generatedFiles.filter(isGeneratedFileArtifact)
}

function buildArtifactTraceItems(stepId: StepId, toolName: string, args: unknown, result: unknown): ArtifactTraceItem[] {
  const timestamp = Date.now()
  if (toolName === 'read_file') {
    const path = args && typeof args === 'object' && 'path' in args ? (args as { path?: unknown }).path : undefined
    if (typeof path !== 'string' || !path.trim()) return []
    return [{
      traceId: `trace_${timestamp}_${Math.random().toString(16).slice(2, 8)}`,
      stepId,
      toolName,
      kind: 'viewed_file',
      title: '读取文件',
      subtitle: 'Viewed a file',
      detail: basename(path),
      timestamp,
    }]
  }

  if (toolName === 'write_file') {
    const details = result && typeof result === 'object' && 'details' in result ? (result as { details?: unknown }).details : undefined
    if (!details || typeof details !== 'object') return []
    const outputPath = 'outputPath' in details ? (details as { outputPath?: unknown }).outputPath : undefined
    const writeMode = 'writeMode' in details ? (details as { writeMode?: unknown }).writeMode : undefined
    if (typeof outputPath !== 'string' || (writeMode !== 'created' && writeMode !== 'updated')) return []
    return [{
      traceId: `trace_${timestamp}_${Math.random().toString(16).slice(2, 8)}`,
      stepId,
      toolName,
      kind: writeMode === 'created' ? 'created_file' : 'updated_file',
      title: writeMode === 'created' ? '创建文件' : '更新文件',
      subtitle: writeMode === 'created' ? 'Created a file' : 'Updated a file',
      detail: basename(outputPath),
      timestamp,
    }]
  }

  if (toolName === 'bash') {
    const command = args && typeof args === 'object' && 'command' in args ? (args as { command?: unknown }).command : undefined
    if (typeof command !== 'string' || !command.trim()) return []
    return [{
      traceId: `trace_${timestamp}_${Math.random().toString(16).slice(2, 8)}`,
      stepId,
      toolName,
      kind: 'ran_command',
      title: '运行命令',
      subtitle: 'Ran a command',
      detail: summarizeCommand(command),
      timestamp,
    }]
  }

  return []
}

function lastAssistantText(messages: AgentMessage[]): string {
  const last = [...messages].reverse().find((message) => message.role === 'assistant') as
    | (SessionMessageRecord & { content: unknown })
    | undefined
  return last ? extractSessionText(last.content) : ''
}

function appendAssistantMessages(manager: SessionManager, messages: AgentMessage[]): void {
  for (const message of messages) {
    if (message.role === 'assistant') {
      manager.appendMessage(toSessionMessageRecord(message))
    }
  }
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

function formatFileAttachmentForModel(attachment: Pick<ChatFileAttachment, 'name' | 'mimeType' | 'text' | 'truncated'>): string {
  return [
    `附件文件：${attachment.name}`,
    `MIME 类型：${attachment.mimeType}`,
    attachment.truncated ? '注意：文件内容已截断。' : '',
    '',
    attachment.text,
  ]
    .filter(Boolean)
    .join('\n')
}

function createUserContent(input: string, attachments: ChatAttachment[] = []): SessionMessageRecord['content'] {
  const blocks: ReturnType<typeof normalizeSessionUserContent> = []
  const normalizedInput = input.trim()
  const imageCount = attachments.filter((attachment) => attachment.kind === 'image').length
  const fileCount = attachments.filter((attachment) => attachment.kind === 'file').length

  if (normalizedInput.length > 0) {
    blocks.push({ type: 'text', text: normalizedInput })
  } else if (attachments.length > 0) {
    const parts: string[] = []
    if (imageCount > 0) parts.push(`${imageCount} 个图片附件`)
    if (fileCount > 0) parts.push(`${fileCount} 个文件附件`)
    blocks.push({
      type: 'text',
      text: `请结合我上传的${parts.join('和')}回答。`,
    })
  }

  for (const attachment of attachments) {
    if (attachment.kind === 'image') {
      blocks.push({
        type: 'image',
        data: attachment.data,
        mimeType: attachment.mimeType,
        name: attachment.name,
        size: attachment.size,
      })
      continue
    }

    blocks.push({
      type: 'file',
      name: attachment.name,
      mimeType: attachment.mimeType,
      text: attachment.text,
      size: attachment.size,
      truncated: attachment.truncated,
    })
  }

  if (blocks.length === 0) {
    return ''
  }

  return blocks.length === 1 && blocks[0].type === 'text'
    ? blocks[0].text
    : blocks
}

function createAgentUserMessage(record: SessionMessageRecord): UserMessage {
  const blocks = normalizeSessionUserContent(record.content)
  if (blocks.length === 0) {
    return {
      role: 'user',
      content: '',
      timestamp: typeof record.timestamp === 'number' ? record.timestamp : Date.now(),
    }
  }

  const content: Array<TextContent | ImageContent> = []

  for (const block of blocks) {
    if (block.type === 'text') {
      content.push({ type: 'text', text: block.text })
      continue
    }
    if (block.type === 'image') {
      content.push({ type: 'image', data: block.data, mimeType: block.mimeType })
      continue
    }
    content.push({ type: 'text', text: formatFileAttachmentForModel(block) })
  }

  return {
    role: 'user',
    content,
    timestamp: typeof record.timestamp === 'number' ? record.timestamp : Date.now(),
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
  await mkdir(dirname(path), { recursive: true })
  const tmpPath = `${path}.${process.pid}.${Date.now()}_${Math.random().toString(16).slice(2, 8)}.tmp`

  await writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf8')
  try {
    await rename(tmpPath, path)
  } catch (error) {
    await rm(tmpPath, { force: true }).catch(() => undefined)
    throw error
  }
}

export class SessionRuntimeService {
  private readonly cfg: Env
  private readonly runtimePaths: RuntimePaths
  private readonly paths: ReturnType<typeof createSessionStorePaths>
  private readonly projections = new Map<string, SessionProjection>()
  private readonly pgSyncState = new Map<string, { eventCount: number; updatedAt: number; title: string | null; mode: string | null }>()
  private readonly managers = new Map<string, SessionManager>()
  private readonly notifiers = new Map<string, (event: keyof ServerEventPayloadMap, payload: ServerEventPayloadMap[keyof ServerEventPayloadMap]) => void>()
  private readonly activeRuns = new Map<string, ActiveRunHandle>()
  private readonly locks = new Map<string, Promise<void>>()
  private readonly toolArgsByCallId = new Map<string, unknown>()
  private readonly skillSessions = new Map<string, SkillSession>()
  private readonly sessionModes = new Map<string, SessionMode>()

  constructor(config = getConfig()) {
    this.cfg = config
    this.runtimePaths = resolveRuntimePaths(undefined, this.cfg.SESSION_STORE_DIR)
    this.paths = createSessionStorePaths(this.runtimePaths.sessionStoreDir)
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
    this.skillSessions.clear()
    this.sessionModes.clear()
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

  private getToolCallKey(sessionKey: string, runId: RunId, toolCallId: string): string {
    return `${sessionKey}:${runId}:${toolCallId}`
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
      cwd: this.runtimePaths.workspaceDir,
      sessionDir: this.paths.sessionDir,
      sessionFile: this.sessionFilePath(projection.sessionId),
      persist: true,
    })
    this.managers.set(sessionKey, manager)
    return manager
  }

  private getOrCreateSkillSession(sessionId: string): SkillSession {
    const existing = this.skillSessions.get(sessionId)
    if (existing) {
      return existing
    }

    const created = new SkillSession()
    this.skillSessions.set(sessionId, created)
    return created
  }

  private handleSkillModeSwitch(sessionId: string, mode: SessionMode): void {
    const previousMode = this.sessionModes.get(sessionId)
    if (previousMode && previousMode !== mode) {
      this.skillSessions.get(sessionId)?.unload()
    }

    this.sessionModes.set(sessionId, mode)
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
    await this.syncProjectionToPg(nextProjection, manager)

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

  private async syncProjectionToPg(projection: SessionProjection, manager: SessionManager): Promise<void> {
    if (!this.cfg.PG_ENABLED) return
    const eventCount = manager.getEntries().length
    const nextState = {
      eventCount,
      updatedAt: projection.updatedAt,
      title: projection.title ?? null,
      mode: projection.workflow?.mode ?? null,
    }
    const previousState = this.pgSyncState.get(projection.key)

    if (
      previousState
      && previousState.eventCount === nextState.eventCount
      && previousState.updatedAt === nextState.updatedAt
      && previousState.title === nextState.title
      && previousState.mode === nextState.mode
    ) {
      return
    }

    try {
      await syncRuntimeSession(getPool(), projection, manager.getEntries())
      this.pgSyncState.set(projection.key, nextState)
    } catch (error) {
      logger.error('runtime dual-write 失败，已保留文件链路', {
        sessionKey: projection.key,
        sessionId: projection.sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
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
        cwd: this.runtimePaths.workspaceDir,
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

  async historyView(sessionKeyOrSessionId: string): Promise<{ projection: SessionProjection; entries: SessionEventEntry[] }> {
    const projection = this.findProjection(sessionKeyOrSessionId)
    if (!projection) throw new Error(`会话不存在: ${sessionKeyOrSessionId}`)
    const latest = await this.refreshProjection(projection.key)
    const manager = this.getOrCreateManager(latest.key, latest)
    return {
      projection: latest,
      entries: manager.getEntries(),
    }
  }

  async getArtifactDetail(sessionKeyOrSessionId: string, artifactId: string): Promise<ArtifactDetail | null> {
    const resolved = await this.resolveArtifactHandle(sessionKeyOrSessionId, artifactId)
    if (!resolved) return null
    const content = await readFile(resolved.fullPath, 'utf8')
    const stats = await stat(resolved.fullPath)
    return {
      ...resolved.artifact,
      size: stats.size,
      updatedAt: stats.mtimeMs || resolved.artifact.updatedAt,
      content,
    }
  }

  async getArtifactDownload(sessionKeyOrSessionId: string, artifactId: string): Promise<ResolvedArtifactHandle | null> {
    return await this.resolveArtifactHandle(sessionKeyOrSessionId, artifactId)
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
    this.pgSyncState.delete(projection.key)
    this.skillSessions.delete(projection.sessionId)
    this.sessionModes.delete(projection.sessionId)
    await this.persistIndex()

    if (this.cfg.PG_ENABLED) {
      try {
        await deleteRuntimeSession(getPool(), projection.sessionId)
      } catch (error) {
        logger.error('runtime dual-write 删除失败，已保留本地删除结果', {
          sessionKey: projection.key,
          sessionId: projection.sessionId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

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

  private async resolveArtifactHandle(sessionKeyOrSessionId: string, artifactId: string): Promise<ResolvedArtifactHandle | null> {
    const projection = this.findProjection(sessionKeyOrSessionId)
    if (!projection) return null
    const latest = await this.refreshProjection(projection.key)
    const manager = this.getOrCreateManager(latest.key, latest)

    for (const entry of manager.getEntries()) {
      if (entry.type !== 'custom' || entry.customType !== 'generated_files' || !entry.data || typeof entry.data !== 'object') {
        continue
      }
      const generatedArtifacts = 'generatedArtifacts' in entry.data
        ? (entry.data as { generatedArtifacts?: unknown }).generatedArtifacts
        : undefined
      if (!Array.isArray(generatedArtifacts)) continue

      const artifact = generatedArtifacts.find((candidate) =>
        isGeneratedFileArtifact(candidate)
        && candidate.artifactId === artifactId,
      )
      if (!artifact || !isGeneratedFileArtifact(artifact)) continue

      const fullPath = resolveArtifactPath(artifact.filePath, this.runtimePaths)
      if (!existsSync(fullPath)) {
        return null
      }
      return {
        artifact,
        fullPath,
      }
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

  private createUserMessage(input: string, attachments: ChatAttachment[] = []): SessionMessageRecord {
    return {
      role: 'user',
      content: createUserContent(input, attachments),
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
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
      durationMs: step.durationMs,
      title: step.title,
      todoIndex: step.todoIndex,
      summary,
    })
  }

  private async beginStep(bound: BoundSession, runId: RunId, step: StepLifecycle): Promise<StepLifecycle> {
    const entry = bound.manager.appendStepStarted(runId, step.stepId, step.kind, step.title, step.todoIndex)
    const activeStep = {
      ...step,
      startedAt: entry.startedAt,
    }
    await this.refreshProjection(bound.projection.key)
    this.emitStepState(bound.projection.key, runId, activeStep, 'started')
    return activeStep
  }

  private async finishStep(
    bound: BoundSession,
    runId: RunId,
    step: StepLifecycle,
    status: 'completed' | 'failed',
    summary?: string,
  ): Promise<StepLifecycle> {
    const entry = bound.manager.appendStepFinished(
      runId,
      step.stepId,
      step.kind,
      status,
      summary,
      step.todoIndex,
      { startedAt: step.startedAt },
    )
    const finishedStep = {
      ...step,
      startedAt: entry.startedAt ?? step.startedAt,
      finishedAt: entry.finishedAt,
      durationMs: entry.durationMs,
    }
    await this.refreshProjection(bound.projection.key)
    this.emitStepState(bound.projection.key, runId, finishedStep, status, summary)
    return finishedStep
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
    status: 'start' | 'delta' | 'end',
    toolName: string,
    extra: { args?: unknown; summary?: string; detail?: string; isError?: boolean; generatedArtifacts?: GeneratedFileArtifact[]; artifactTraceItems?: ArtifactTraceItem[] } = {},
  ): void {
    this.notify(sessionKey, 'tool_state', {
      sessionKey,
      runId,
      stepId,
      toolName,
      status,
      args: extra.args,
      summary: extra.summary,
      detail: extra.detail,
      isError: extra.isError,
      generatedArtifacts: extra.generatedArtifacts,
      artifactTraceItems: extra.artifactTraceItems,
    })
  }

  private async buildContextMessages(
    bound: BoundSession,
    mode: SessionMode,
    userQuery: string,
  ): Promise<AgentMessage[]> {
    const useLayeredPrompt = process.env.LAYERED_PROMPT === 'true'
    if (useLayeredPrompt) {
      const recallMessages = await buildMemoryRecallMessages({
        pgEnabled: this.cfg.PG_ENABLED,
        sessionId: bound.projection.sessionId,
        sessionKey: bound.projection.key,
        userQuery,
        workspaceDir: this.runtimePaths.workspaceDir,
        mode,
        route: bound.projection.route,
      })
      const augmentedContext = buildAugmentedContext({
        sessionManager: bound.manager,
      }).contextMessages
      return [...recallMessages, ...augmentedContext]
    }

    const memoryRecallBlock = await buildMemoryRecallBlockLegacy({
      pgEnabled: this.cfg.PG_ENABLED,
      sessionId: bound.projection.sessionId,
      sessionKey: bound.projection.key,
      userQuery,
      mode,
      route: bound.projection.route,
    })

    return buildAugmentedContext({
      sessionManager: bound.manager,
      memoryRecallBlock,
    }).contextMessages
  }

  private buildPromptCapability(
    tools: ReadonlyArray<AgentTool<any>>,
    toolsEnabled: boolean,
  ): CapabilityBlock {
    const available = toolsEnabled
      ? tools.map((tool) => tool.name).sort()
      : []

    return {
      executor: toolsEnabled && available.includes('bash')
        ? (process.platform === 'win32' ? 'powershell' : 'shell')
        : 'none',
      available,
      unavailable: ['no_browser', 'no_deploy', 'no_external_api'].sort(),
    }
  }

  private async buildRunSystemPrompt(request: PromptBuildRequest): Promise<string> {
    const useLayeredPrompt = process.env.LAYERED_PROMPT === 'true'
    const legacyOptions = {
      role: request.role,
      mode: request.mode,
      route: request.route,
      modelId: request.modelId,
      thinkingLevel: request.thinkingLevel,
      tools: request.tools,
      toolsEnabled: request.toolsEnabled,
      extraInstructions: request.extraInstructions,
      workspaceDir: this.runtimePaths.workspaceDir,
    } as const

    if (!useLayeredPrompt) {
      return await buildSystemPromptLegacy(legacyOptions)
    }

    const capability = this.buildPromptCapability(request.tools, request.toolsEnabled)
    const { startupSlice, preferenceSlice, managedSystemContent } = await loadStartupSlices({
      workspaceDir: this.runtimePaths.workspaceDir,
      role: request.role,
      capability,
    })

    const layeredOptions: BuildLayeredPromptOptions = {
      role: request.role,
      mode: request.mode,
      workspaceDir: this.runtimePaths.workspaceDir,
      tools: request.tools.map((tool) => ({
        name: tool.name,
        description: tool.description?.trim() || tool.label?.trim() || '可用工具',
      })),
      toolsEnabled: request.toolsEnabled,
      modelId: request.modelId,
      thinkingLevel: request.thinkingLevel,
      channel: request.route?.channel,
      chatType: request.route?.chatType,
      timeZone: request.route?.userTimezone,
      extraInstructions: request.extraInstructions,
      activeSkillName: request.activeSkillName,
      managedSystemContent,
      startupSlice,
      preferenceSlice,
      capability,
      userSlices: {
        profileSlice: '',
        preferenceSlice: '',
        rejected: false,
      },
      soulContent: '',
      identityContent: '',
      memorySummary: '',
    }

    const result = await buildLayeredSystemPrompt(
      layeredOptions,
      this.getOrCreateSkillSession(request.sessionId),
    )
    return result.systemPrompt
  }

  private async executeRun(
    bound: BoundSession,
    runId: RunId,
    mode: SessionMode,
    input: string,
    modelOptions: ClientModelOptions & { systemPrompt?: string; attachments?: ChatAttachment[] },
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

    if (process.env.LAYERED_PROMPT === 'true') {
      this.handleSkillModeSwitch(bound.projection.sessionId, mode)
    }

    manager.appendThinkingLevelChange(thinkingLevel)

    if (bound.projection.model !== model.id) {
      manager.appendModelChange(model.provider, model.id)
    }

    if (resumePause) {
      manager.appendPauseResolved(resumePause.pauseId, runId, input)
    }

    const attachments = modelOptions.attachments ?? []
    const userMessage = this.createUserMessage(input, attachments)
    const contextBeforeInput = await this.buildContextMessages(bound, mode, input)
    manager.appendMessage(userMessage)
    manager.appendRunStarted(runId, mode)

    let latestProjection = await this.refreshProjection(sessionKey)
    this.emitRunState(sessionKey, latestProjection, runId, mode, 'running')

    try {
      if (mode === 'simple') {
        const reply = await this.executeSimple(
          bound,
          runId,
          userMessage,
          contextBeforeInput,
          model,
          apiKey,
          modelOptions,
          abortController.signal,
          thinkingLevel,
          'simple',
        )
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
      logger.error('会话运行失败', { sessionKey, runId, mode, error: message })
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

      if (await applyCompactionIfNeeded(manager)) {
        await this.refreshProjection(sessionKey)
      }

      this.activeRuns.delete(sessionKey)
      clearCurrentToolSessionKey()
      const finalProjection = await this.refreshProjection(sessionKey)
      const memoryCoordinator = getMemoryCoordinator()
      if (memoryCoordinator) {
        await memoryCoordinator.onTurnCompleted(finalProjection, manager)
      }
    }
  }

  private async executeSimple(
    bound: BoundSession,
    runId: RunId,
    _userMessage: SessionMessageRecord,
    contextMessages: AgentMessage[],
    model: Model<'openai-completions'>,
    apiKey: string,
    modelOptions: ClientModelOptions & { systemPrompt?: string; attachments?: ChatAttachment[] },
    signal: AbortSignal,
    thinkingLevel: ReturnType<typeof resolveThinkingLevel>,
    mode: SessionMode = 'simple',
  ): Promise<string> {
    let step: StepLifecycle = {
      stepId: createStepId(),
      kind: 'simple_reply',
      title: '生成回复',
    }

    const sessionKey = bound.projection.key
    const toolsEnabled = modelOptions.enableTools ?? false
    const tools = toolsEnabled ? createSimpleTools() : []
    const systemPrompt = await this.buildRunSystemPrompt({
      sessionId: bound.projection.sessionId,
      role: 'simple',
      mode,
      route: bound.projection.route,
      modelId: model.id,
      thinkingLevel,
      tools,
      toolsEnabled,
      extraInstructions: modelOptions.systemPrompt,
    })

    step = await this.beginStep(bound, runId, step)

    let result: Awaited<ReturnType<typeof runSimpleAgent>>
    try {
      result = await runSimpleAgent({
        messages: [
          createAgentUserMessage(_userMessage as SessionMessageRecord),
        ],
        contextMessages,
        model,
        apiKey,
        systemPromptOverride: systemPrompt,
        thinkingLevel,
        temperature: modelOptions.options?.temperature,
        extraSystemPrompt: modelOptions.systemPrompt,
        signal,
        disableLegacyMemoryFlush: true,
        enableTools: toolsEnabled,
        route: bound.projection.route,
        mode,
        onEvent: (event) => {
          this.handleAgentEvent(bound.manager, sessionKey, runId, step, event)
        },
      })
    } catch (error) {
      if (error instanceof AgentExecutionError) {
        const partialMessages = error.messages.slice(contextMessages.length)
        appendAssistantMessages(bound.manager, partialMessages)
        const partialReply = lastAssistantText(partialMessages).trim()
        await this.finishStep(bound, runId, step, 'failed', partialReply || '回答已中断')
      }
      throw error
    }

    const newMessages = result.messages.slice(contextMessages.length)
    appendAssistantMessages(bound.manager, newMessages)

    const reply = lastAssistantText(newMessages)
    await this.finishStep(bound, runId, step, 'completed', reply)
    return reply
  }

  private async executePlan(
    bound: BoundSession,
    runId: RunId,
    _userMessage: SessionMessageRecord,
    contextMessages: AgentMessage[],
    model: Model<'openai-completions'>,
    apiKey: string,
    modelOptions: ClientModelOptions & { systemPrompt?: string; attachments?: ChatAttachment[] },
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

    const persistTodoState = async (emitEvent = true): Promise<SerializedTodoItem[]> => {
      const items = todoManager.getItems().map((item) => ({ ...item }))
      bound.manager.appendTodoUpdated(runId, items)
      const latestProjection = await this.refreshProjection(sessionKey)
      await syncTodosToForesight({
        pgEnabled: this.cfg.PG_ENABLED,
        projection: latestProjection,
        runId,
        items,
      })

      if (emitEvent) {
        this.notify(sessionKey, 'todo_state', {
          sessionKey,
          runId,
          items,
        })
      }

      return items
    }

    if (!resumePause) {
      let plannerStep: StepLifecycle = {
        stepId: createStepId(),
        kind: 'planner',
        title: '生成计划',
      }
      const managerTools = createManagerTools(todoManager)
      const managerSystemPrompt = await this.buildRunSystemPrompt({
        sessionId: bound.projection.sessionId,
        role: 'manager',
        mode: 'plan',
        route: bound.projection.route,
        modelId: model.id,
        thinkingLevel,
        tools: managerTools,
        toolsEnabled: true,
        extraInstructions: modelOptions.systemPrompt,
      })
      plannerStep = await this.beginStep(bound, runId, plannerStep)

      const managerResult = await runManagerAgent({
        messages: [
          createAgentUserMessage(_userMessage as SessionMessageRecord),
        ],
        contextMessages,
        model,
        apiKey,
        systemPromptOverride: managerSystemPrompt,
        thinkingLevel,
        temperature: modelOptions.options?.temperature,
        extraSystemPrompt: modelOptions.systemPrompt,
        signal,
        todoManager,
        route: bound.projection.route,
        onEvent: (event) => {
          this.handleAgentEvent(bound.manager, sessionKey, runId, plannerStep, event)
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
        await this.finishStep(bound, runId, plannerStep, 'completed', '等待用户补充信息')
        bound.manager.appendPauseRequested(pause)
        bound.manager.appendRunFinished(runId, 'paused')
        await this.refreshProjection(sessionKey)
        this.notify(sessionKey, 'pause_requested', {
          sessionKey,
          runId,
          pause,
        })
        return ''
      }

      const managerMessages = managerResult.messages.slice(contextMessages.length)
      appendAssistantMessages(bound.manager, managerMessages)

      const items = await persistTodoState()

      await this.finishStep(bound, runId, plannerStep, 'completed', `生成 ${items.length} 个任务`)
    }

    let injectedInput = resumePause ? extractSessionText((_userMessage as SessionMessageRecord).content) : undefined
    while (true) {
      const inProgress = todoManager.getInProgress()
      const pending = inProgress ?? todoManager.getPending()
      if (!pending) break

      const [index, item] = pending
      if (item.status !== 'in_progress') {
        todoManager.markInProgress(index)
        await persistTodoState()
      }

      let step: StepLifecycle = {
        stepId: createStepId(),
        kind: 'task',
        title: item.activeForm,
        todoIndex: index,
      }
      step = await this.beginStep(bound, runId, step)

      const prompt = injectedInput
        ? `${item.content}\n\n用户补充信息：\n${injectedInput}`
        : item.content
      injectedInput = undefined

      const workerTools = createWorkerTools()
      const workerSystemPrompt = await this.buildRunSystemPrompt({
        sessionId: bound.projection.sessionId,
        role: 'worker',
        mode: 'plan',
        route: bound.projection.route,
        modelId: model.id,
        thinkingLevel,
        tools: workerTools,
        toolsEnabled: true,
        extraInstructions: modelOptions.systemPrompt,
      })

      const workerResult = await runWorkerAgent({
        todoId: `todo-${index + 1}`,
        todoSnapshot: prompt,
        systemPrompt: workerSystemPrompt,
        model,
        apiKey,
        workspaceDir: this.runtimePaths.workspaceDir,
        signal,
        onEvent: (event) => {
          this.handleAgentEvent(bound.manager, sessionKey, runId, step, event)
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
        await this.finishStep(bound, runId, step, 'completed', '等待用户补充信息')
        bound.manager.appendPauseRequested(pause)
        await persistTodoState(false)
        bound.manager.appendRunFinished(runId, 'paused')
        await this.refreshProjection(sessionKey)
        this.notify(sessionKey, 'pause_requested', {
          sessionKey,
          runId,
          pause,
        })
        return ''
      }

      const workerDecision = handleWorkerReceipt(workerResult.receipt, `todo-${index + 1}`)

      if (workerDecision.action === 'complete') {
        todoManager.markCompleted(index, workerResult.receipt.result)
        bound.manager.appendCustomMessageEntry(
          'task_result',
          [{ type: 'text', text: `任务 ${index + 1} 执行结果：\n${workerResult.receipt.result}` }],
          false,
        )
        await this.finishStep(bound, runId, step, 'completed', workerResult.receipt.result)
        await persistTodoState()
        continue
      }

      const blockedReason = workerDecision.action === 'retry_with_change'
        ? workerDecision.newPrompt
        : workerDecision.action === 'block'
          ? workerDecision.reason
          : workerResult.receipt.validation

      todoManager.markCompleted(index, undefined, blockedReason)
      bound.manager.appendCustomMessageEntry(
        'task_result',
        [{ type: 'text', text: `任务 ${index + 1} 被阻塞：\n${blockedReason}` }],
        false,
      )
      await this.finishStep(bound, runId, step, 'failed', blockedReason)
      await persistTodoState()
    }

    const originalUserQueryForFinalRecall = extractSessionText((_userMessage as SessionMessageRecord).content)
    // Final answer recall intentionally stays anchored to the original user query.
    // The synthetic "please provide the final answer" prompt is structurally stable
    // but semantically generic, so using it would collapse recall into near-identical
    // queries across runs and lose the user's actual retrieval intent.
    const finalContextMessages = await this.buildContextMessages(
      bound,
      'plan',
      originalUserQueryForFinalRecall,
    )
    const finalPrompt: SessionMessageRecord = {
      role: 'user',
      content: '请基于刚刚完成的计划执行结果，直接给用户最终答复。不要再展示 todo、内部步骤或执行日志，只输出面向用户的结论、结果与必要说明。',
      timestamp: Date.now(),
    }

    return await this.executeSimple(
      bound,
      runId,
      finalPrompt,
      finalContextMessages,
      model,
      apiKey,
      {
        ...modelOptions,
        enableTools: false,
        systemPrompt: [
          modelOptions.systemPrompt?.trim(),
          '你正在完成 plan 工作流的最终答复阶段。整合已完成任务的结果，直接回答用户，不再重新规划，也不要暴露内部工作过程。',
        ]
          .filter((part): part is string => Boolean(part && part.length > 0))
          .join('\n\n'),
      },
      signal,
      thinkingLevel,
      'plan',
    )
  }

  private handleAgentEvent(
    manager: SessionManager,
    sessionKey: string,
    runId: RunId,
    step: StepLifecycle,
    event: AgentRuntimeEvent,
  ): void {
    if (event.type === 'preamble') {
      this.emitToolState(sessionKey, runId, step.stepId, 'delta', event.toolName, {
        args: event.args,
        detail: event.description,
      })
      return
    }

    if (event.type === 'confirm_required') {
      this.emitToolState(sessionKey, runId, step.stepId, 'delta', event.toolName, {
        args: event.args,
        summary: 'confirm required',
        detail: event.description,
        isError: true,
      })
      return
    }

    if (event.type === 'message_update') {
      if (event.assistantMessageEvent.type === 'text_delta' && event.assistantMessageEvent.delta) {
        this.emitStepDelta(sessionKey, runId, step, 'text', event.assistantMessageEvent.delta)
        return
      }

      if (event.assistantMessageEvent.type === 'thinking_delta' && event.assistantMessageEvent.delta) {
        this.emitStepDelta(sessionKey, runId, step, 'thinking', event.assistantMessageEvent.delta)
        return
      }

      const partialToolCall = extractPartialToolCall(event)
      if (partialToolCall) {
        this.emitToolState(sessionKey, runId, step.stepId, 'delta', partialToolCall.toolName, {
          args: partialToolCall.args,
        })
      }
      return
    }

    if (event.type === 'tool_execution_start') {
      this.toolArgsByCallId.set(this.getToolCallKey(sessionKey, runId, event.toolCallId), event.args)
      logger.debug('工具开始执行', {
        sessionKey,
        runId,
        stepId: step.stepId,
        stepKind: step.kind,
        toolName: event.toolName,
        args: event.args,
      })
      this.emitToolState(sessionKey, runId, step.stepId, 'start', event.toolName, { args: event.args })
      return
    }

    if (event.type === 'tool_execution_end') {
      const detail = summarizeToolResultDetail(event.result)
      const toolArgs = this.toolArgsByCallId.get(this.getToolCallKey(sessionKey, runId, event.toolCallId))
      this.toolArgsByCallId.delete(this.getToolCallKey(sessionKey, runId, event.toolCallId))
      const generatedArtifacts = event.isError ? [] : extractGeneratedArtifactsFromToolResult(event.result)
      const artifactTraceItems = event.isError ? [] : buildArtifactTraceItems(step.stepId, event.toolName, toolArgs, event.result)
      if (event.isError) {
        logger.warn('工具执行失败', {
          sessionKey,
          runId,
          stepId: step.stepId,
          stepKind: step.kind,
          toolName: event.toolName,
          detail,
        })
      } else {
        logger.debug('工具执行完成', {
          sessionKey,
          runId,
          stepId: step.stepId,
          stepKind: step.kind,
          toolName: event.toolName,
          detail,
        })
      }
      if (artifactTraceItems.length > 0) {
        manager.appendCustomEntry('artifact_trace', {
          stepId: step.stepId,
          toolName: event.toolName,
          artifactTraceItems,
        })
      }
      if (generatedArtifacts.length > 0) {
        manager.appendCustomEntry('generated_files', {
          stepId: step.stepId,
          toolName: event.toolName,
          generatedArtifacts,
        })
      }
      this.emitToolState(sessionKey, runId, step.stepId, 'end', event.toolName, {
        summary: event.isError ? 'tool error' : 'tool completed',
        detail,
        isError: event.isError,
        generatedArtifacts,
        artifactTraceItems,
      })
    }
  }
}

let runtimeService: SessionRuntimeService | null = null

export async function createSessionRuntimeService(config = getConfig()): Promise<SessionRuntimeService> {
  if (runtimeService) return runtimeService
  await migrateLegacyRuntimeStorage(undefined, config.SESSION_STORE_DIR)
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
