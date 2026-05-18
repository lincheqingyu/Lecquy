// 中文：本文件（system-prompt-snapshot.ts）负责生成和识别会话级 FrozenSystemSnapshot，是 layered prompt 到 runtime 复用链路的快照边界。
// English: This file (system-prompt-snapshot.ts) builds and recognizes session-level FrozenSystemSnapshot objects for layered prompt runtime reuse.

import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import type { SessionEventEntry, SessionMode, SessionRouteContext } from '@lecquy/shared'
import {
  buildManagedAgentsContent,
  buildManagedToolsContent,
  loadStartupSlices,
  resolvePromptContextPaths,
} from './context-files.js'
import { PROMPT_TEMPLATE_NAMES, readPromptModuleTemplate } from './prompt-module-files.js'
import { buildLayeredSystemPrompt, hashContent } from './prompt-serializer.js'
import type {
  AgentRole,
  BuildLayeredPromptOptions,
  CapabilityBlock,
} from './prompt-layer-types.js'
import { SKILLS } from '../skills/skill-loader.js'
import type { SkillSession } from '../skills/skill-session.js'

export const SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE = 'system_prompt_snapshot'

export interface FrozenSystemSnapshot {
  readonly sessionId: string
  readonly snapshotId: string
  readonly createdAt: string
  readonly createdReason: 'session_created' | 'resnapshot' | 'compact' | 'manual'
  readonly role: AgentRole
  readonly mode: SessionMode
  readonly timeZone?: string
  readonly modelId?: string
  readonly activeSkillName?: string
  readonly sourceHashes: FrozenSystemSourceHashes
  readonly sliceHashes: Record<string, string>
  readonly sliceTokens: Record<string, number>
  readonly systemText: string
  readonly contentHash: string
}

export interface FrozenSystemSourceHashes {
  readonly promptModules: Record<string, string>
  readonly managedAgents: string
  readonly managedTools: string
  readonly soul: string
  readonly identity: string
  readonly user: string
  readonly memorySummary: string
  readonly toolInventory: string
  readonly skillsIndex: string
  readonly activeSkill?: string
  readonly runtimeInputs: string
}

export interface BuildFrozenSystemSnapshotRequest {
  readonly sessionId: string
  readonly createdReason: FrozenSystemSnapshot['createdReason']
  readonly role: AgentRole
  readonly mode: SessionMode
  readonly workspaceDir: string
  readonly route?: SessionRouteContext
  readonly modelId: string
  readonly thinkingLevel?: string
  readonly tools: ReadonlyArray<AgentTool<any>>
  readonly toolsEnabled: boolean
  readonly extraInstructions?: string
  readonly activeSkillName?: string
  readonly skillSession?: SkillSession
  readonly now?: Date
}

export interface SystemPromptSnapshotEntryData {
  readonly kind: typeof SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE
  readonly snapshot: FrozenSystemSnapshot
}

interface ToolSummary {
  readonly name: string
  readonly description: string
}

export function buildPromptCapabilityFromTools(
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

export async function buildFrozenSystemSnapshot(
  request: BuildFrozenSystemSnapshotRequest,
): Promise<FrozenSystemSnapshot> {
  const workspaceDir = resolvePromptContextPaths(request.workspaceDir).workspaceDir
  const snapshotNow = (request.now ?? new Date()).toISOString()
  const capability = buildPromptCapabilityFromTools(request.tools, request.toolsEnabled)
  const { startupSlice, preferenceSlice, managedSystemContent } = await loadStartupSlices({
    workspaceDir,
    role: request.role,
    capability,
  })

  const toolSummaries = request.tools.map(toToolSummary)
  const activeSkillName = (request.skillSession?.getActiveSkillName() ?? request.activeSkillName?.trim()) || undefined
  const layeredOptions: BuildLayeredPromptOptions = {
    role: request.role,
    mode: request.mode,
    workspaceDir,
    tools: toolSummaries,
    toolsEnabled: request.toolsEnabled,
    modelId: request.modelId,
    thinkingLevel: request.thinkingLevel,
    channel: request.route?.channel,
    chatType: request.route?.chatType,
    timeZone: request.route?.userTimezone,
    snapshotNow,
    extraInstructions: request.extraInstructions,
    activeSkillName,
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

  const [result, sourceHashes] = await Promise.all([
    buildLayeredSystemPrompt(layeredOptions, request.skillSession),
    collectFrozenSystemSourceHashes(request, {
      workspaceDir,
      snapshotNow,
      toolSummaries,
      activeSkillName,
    }),
  ])

  return deepFreezeSnapshot({
    sessionId: request.sessionId,
    snapshotId: randomUUID(),
    createdAt: snapshotNow,
    createdReason: request.createdReason,
    role: request.role,
    mode: request.mode,
    timeZone: request.route?.userTimezone,
    modelId: request.modelId,
    activeSkillName,
    sourceHashes,
    sliceHashes: result.sliceHashes,
    sliceTokens: result.sliceTokens,
    systemText: result.systemPrompt,
    contentHash: hashContent(result.systemPrompt),
  })
}

export function isSystemPromptSnapshotEntryData(input: unknown): input is SystemPromptSnapshotEntryData {
  if (!input || typeof input !== 'object') return false
  const data = input as Partial<SystemPromptSnapshotEntryData>
  const snapshot = data.snapshot as Partial<FrozenSystemSnapshot> | undefined
  return data.kind === SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE
    && Boolean(snapshot)
    && typeof snapshot?.sessionId === 'string'
    && typeof snapshot?.snapshotId === 'string'
    && typeof snapshot?.systemText === 'string'
    && typeof snapshot?.contentHash === 'string'
}

export function findLatestFrozenSystemSnapshot(
  entries: ReadonlyArray<SessionEventEntry>,
  sessionId: string,
  role: AgentRole,
): FrozenSystemSnapshot | null {
  for (const entry of [...entries].reverse()) {
    if (entry.type !== 'custom' || entry.customType !== SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE) {
      continue
    }
    if (!isSystemPromptSnapshotEntryData(entry.data)) {
      continue
    }
    const { snapshot } = entry.data
    if (snapshot.sessionId === sessionId && snapshot.role === role) {
      return snapshot
    }
  }

  return null
}

function toToolSummary(tool: AgentTool<any>): ToolSummary {
  return {
    name: tool.name,
    description: tool.description?.trim() || tool.label?.trim() || '可用工具',
  }
}

async function collectFrozenSystemSourceHashes(
  request: BuildFrozenSystemSnapshotRequest,
  context: {
    readonly workspaceDir: string
    readonly snapshotNow: string
    readonly toolSummaries: ReadonlyArray<ToolSummary>
    readonly activeSkillName?: string
  },
): Promise<FrozenSystemSourceHashes> {
  const [
    promptModules,
    contextSources,
    managedSources,
    skillsIndex,
    activeSkill,
  ] = await Promise.all([
    hashPromptModuleTemplates(context.workspaceDir),
    hashContextSources(context.workspaceDir),
    hashManagedSources(context.workspaceDir),
    hashSkillsIndex(context.workspaceDir),
    hashActiveSkill(context.activeSkillName, context.workspaceDir, request.skillSession),
  ])

  return {
    promptModules,
    managedAgents: managedSources.managedAgents,
    managedTools: managedSources.managedTools,
    soul: contextSources.soul,
    identity: contextSources.identity,
    user: contextSources.user,
    memorySummary: contextSources.memorySummary,
    toolInventory: hashStableValue({
      toolsEnabled: request.toolsEnabled,
      tools: [...context.toolSummaries].sort((left, right) => left.name.localeCompare(right.name)),
    }),
    skillsIndex,
    ...(activeSkill ? { activeSkill } : {}),
    runtimeInputs: hashStableValue({
      role: request.role,
      mode: request.mode,
      channel: request.route?.channel,
      chatType: request.route?.chatType,
      peerId: request.route?.peerId,
      timeZone: request.route?.userTimezone,
      modelId: request.modelId,
      thinkingLevel: request.thinkingLevel,
      toolsEnabled: request.toolsEnabled,
      extraInstructions: request.extraInstructions,
      snapshotNow: context.snapshotNow,
    }),
  }
}

async function hashPromptModuleTemplates(workspaceDir: string): Promise<Record<string, string>> {
  const entries = await Promise.all(
    PROMPT_TEMPLATE_NAMES.map(async (name) => [
      name,
      hashContent(await readPromptModuleTemplate(name, workspaceDir)),
    ] as const),
  )

  return Object.fromEntries(entries)
}

async function hashContextSources(workspaceDir: string): Promise<{
  readonly soul: string
  readonly identity: string
  readonly user: string
  readonly memorySummary: string
}> {
  const paths = resolvePromptContextPaths(workspaceDir)
  const [soul, identity, user, memorySummary] = await Promise.all([
    readTextIfExists(paths.soulFile),
    readTextIfExists(paths.identityFile),
    readTextIfExists(paths.userFile),
    readTextIfExists(paths.memorySummaryFile),
  ])

  return {
    soul: hashContent(soul),
    identity: hashContent(identity),
    user: hashContent(user),
    memorySummary: hashContent(memorySummary),
  }
}

async function hashManagedSources(workspaceDir: string): Promise<{
  readonly managedAgents: string
  readonly managedTools: string
}> {
  const paths = resolvePromptContextPaths(workspaceDir)
  return {
    managedAgents: hashContent(buildManagedAgentsContent()),
    managedTools: hashContent(buildManagedToolsContent(paths)),
  }
}

function hashSkillsIndex(workspaceDir: string): string {
  const skills = SKILLS.listSkillSummaries(workspaceDir)
    .map((skill) => ({
      name: skill.name,
      description: skill.description,
      displayPath: skill.displayPath,
      source: skill.source,
    }))
    .sort((left, right) => left.name.localeCompare(right.name))

  return hashStableValue(skills)
}

function hashActiveSkill(activeSkillName: string | undefined, workspaceDir: string, skillSession?: SkillSession): string | undefined {
  if (skillSession?.hasActiveSkill()) {
    return skillSession.getSlice().contentHash
  }

  if (!activeSkillName) {
    return undefined
  }

  return hashContent(SKILLS.getSkillContent(activeSkillName, workspaceDir) ?? '')
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return ''
  }
}

function hashStableValue(value: unknown): string {
  return hashContent(stableStringify(value))
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  const record = value as Record<string, unknown>
  const entries = Object.keys(record)
    .sort()
    .filter((key) => record[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)

  return `{${entries.join(',')}}`
}

function deepFreezeSnapshot(snapshot: FrozenSystemSnapshot): FrozenSystemSnapshot {
  Object.freeze(snapshot.sourceHashes.promptModules)
  Object.freeze(snapshot.sourceHashes)
  Object.freeze(snapshot.sliceHashes)
  Object.freeze(snapshot.sliceTokens)
  return Object.freeze(snapshot)
}
