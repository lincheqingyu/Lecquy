// 中文：本文件（ws-pg-acceptance.ts）位于 backend/src/dev/ws-pg-acceptance.ts，属于backend链路中的backend 模块实现代码，连接上游调用方与下游执行逻辑。
// English: This file (ws-pg-acceptance.ts) belongs to the backend backend 模块实现 layer in backend/src/dev/ws-pg-acceptance.ts, wiring upstream callers with downstream runtime logic.

import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { WebSocket } from 'ws'
import dotenv from 'dotenv'
import type { Pool } from 'pg'
import type {
  ClientEventPayloadMap,
  ClientModelOptions,
  ServerEventPayloadMap,
  SessionMode,
  SessionRouteContext,
} from '@lecquy/shared'
import { loadConfig } from '../config/index.js'
import { closePool, getPool } from '../db/client.js'

const WORKSPACE_ENV_PATH = fileURLToPath(new URL('../../../.env', import.meta.url))

interface CountRow {
  readonly count: string | number
}

interface HistoryViewPayload {
  readonly success: boolean
  readonly data: {
    readonly sessionKey: string
    readonly projection: { readonly sessionId: string }
    readonly entries: Array<{ readonly type: string }>
  }
}

interface RunAcceptanceResult {
  readonly sessionKey: string
  readonly sessionId: string
  readonly runId: string
  readonly statuses: string[]
  readonly stepStateCount: number
  readonly todoStateCount: number
  readonly paused: boolean
}

function envFlag(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase()
  return value === '1' || value === 'true' || value === 'yes'
}

function loadWorkspaceEnv(): void {
  dotenv.config({ path: WORKSPACE_ENV_PATH })
  process.env.PG_ENABLED = 'true'
  process.env.PG_HOST ??= '127.0.0.1'
  process.env.PG_PORT ??= '5432'
  process.env.PG_DATABASE ??= 'lecquy'
  process.env.PG_USER ??= 'postgres'
  process.env.PG_SSL ??= 'false'
}

function getApiBase(): string {
  const explicit = process.env.BACKEND_ORIGIN?.trim()
  if (explicit) {
    return explicit.replace(/\/+$/, '')
  }

  const port = process.env.BACKEND_PORT?.trim() || '3000'
  return `http://127.0.0.1:${port}`
}

function getWsBase(apiBase: string): string {
  const url = new URL(apiBase)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.toString().replace(/\/+$/, '')
}

function createRoute(peerId: string): SessionRouteContext {
  return {
    channel: 'webchat',
    chatType: 'dm',
    peerId,
    accountId: 'default',
    userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

function buildModelOptions(config: ReturnType<typeof loadConfig>): ClientModelOptions {
  return {
    model: config.LLM_MODEL,
    baseUrl: config.LLM_BASE_URL,
    apiKey: config.LLM_API_KEY,
    enableTools: false,
    thinking: {
      enabled: false,
      level: 'off',
      protocol: 'off',
    },
    options: {
      temperature: 0,
      maxTokens: 64,
    },
  }
}

async function waitForHealth(apiBase: string): Promise<void> {
  const response = await fetch(`${apiBase}/health`)
  assert.equal(response.ok, true, `backend health check failed: ${response.status}`)
  const payload = await response.json() as { status?: string }
  assert.equal(payload.status, 'ok')
}

async function countRows(pool: Pool, sql: string, values: unknown[]): Promise<number> {
  const result = await pool.query<CountRow>(sql, values)
  return Number(result.rows[0]?.count ?? 0)
}

async function fetchHistoryView(apiBase: string, sessionKey: string): Promise<HistoryViewPayload['data']> {
  const encodedKey = encodeURIComponent(sessionKey)
  const response = await fetch(`${apiBase}/api/v1/sessions/${encodedKey}/history-view`)
  assert.equal(response.ok, true, `history-view failed: ${response.status}`)
  const payload = await response.json() as HistoryViewPayload
  assert.equal(payload.success, true)
  return payload.data
}

async function waitForCondition(
  label: string,
  check: () => Promise<boolean>,
  options?: { timeoutMs?: number; intervalMs?: number },
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? 20_000
  const intervalMs = options?.intervalMs ?? 1_000
  const deadline = Date.now() + timeoutMs

  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }

  throw new Error(`timed out waiting for ${label}`)
}

async function runWsConversation(args: {
  wsBase: string
  sessionKey?: string
  mode: SessionMode
  input: string
  route: SessionRouteContext
  modelOptions: ClientModelOptions
  systemPrompt: string
}): Promise<RunAcceptanceResult> {
  const ws = new WebSocket(`${args.wsBase}/api/v1/chat/ws`)

  return await new Promise<RunAcceptanceResult>((resolve, reject) => {
    let settled = false
    let sessionKey = args.sessionKey
    let sessionId = ''
    let runId = ''
    const statuses: string[] = []
    let stepStateCount = 0
    let todoStateCount = 0
    let paused = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      ws.close()
      reject(new Error(`WS run timed out for mode=${args.mode}`))
    }, 90_000)

    const settle = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    ws.on('open', () => {
      const payload: ClientEventPayloadMap['run_start'] = {
        route: args.route,
        mode: args.mode,
        input: args.input,
        sessionKey,
        systemPrompt: args.systemPrompt,
        ...args.modelOptions,
      }
      ws.send(JSON.stringify({ event: 'run_start', payload }))
    })

    ws.on('message', (raw) => {
      const text = typeof raw === 'string' ? raw : raw.toString()
      const parsed = JSON.parse(text) as { event?: keyof ServerEventPayloadMap; payload?: Record<string, unknown> }
      if (!parsed.event) return

      if (parsed.event === 'ping') {
        ws.send(JSON.stringify({ event: 'pong', payload: { timestamp: Date.now() } }))
        return
      }

      if (parsed.event === 'error') {
        settle(() => reject(new Error(String(parsed.payload?.message ?? 'WS error'))))
        return
      }

      if (parsed.event === 'session_bound') {
        const payload = parsed.payload as ServerEventPayloadMap['session_bound']
        sessionKey = payload.sessionKey
        sessionId = payload.sessionId
        return
      }

      if (parsed.event === 'step_state') {
        stepStateCount += 1
        return
      }

      if (parsed.event === 'todo_state') {
        todoStateCount += 1
        return
      }

      if (parsed.event === 'pause_requested') {
        paused = true
        return
      }

      if (parsed.event === 'run_state') {
        const payload = parsed.payload as ServerEventPayloadMap['run_state']
        runId = payload.runId
        statuses.push(payload.status)

        if (payload.status === 'completed') {
          settle(() => {
            ws.close()
            resolve({
              sessionKey: sessionKey ?? '',
              sessionId,
              runId,
              statuses,
              stepStateCount,
              todoStateCount,
              paused,
            })
          })
          return
        }

        if (payload.status === 'failed' || payload.status === 'cancelled') {
          settle(() => {
            ws.close()
            reject(new Error(`run ended with status=${payload.status}: ${payload.error ?? 'unknown error'}`))
          })
        }
      }
    })

    ws.on('error', (error) => {
      settle(() => reject(error))
    })

    ws.on('close', () => {
      if (!settled) {
        settle(() => reject(new Error('WS closed before run completion')))
      }
    })
  })
}

async function main(): Promise<void> {
  loadWorkspaceEnv()
  const config = loadConfig()
  const apiBase = getApiBase()
  const wsBase = getWsBase(apiBase)
  const pool = getPool()
  const skipSimple = envFlag('WS_ACCEPT_SKIP_SIMPLE')
  const skipPlan = envFlag('WS_ACCEPT_SKIP_PLAN')

  try {
    await waitForHealth(apiBase)

    const modelOptions = buildModelOptions(config)
    const simplePeerId = `ws_accept_simple_${Date.now()}`
    const planPeerId = `ws_accept_plan_${Date.now()}`
    const simpleSystemPrompt = '你正在接受真实链路验收。不要使用工具，每次只用一句不超过 12 个字的中文回复。'
    const planSystemPrompt = [
      '你正在接受真实链路验收。',
      '第一步必须调用 todo_write 创建至少 2 个简短 todo。',
      '在第一次 todo_write 之前，禁止输出自然语言。',
      '创建后必须再次调用 todo_write，把全部任务更新为 completed。',
      '如果你跳过 todo_write，这次验收算失败。',
      '不要使用工具，不要追问用户。',
      '最终答复保持简短。',
    ].join('\n')

    const simpleInputs = [
      '请记住：这轮要验证真实 WebSocket 驱动的 PostgreSQL 链路。',
      '再记住：接下来还要确认 event extraction、foresight 和 compact。',
      ...Array.from({ length: 23 }, (_, index) => `验收短回合 ${index + 3}，请简短确认。`),
    ]

    let simpleSessionKey: string | undefined
    let simpleSessionId = ''
    let simpleStepStateCount = 0
    let simpleHistoryEntryCount = 0
    let simpleEventCount = 0
    let simpleMessageCount = 0
    let eventMemoryCount = 0
    let compactionCount = 0

    if (!skipSimple) {
      for (const [index, input] of simpleInputs.entries()) {
        const result = await runWsConversation({
          wsBase,
          sessionKey: simpleSessionKey,
          mode: 'simple',
          input,
          route: createRoute(simplePeerId),
          modelOptions,
          systemPrompt: simpleSystemPrompt,
        })
        simpleSessionKey = result.sessionKey
        simpleSessionId = result.sessionId
        simpleStepStateCount += result.stepStateCount
        assert.equal(result.paused, false, 'simple run should not pause')
        assert.ok(result.statuses.includes('running'))
        assert.equal(result.statuses[result.statuses.length - 1], 'completed')

        if (index === 1) {
          await waitForCondition(
            'event memory items',
            async () => {
              const currentEventMemoryCount = await countRows(
                pool,
                `
                  SELECT COUNT(*) AS count
                  FROM memory_items
                  WHERE session_id = $1
                    AND kind = 'event'
                `,
                [simpleSessionId],
              )
              return currentEventMemoryCount > 0
            },
            {
              // Live extraction can spend tens of seconds retrying the model
              // before it falls back to heuristic insertion.
              timeoutMs: 75_000,
            },
          )
        }
      }

      const simpleHistory = await fetchHistoryView(apiBase, simpleSessionKey ?? '')
      simpleHistoryEntryCount = simpleHistory.entries.length
      simpleEventCount = await countRows(
        pool,
        `
          SELECT COUNT(*) AS count
          FROM session_events
          WHERE session_id = $1
        `,
        [simpleSessionId],
      )
      simpleMessageCount = await countRows(
        pool,
        `
          SELECT COUNT(*) AS count
          FROM session_events
          WHERE session_id = $1
            AND event_type = 'message'
        `,
        [simpleSessionId],
      )
      eventMemoryCount = await countRows(
        pool,
        `
          SELECT COUNT(*) AS count
          FROM memory_items
          WHERE session_id = $1
            AND kind = 'event'
        `,
        [simpleSessionId],
      )
      compactionCount = await countRows(
        pool,
        `
          SELECT COUNT(*) AS count
          FROM session_events
          WHERE session_id = $1
            AND event_type = 'compaction'
        `,
        [simpleSessionId],
      )

      assert.ok(simpleHistory.entries.length > 0)
      assert.ok(simpleStepStateCount > 0)
      assert.ok(simpleEventCount > 0)
      assert.ok(simpleMessageCount >= 50)
      assert.ok(eventMemoryCount > 0)
      assert.ok(compactionCount > 0)
    }

    let planResult: RunAcceptanceResult | null = null
    let planHistoryEntryCount = 0
    let planHistoryHasTodoUpdated = false
    let foresightCount = 0

    if (!skipPlan) {
      planResult = await runWsConversation({
        wsBase,
        mode: 'plan',
        input: '第一步只允许调用 todo_write 创建两个任务：1）整理 PG 链路验收结果；2）写出下一步动作。第二步再次调用 todo_write，把这两个任务都更新为 completed。完成后最后只给我一句简短总结。',
        route: createRoute(planPeerId),
        modelOptions,
        systemPrompt: planSystemPrompt,
      })
      const resolvedPlanResult = planResult

      const planHistory = await fetchHistoryView(apiBase, resolvedPlanResult.sessionKey)
      planHistoryEntryCount = planHistory.entries.length
      planHistoryHasTodoUpdated = planHistory.entries.some((entry) => entry.type === 'todo_updated')
      await waitForCondition(
        'foresight items',
        async () => {
          const currentForesightCount = await countRows(
            pool,
            `
              SELECT COUNT(*) AS count
              FROM memory_items
              WHERE session_id = $1
                AND kind = 'foresight'
            `,
            [resolvedPlanResult.sessionId],
          )
          return currentForesightCount > 0
        },
        {
          timeoutMs: 15_000,
        },
      )
      foresightCount = await countRows(
        pool,
        `
        SELECT COUNT(*) AS count
        FROM memory_items
        WHERE session_id = $1
          AND kind = 'foresight'
      `,
      [resolvedPlanResult.sessionId],
      )

      assert.equal(resolvedPlanResult.paused, false, 'plan run should not pause')
      assert.ok(resolvedPlanResult.statuses.includes('running'))
      assert.equal(resolvedPlanResult.statuses[resolvedPlanResult.statuses.length - 1], 'completed')
      assert.ok(resolvedPlanResult.stepStateCount > 0)
      assert.ok(resolvedPlanResult.todoStateCount > 0)
      assert.ok(planHistoryHasTodoUpdated)
      assert.ok(foresightCount > 0)
    }

    console.log(JSON.stringify({
      validationMode: 'frontend-compatible-ws-client',
      browserUiValidated: false,
      http: {
        apiBase,
        health: 'ok',
      },
      simple: skipSimple ? { skipped: true } : {
        sessionKey: simpleSessionKey,
        sessionId: simpleSessionId,
        turns: simpleInputs.length,
        wsStepStateCount: simpleStepStateCount,
        historyViewEntryCount: simpleHistoryEntryCount,
        pgSessionEvents: simpleEventCount,
        pgMessageEvents: simpleMessageCount,
        pgEventMemoryItems: eventMemoryCount,
        pgCompactionEvents: compactionCount,
      },
      plan: skipPlan || !planResult ? { skipped: true } : {
        sessionKey: planResult.sessionKey,
        sessionId: planResult.sessionId,
        wsStepStateCount: planResult.stepStateCount,
        wsTodoStateCount: planResult.todoStateCount,
        historyViewEntryCount: planHistoryEntryCount,
        historyHasTodoUpdated: planHistoryHasTodoUpdated,
        pgForesightItems: foresightCount,
      },
    }, null, 2))
  } finally {
    await closePool()
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
