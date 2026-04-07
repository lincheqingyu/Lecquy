import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import type { Pool } from 'pg'
import { loadConfig } from '../config/index.js'
import { closePool, getPool } from '../db/client.js'
import {
  enqueueEventExtractionJob,
  insertMemoryItems,
  loadEventExtractionInput,
  markMemoryJobDone,
} from '../db/memory-repository.js'
import { runMigrations } from '../db/migrate.js'
import { syncRuntimeSession } from '../db/runtime-session-repository.js'
import { extractEventMemoryItemsWithDiagnostics } from '../memory/extraction-runner.js'
import { SessionManager } from '../runtime/pi-session-core/session-manager.js'
import { createSessionProjectionBase, rebuildSessionProjection } from '../runtime/projections.js'
import type { SessionRouteContext } from '@webclaw/shared'

interface CountRow {
  readonly count: string | number
}

interface MemoryJobRow {
  readonly id: string
  readonly job_type: string
  readonly status: string
  readonly session_id: string
  readonly trigger_event_seq: number | null
  readonly payload_json: unknown
  readonly attempt_count: number
  readonly last_error: string | null
  readonly created_at: Date | string
  readonly updated_at: Date | string
}

function loadWorkspaceEnv(): void {
  const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  dotenv.config({ path: resolve(workspaceRoot, '.env') })
  process.env.PG_ENABLED = 'true'
  process.env.PG_HOST ??= '127.0.0.1'
  process.env.PG_PORT ??= '5432'
  process.env.PG_DATABASE ??= 'webclaw'
  process.env.PG_USER ??= 'postgres'
  process.env.PG_SSL ??= 'false'
}

function buildRoute(): SessionRouteContext {
  return {
    channel: 'internal',
    chatType: 'dm',
    peerId: 'live-extraction-smoke',
    accountId: 'default',
    conversationLabel: 'Live Extraction Smoke',
  }
}

function appendMessage(manager: SessionManager, role: 'user' | 'assistant', content: string): void {
  manager.appendMessage({
    role,
    content,
    timestamp: Date.now(),
    provider: role === 'assistant' ? 'live-extraction-smoke' : undefined,
    model: role === 'assistant' ? 'live-extraction-smoke' : undefined,
  })
}

function buildProjection(key: string, manager: SessionManager) {
  const base = createSessionProjectionBase({
    key,
    sessionId: manager.getSessionId(),
    branchId: manager.getLeafId() ?? manager.getSessionId(),
    kind: 'main',
    channel: 'internal',
    route: buildRoute(),
  })

  return rebuildSessionProjection(base, manager).projection
}

async function countRows(pool: Pool, sql: string, values: unknown[]): Promise<number> {
  const result = await pool.query<CountRow>(sql, values)
  return Number(result.rows[0]?.count ?? 0)
}

async function loadMemoryJob(pool: Pool, sessionId: string, triggerEventSeq: number): Promise<MemoryJobRow> {
  const result = await pool.query<MemoryJobRow>(
    `
      SELECT
        id,
        job_type,
        status,
        session_id,
        trigger_event_seq,
        payload_json,
        attempt_count,
        last_error,
        created_at,
        updated_at
      FROM memory_jobs
      WHERE session_id = $1
        AND job_type = 'extract_event'
        AND trigger_event_seq = $2
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [sessionId, triggerEventSeq],
  )

  const row = result.rows[0]
  assert.ok(row, 'expected extract_event memory job')
  return row
}

async function main(): Promise<void> {
  loadWorkspaceEnv()
  const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
  const sessionDir = resolve(workspaceRoot, '.ZxhClaw/sessions/live-extraction-smoke')
  await mkdir(sessionDir, { recursive: true })

  const config = loadConfig()
  const pool = getPool()

  try {
    await runMigrations(pool)

    const smokeId = Date.now()
    const manager = new SessionManager({
      cwd: workspaceRoot,
      sessionDir,
      persist: false,
    })

    appendMessage(manager, 'user', '这轮优先做真实前后端和 WebSocket 驱动的 PostgreSQL 端到端验收。')
    appendMessage(manager, 'assistant', '我会先跑前端同协议 WS 客户端，再记录 PG 真实落库结果。')
    appendMessage(manager, 'user', '然后确认 event extraction 是不是真的走到了可达 LLM，而不是 heuristic fallback。')
    appendMessage(manager, 'assistant', '收到，我会记录模型调用是否成功、耗时以及提取出的 event 数量。')
    appendMessage(manager, 'user', '最后补团队可复用的 PG Compose 草案，但现在不要把 RAG 接进 runtime。')

    const projection = buildProjection(`live-extraction-${smokeId}`, manager)
    await syncRuntimeSession(pool, projection, manager.getEntries())

    const triggerEventSeq = manager.getEntries().length
    const enqueued = await enqueueEventExtractionJob(pool, {
      sessionId: projection.sessionId,
      triggerEventSeq,
      payload: {
        sessionKey: projection.key,
        fromEventSeq: 0,
        maxMessages: 8,
      },
    })
    assert.equal(enqueued, true)

    const memoryJob = await loadMemoryJob(pool, projection.sessionId, triggerEventSeq)
    const extractionInput = await loadEventExtractionInput(pool, {
      id: memoryJob.id,
      jobType: 'extract_event',
      status: 'running',
      sessionId: memoryJob.session_id,
      triggerEventSeq: memoryJob.trigger_event_seq,
      payloadJson: memoryJob.payload_json as Record<string, unknown>,
      attemptCount: memoryJob.attempt_count,
      lastError: memoryJob.last_error,
      createdAt: new Date(memoryJob.created_at).toISOString(),
      updatedAt: new Date(memoryJob.updated_at).toISOString(),
    })

    const heuristicBaseline = await extractEventMemoryItemsWithDiagnostics(extractionInput, {
      disableLlm: true,
    })

    const startedAt = Date.now()
    const liveResult = await extractEventMemoryItemsWithDiagnostics(extractionInput)
    const elapsedMs = Date.now() - startedAt

    if (liveResult.items.length > 0) {
      await insertMemoryItems(pool, liveResult.items)
    }
    await markMemoryJobDone(pool, memoryJob.id)

    const insertedCount = await countRows(
      pool,
      `
        SELECT COUNT(*) AS count
        FROM memory_items
        WHERE session_id = $1
          AND kind = 'event'
      `,
      [projection.sessionId],
    )

    console.log(JSON.stringify({
      sessionId: projection.sessionId,
      model: config.LLM_MODEL,
      baseUrl: config.LLM_BASE_URL,
      source: liveResult.diagnostics.source,
      llmAttemptCount: liveResult.diagnostics.llmAttemptCount,
      fallbackReason: liveResult.diagnostics.fallbackReason,
      elapsedMs,
      itemCount: liveResult.items.length,
      insertedCount,
      liveItems: liveResult.items.map((item) => ({
        summary: item.summary,
        tags: item.tags,
        strategy: item.payloadJson.extraction_strategy,
      })),
      heuristicBaseline: heuristicBaseline.items.map((item) => ({
        summary: item.summary,
        tags: item.tags,
        strategy: item.payloadJson.extraction_strategy,
      })),
    }, null, 2))
  } finally {
    await closePool()
  }
}

void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
