import { existsSync } from 'node:fs'
import path from 'node:path'
import type { AgentEvent, AgentTool } from '@mariozechner/pi-agent-core'
import type {
  PermissionMode,
  RunId,
  ToolCallErrorDetailPayload,
  ToolApprovalOperation,
} from '@lecquy/shared'
import { PermissionTier, type AgentRole } from '../core/prompts/prompt-layer-types.js'
import { type ConfirmationBroker } from '../runtime/confirmation-broker.js'
import { bridgeResult, type BridgedTier, type PermissionManager } from '../runtime/permissions/index.js'

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

const M1_AVAILABLE_DECISIONS = ['accept', 'decline'] as const

export const PERMISSION_OBSERVATION_TEMPLATES = {
  decline: '用户拒绝执行该操作：{toolName}。请询问用户下一步。',
  expired: '权限审批超时，未执行 {toolName}。',
  cancelled: '用户已取消本次运行，未执行 {toolName}。',
  hardDeny: '工具 {toolName} 已被安全策略阻止。命中规则：{ruleContent}。请换一种不触发该规则的方案。',
} as const

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

export class PermissionDeclinedError extends Error {
  readonly status: 'declined' | 'expired' | 'cancelled'

  constructor(status: 'declined' | 'expired' | 'cancelled', message: string) {
    super(message)
    this.name = 'PermissionDeclinedError'
    this.status = status
  }
}

export class HardDenyError extends Error {
  readonly detail: ToolCallErrorDetailPayload

  constructor(message: string, detail: ToolCallErrorDetailPayload) {
    super(message)
    this.name = 'HardDenyError'
    this.detail = detail
  }
}

export interface PermissionFailureMetadata {
  readonly kind: 'declined' | 'expired' | 'cancelled' | 'hard_deny'
  readonly message: string
  readonly detail?: ToolCallErrorDetailPayload
}

const permissionFailureByToolCallId = new Map<string, PermissionFailureMetadata>()

function rememberPermissionFailure(toolCallId: string, metadata: PermissionFailureMetadata): void {
  permissionFailureByToolCallId.set(toolCallId, metadata)
}

export function consumePermissionFailureMetadata(toolCallId: string): PermissionFailureMetadata | undefined {
  const metadata = permissionFailureByToolCallId.get(toolCallId)
  if (metadata) {
    permissionFailureByToolCallId.delete(toolCallId)
  }
  return metadata
}

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

function fillTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (text, [key, value]) => text.replaceAll(`{${key}}`, value),
    template,
  )
}

export function buildPermissionObservationMessage(
  kind: 'decline' | 'expired' | 'cancelled' | 'hardDeny',
  toolName: string,
  ruleContent?: string,
): string {
  if (kind === 'hardDeny') {
    return fillTemplate(PERMISSION_OBSERVATION_TEMPLATES.hardDeny, {
      toolName,
      ruleContent: ruleContent ?? '未知规则',
    })
  }

  return fillTemplate(PERMISSION_OBSERVATION_TEMPLATES[kind], { toolName })
}

function summarizeArgs(args: Record<string, unknown>): string {
  try {
    const serializedArgs = JSON.stringify(args)
    return serializedArgs ? `(${serializedArgs})` : ''
  } catch {
    return ''
  }
}

function buildPermissionDescription(toolName: string, args: Record<string, unknown>, tier: PermissionTier): string {
  if (tier === PermissionTier.Preamble) {
    return `正在执行 ${toolName}...`
  }

  return `需要用户确认后才能执行 ${toolName}${summarizeArgs(args)}`
}

function buildToolApprovalOperation(toolName: string, args: Record<string, unknown>): ToolApprovalOperation {
  const filePath = getFilePathArg(args)
  if (toolName === 'bash') {
    return {
      toolName,
      args,
      displayCommand: typeof args.command === 'string' ? args.command : undefined,
    }
  }

  return {
    toolName,
    args,
    filePath: filePath ?? undefined,
    displayCommand: filePath ?? undefined,
  }
}

function resolvePermissionMode(manager?: PermissionManager): PermissionMode {
  const mode = manager?.getMode()
  if (
    mode === 'default'
    || mode === 'dontAsk'
    || mode === 'plan'
    || mode === 'acceptEdits'
    || mode === 'bypassPermissions'
  ) {
    return mode
  }
  return 'default'
}

function buildHardDenyRuleContent(bridged: BridgedTier): string {
  return bridged.matchedRule?.content?.trim() || bridged.reason || bridged.description
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

function mostRestrictiveTier(a: PermissionTier, b: PermissionTier): PermissionTier {
  const rank = (t: PermissionTier): number => {
    switch (t) {
      case PermissionTier.Confirm:
        return 2
      case PermissionTier.Preamble:
        return 1
      case PermissionTier.Auto:
        return 0
      default:
        return 0
    }
  }
  return rank(a) >= rank(b) ? a : b
}

export function createPermissionAwareTools(
  tools: readonly AgentTool<any>[],
  options: {
    role: AgentRole
    workspaceDir: string
    enabled: boolean
    sessionKey?: string
    sessionId?: string
    runId?: RunId
    broker?: ConfirmationBroker
    onEvent?: (event: ToolPermissionEvent) => void
    manager?: PermissionManager
  },
): AgentTool<any>[] {
  if (!options.enabled) {
    return [...tools]
  }

  return tools.map((tool) => ({
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate) => {
      const args = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>

      let bridged: BridgedTier | null = null
      if (options.manager) {
        try {
          const result = await options.manager.check({
            toolName: tool.name,
            args,
            workspaceDir: options.workspaceDir,
            role: options.role,
          })
          bridged = bridgeResult(result)
        } catch {
          bridged = null
        }
      }

      if (bridged?.hardDeny) {
        const ruleContent = buildHardDenyRuleContent(bridged)
        const message = buildPermissionObservationMessage('hardDeny', tool.name, ruleContent)
        rememberPermissionFailure(toolCallId, {
          kind: 'hard_deny',
          message,
          detail: {
            code: 'permission_denied',
            ruleContent,
            message,
          },
        })
        throw new HardDenyError(message, {
          code: 'permission_denied',
          ruleContent,
          message,
        })
      }

      const legacyTier = classifyToolPermission(tool.name, args, options.role, options.workspaceDir)
      const tier = bridged ? mostRestrictiveTier(bridged.tier, legacyTier) : legacyTier

      if (tier === PermissionTier.Preamble) {
        options.onEvent?.({
          type: 'preamble',
          toolCallId,
          toolName: tool.name,
          args,
          description: bridged?.description ?? buildPermissionDescription(tool.name, args, tier),
        })
      }

      if (tier === PermissionTier.Confirm) {
        const description = bridged?.description ?? buildPermissionDescription(tool.name, args, tier)

        if (options.broker && options.sessionKey && options.runId) {
          const outcome = await options.broker.create({
            sessionKey: options.sessionKey,
            sessionId: options.sessionId,
            runId: options.runId,
            itemId: toolCallId,
            title: `需要批准：${tool.name}`,
            description,
            approval: {
              mode: resolvePermissionMode(options.manager),
              operation: buildToolApprovalOperation(tool.name, args),
              availableDecisions: [...M1_AVAILABLE_DECISIONS],
            },
          })

          if (
            outcome.status === 'accepted'
            || outcome.status === 'accepted_for_session'
            || outcome.status === 'accepted_for_project'
          ) {
            return await tool.execute(toolCallId, params, signal, onUpdate)
          }

          const message =
            outcome.status === 'expired'
              ? buildPermissionObservationMessage('expired', tool.name)
              : outcome.status === 'cancelled'
                ? buildPermissionObservationMessage('cancelled', tool.name)
                : buildPermissionObservationMessage('decline', tool.name)

          rememberPermissionFailure(toolCallId, {
            kind:
              outcome.status === 'expired'
                ? 'expired'
                : outcome.status === 'cancelled'
                  ? 'cancelled'
                  : 'declined',
            message,
          })

          throw new PermissionDeclinedError(
            outcome.status === 'expired'
              ? 'expired'
              : outcome.status === 'cancelled'
                ? 'cancelled'
                : 'declined',
            message,
          )
        }

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
