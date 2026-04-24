import assert from 'node:assert/strict'
import { readFile, rm, mkdtemp } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import {
  createRunId,
  createStepId,
  type RunId,
  type SessionMode,
} from '@lecquy/shared'

import type { Env } from '../../config/index.js'
import { createPermissionAwareTools } from '../../agent/tool-permission.js'
import type { PermissionManager } from '../permissions/index.js'
import { resolveApprovalAuditPath, type ApprovalAuditEntry } from '../approval-audit.js'
import { ConfirmationBroker, type ConfirmationBrokerCreateInput } from '../confirmation-broker.js'
import { SessionRuntimeService } from '../session-runtime-service.js'

interface RuntimeInternals {
  readonly broker: ConfirmationBroker
  readonly activeRuns: Map<string, {
    readonly runId: RunId
    readonly mode: SessionMode
    readonly abortController: AbortController
  }>
  handleAgentEvent(
    manager: unknown,
    sessionKey: string,
    runId: RunId,
    step: { readonly stepId: ReturnType<typeof createStepId>; readonly kind: 'simple_reply'; readonly title: string },
    event: unknown,
  ): void
}

function createTestConfig(): Env {
  return {
    BACKEND_PORT: 0,
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    LLM_API_KEY: 'test-key',
    LLM_BASE_URL: 'https://example.com/',
    LLM_MODEL: 'test-model',
    LLM_TEMPERATURE: 0,
    LLM_MAX_TOKENS: 1024,
    LLM_TIMEOUT: 1_000,
    LOG_LEVEL: 'error',
    SESSION_MAIN_KEY: 'main',
    SESSION_RESET_MODE: 'idle',
    SESSION_RESET_AT_HOUR: 4,
    SESSION_IDLE_MINUTES: 120,
    SESSION_STORE_DIR: '.lecquy/sessions/v3',
    SESSION_PRUNING_MODE: 'off',
    SESSION_PRUNING_TTL: '5m',
    SESSION_PRUNING_KEEP_LAST_ASSISTANTS: 3,
    SESSION_PRUNING_SOFT_RATIO: 0.3,
    SESSION_PRUNING_HARD_RATIO: 0.5,
    SESSION_PRUNING_MIN_TOOL_CHARS: 50_000,
    PG_ENABLED: false,
    PG_HOST: 'localhost',
    PG_PORT: 5432,
    PG_DATABASE: 'lecquy',
    PG_USER: 'postgres',
    PG_POOL_MAX: 10,
    PG_SSL: 'false',
  }
}

async function createWorkspace(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), 'lecquy-approval-flow-'))
}

async function withWorkspaceRoot<T>(workspaceDir: string, task: () => Promise<T>): Promise<T> {
  const previous = process.env.LECQUY_WORKSPACE_ROOT
  process.env.LECQUY_WORKSPACE_ROOT = workspaceDir
  try {
    return await task()
  } finally {
    if (previous === undefined) {
      delete process.env.LECQUY_WORKSPACE_ROOT
    } else {
      process.env.LECQUY_WORKSPACE_ROOT = previous
    }
  }
}

function createApprovalInput(runId: RunId, overrides: Partial<ConfirmationBrokerCreateInput> = {}): ConfirmationBrokerCreateInput {
  return {
    sessionKey: 'sess_audit',
    sessionId: 'sess_id_audit',
    runId,
    itemId: 'tool_audit',
    title: '需要批准：bash',
    description: '需要用户确认后才能执行 bash({"command":"rm -rf /tmp"})',
    approval: {
      mode: 'default',
      operation: {
        toolName: 'bash',
        args: { command: 'rm -rf /tmp' },
        displayCommand: 'rm -rf /tmp',
      },
      availableDecisions: ['accept', 'decline'],
    },
    ...overrides,
  }
}

async function readAuditEntries(workspaceDir: string): Promise<ApprovalAuditEntry[]> {
  const raw = await readFile(resolveApprovalAuditPath(workspaceDir), 'utf8')
  return raw
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as ApprovalAuditEntry)
}

async function waitForAuditEntries(workspaceDir: string, minimum: number): Promise<ApprovalAuditEntry[]> {
  const deadline = Date.now() + 1_000
  let lastError: unknown
  while (Date.now() < deadline) {
    try {
      const entries = await readAuditEntries(workspaceDir)
      if (entries.length >= minimum) return entries
    } catch (error) {
      lastError = error
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw lastError instanceof Error ? lastError : new Error('等待 audit.jsonl 写入超时')
}

function makeFakeTool(name: string): AgentTool<any> {
  return {
    name,
    label: name,
    description: 'fake',
    parameters: { type: 'object', properties: {} } as any,
    execute: async () => ({ content: 'ok' }) as any,
  }
}

function makeHardDenyManager(): PermissionManager {
  return {
    check: async () => ({
      decision: {
        behavior: 'deny',
        reason: '测试硬拦截',
        source: 'projectSettings',
      },
      matchedRule: {
        source: 'projectSettings',
        behavior: 'deny',
        toolName: 'bash',
        content: 'bash:rm -rf /',
      },
      timestamp: Date.now(),
    }),
  } as unknown as PermissionManager
}

test('approval audit: cancelRun 级联写入 run_cancel 终态', async () => {
  const ws = await createWorkspace()
  try {
    await withWorkspaceRoot(ws, async () => {
      const runtime = new SessionRuntimeService(createTestConfig())
      const internals = runtime as unknown as RuntimeInternals
      const runId = createRunId('run_cancel_audit')
      const outcomePromise = internals.broker.create(createApprovalInput(runId))

      internals.activeRuns.set('sess_audit', {
        runId,
        mode: 'simple',
        abortController: new AbortController(),
      })

      assert.equal(runtime.cancelRun('sess_audit', runId), true)
      const outcome = await outcomePromise
      assert.equal(outcome.status, 'cancelled')

      const entries = await waitForAuditEntries(ws, 1)
      assert.equal(entries.at(-1)?.decision, 'run_cancel')
    })
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('approval audit: hard deny 写入 hard_deny 终态和 ruleContent', async () => {
  const ws = await createWorkspace()
  try {
    await withWorkspaceRoot(ws, async () => {
      const runtime = new SessionRuntimeService(createTestConfig())
      const internals = runtime as unknown as RuntimeInternals
      const runId = createRunId('run_hard_deny_audit')
      const toolCallId = 'call-hard-deny-audit'
      const command = 'rm -rf /'
      const [wrapped] = createPermissionAwareTools([makeFakeTool('bash')], {
        role: 'simple',
        workspaceDir: ws,
        enabled: true,
        manager: makeHardDenyManager(),
      })

      await assert.rejects(
        async () => wrapped.execute(toolCallId, { command }, undefined as any, undefined as any),
        /已被安全策略阻止/,
      )

      const step = {
        stepId: createStepId('step_hard_deny_audit'),
        kind: 'simple_reply' as const,
        title: '生成回复',
      }
      internals.handleAgentEvent({} as never, 'sess_audit', runId, step, {
        type: 'tool_execution_start',
        toolCallId,
        toolName: 'bash',
        args: { command },
      } as never)
      internals.handleAgentEvent({} as never, 'sess_audit', runId, step, {
        type: 'tool_execution_end',
        toolCallId,
        toolName: 'bash',
        result: { content: [{ type: 'text', text: 'blocked' }] },
        isError: true,
      } as never)

      const entries = await waitForAuditEntries(ws, 1)
      const last = entries.at(-1)
      assert.equal(last?.decision, 'hard_deny')
      assert.equal(last?.ruleContent, 'bash:rm -rf /')
    })
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})
