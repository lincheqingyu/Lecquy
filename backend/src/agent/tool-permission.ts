import { existsSync } from 'node:fs'
import path from 'node:path'
import type { AgentEvent, AgentTool } from '@mariozechner/pi-agent-core'
import { PermissionTier, type AgentRole } from '../core/prompts/prompt-layer-types.js'

const AUTO_TOOLS = new Set([
  'read_file',
  'skill',
  'sessions_list',
  'sessions_history',
  'todo_write',
  'request_user_input',
])

const MANAGER_WHITELIST = new Set([
  'read_file',
  'skill',
  'todo_write',
  'request_user_input',
  'sessions_list',
  'sessions_history',
  'sessions_send',
])

const WORKER_BLACKLIST = new Set([
  'todo_write',
  'sessions_spawn',
])

const CONFIRM_PATTERNS = [
  /\brm\s/,
  /\brmdir\b/,
  /\bdel\b/,
  /\bRemove-Item\b/,
  /\binstall\b/,
  /\buninstall\b/,
  /\bdeploy\b/,
  /\bpush\b/,
  /\bchmod\b/,
  /\bchown\b/,
  /\bsystemctl\b/,
  /\bservice\b/,
  /\bkill\b/,
  /\bpkill\b/,
  /\bdrop\s/i,
  /\btruncate\s/i,
  /\bdelete\s+from\b/i,
] as const

const PREAMBLE_PATTERNS = [
  /\bfind\b.*-exec/,
  /\bxargs\b/,
  /\bgrep\b.*-r/,
  /\bsed\b.*-i/,
  /\bwget\b/,
  /\bcurl\b.*-o/,
] as const

export interface PreambleEvent {
  type: 'preamble'
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  description: string
}

export interface ConfirmRequiredEvent {
  type: 'confirm_required'
  toolCallId: string
  toolName: string
  args: Record<string, unknown>
  description: string
}

export type ToolPermissionEvent = PreambleEvent | ConfirmRequiredEvent
export type AgentRuntimeEvent = AgentEvent | ToolPermissionEvent

function resolveTargetPath(filePath: string, workspaceDir: string): string {
  if (path.isAbsolute(filePath)) {
    return path.normalize(filePath)
  }
  return path.resolve(workspaceDir, filePath)
}

function isWithinWorkspace(targetPath: string, workspaceDir: string): boolean {
  const normalizedWorkspace = path.resolve(workspaceDir)
  const normalizedTarget = path.resolve(targetPath)

  return (
    normalizedTarget === normalizedWorkspace
    || normalizedTarget.startsWith(`${normalizedWorkspace}${path.sep}`)
  )
}

function getFilePathArg(args: Record<string, unknown>): string | null {
  if (typeof args.path === 'string' && args.path.trim()) {
    return args.path
  }
  if (typeof args.file_path === 'string' && args.file_path.trim()) {
    return args.file_path
  }
  return null
}

function buildPermissionDescription(toolName: string, args: Record<string, unknown>, tier: PermissionTier): string {
  if (tier === PermissionTier.Preamble) {
    return `正在执行 ${toolName}...`
  }

  const serializedArgs = JSON.stringify(args)
  return `需要用户确认后才能执行 ${toolName}${serializedArgs ? `(${serializedArgs})` : ''}`
}

export function isCoreAgentEvent(event: AgentRuntimeEvent): event is AgentEvent {
  return (
    event.type === 'agent_start'
    || event.type === 'agent_end'
    || event.type === 'turn_start'
    || event.type === 'turn_end'
    || event.type === 'message_start'
    || event.type === 'message_update'
    || event.type === 'message_end'
    || event.type === 'tool_execution_start'
    || event.type === 'tool_execution_update'
    || event.type === 'tool_execution_end'
  )
}

export function classifyToolPermission(
  toolName: string,
  args: Record<string, unknown>,
  role: AgentRole,
  workspaceDir: string,
): PermissionTier {
  void role

  if (AUTO_TOOLS.has(toolName)) {
    return PermissionTier.Auto
  }

  if (toolName === 'write_file' || toolName === 'edit_file') {
    const filePath = getFilePathArg(args)
    if (!filePath) {
      return PermissionTier.Confirm
    }

    const resolvedPath = resolveTargetPath(filePath, workspaceDir)
    if (!isWithinWorkspace(resolvedPath, workspaceDir)) {
      return PermissionTier.Confirm
    }

    return existsSync(resolvedPath)
      ? PermissionTier.Preamble
      : PermissionTier.Auto
  }

  if (toolName === 'bash') {
    const command = typeof args.command === 'string' ? args.command : ''
    if (CONFIRM_PATTERNS.some((pattern) => pattern.test(command))) {
      return PermissionTier.Confirm
    }
    if (PREAMBLE_PATTERNS.some((pattern) => pattern.test(command))) {
      return PermissionTier.Preamble
    }
    return PermissionTier.Auto
  }

  if (toolName === 'sessions_send') {
    return PermissionTier.Preamble
  }

  if (toolName === 'sessions_spawn') {
    return PermissionTier.Confirm
  }

  return PermissionTier.Confirm
}

export function isManagerAllowed(toolName: string): boolean {
  return MANAGER_WHITELIST.has(toolName)
}

export function isWorkerAllowed(toolName: string): boolean {
  return !WORKER_BLACKLIST.has(toolName)
}

export function createPermissionAwareTools(
  tools: readonly AgentTool<any>[],
  options: {
    role: AgentRole
    workspaceDir: string
    enabled: boolean
    onEvent?: (event: ToolPermissionEvent) => void
  },
): AgentTool<any>[] {
  if (!options.enabled) {
    return [...tools]
  }

  return tools.map((tool) => ({
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const args = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>
      const tier = classifyToolPermission(tool.name, args, options.role, options.workspaceDir)

      if (tier === PermissionTier.Preamble) {
        options.onEvent?.({
          type: 'preamble',
          toolCallId,
          toolName: tool.name,
          args,
          description: buildPermissionDescription(tool.name, args, tier),
        })
      }

      if (tier === PermissionTier.Confirm) {
        const description = buildPermissionDescription(tool.name, args, tier)
        options.onEvent?.({
          type: 'confirm_required',
          toolCallId,
          toolName: tool.name,
          args,
          description,
        })
        throw new Error(description)
      }

      return await tool.execute(toolCallId, params, signal, onUpdate)
    },
  }))
}
