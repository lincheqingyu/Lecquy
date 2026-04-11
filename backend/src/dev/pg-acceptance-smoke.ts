import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import type { Pool } from 'pg'
import {
  createRunId,
  type RunId,
  type SerializedTodoItem,
  type SessionRouteContext,
} from '@lecquy/shared'
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
import { applyCompactionIfNeeded } from '../memory/compact.js'
import { extractEventMemoryItems } from '../memory/extraction-runner.js'
import { syncTodosToForesight } from '../memory/foresight-sync.js'
import { ingestKnowledgeDocument, searchKnowledgeChunks } from '../rag/index.js'
import { SessionManager } from '../runtime/pi-session-core/session-manager.js'
import { createSessionProjectionBase, rebuildSessionProjection } from '../runtime/projections.js'

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
  const currentDir = dirname(fileURLToPath(import.meta.url))
  const workspaceRoot = resolve(currentDir, '../../..')
  dotenv.config({ path: resolve(workspaceRoot, '.env') })

  process.env.PG_ENABLED = 'true'
  process.env.PG_HOST ??= '127.0.0.1'
  process.env.PG_PORT ??= '5432'
  process.env.PG_DATABASE ??= 'lecquy'
  process.env.PG_USER ??= 'postgres'
  process.env.PG_SSL ??= 'false'
  process.env.LLM_API_KEY ??= 'pg-smoke-key'
  process.env.LLM_MODEL ??= 'pg-smoke-model'

  // Smoke 验证只关心 PG 链路，强制走快速失败再回退到 heuristic extraction。
  process.env.LLM_BASE_URL = process.env.PG_SMOKE_LLM_BASE_URL ?? 'http://127.0.0.1:1'
  process.env.LLM_TIMEOUT = process.env.PG_SMOKE_LLM_TIMEOUT ?? '150'
}

function buildRoute(conversationLabel: string): SessionRouteContext {
  return {
    channel: 'internal',
    chatType: 'dm',
    peerId: 'pg-smoke-user',
    accountId: 'pg-smoke-account',
    conversationLabel,
  }
}

function appendMessage(manager: SessionManager, role: 'user' | 'assistant', content: string): void {
  manager.appendMessage({
    role,
    content,
    timestamp: Date.now(),
    provider: role === 'assistant' ? 'pg-smoke' : undefined,
    model: role === 'assistant' ? 'pg-smoke-model' : undefined,
  })
}

function buildProjection(key: string, manager: SessionManager, routeLabel: string) {
  const base = createSessionProjectionBase({
    key,
    sessionId: manager.getSessionId(),
    branchId: manager.getLeafId() ?? manager.getSessionId(),
    kind: 'main',
    channel: 'internal',
    route: buildRoute(routeLabel),
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
  const sessionDir = resolve(workspaceRoot, '.lecquy/sessions/pg-smoke')
  await mkdir(sessionDir, { recursive: true })

  const config = loadConfig()
  assert.equal(config.PG_ENABLED, true)
  const pool = getPool()

  try {
    await runMigrations(pool)

    const smokeId = Date.now()

    const runtimeManager = new SessionManager({
      cwd: workspaceRoot,
      sessionDir,
      persist: false,
    })
    appendMessage(runtimeManager, 'user', '请把 PostgreSQL 集成验收先跑起来。')
    appendMessage(runtimeManager, 'assistant', '我会先验证 runtime dual-write，再验证 memory 和记忆落库。')
    appendMessage(runtimeManager, 'user', '接下来还要验证 foresight、compact 和 RAG。')
    appendMessage(runtimeManager, 'assistant', '收到，我会按顺序验证 event extraction、foresight、compact、RAG。')
    const runtimeProjection = buildProjection(`pg-smoke-runtime-${smokeId}`, runtimeManager, 'PG Smoke Runtime')
    await syncRuntimeSession(pool, runtimeProjection, runtimeManager.getEntries())

    const sessionCount = await countRows(
      pool,
      'SELECT COUNT(*) AS count FROM sessions WHERE id = $1',
      [runtimeProjection.sessionId],
    )
    const sessionEventCount = await countRows(
      pool,
      'SELECT COUNT(*) AS count FROM session_events WHERE session_id = $1',
      [runtimeProjection.sessionId],
    )
    assert.equal(sessionCount, 1)
    assert.equal(sessionEventCount, runtimeManager.getEntries().length)

    const triggerEventSeq = runtimeManager.getEntries().length
    const enqueued = await enqueueEventExtractionJob(pool, {
      sessionId: runtimeProjection.sessionId,
      triggerEventSeq,
      payload: {
        sessionKey: runtimeProjection.key,
        fromEventSeq: 0,
        maxMessages: 8,
      },
    })
    assert.equal(enqueued, true)

    const memoryJob = await loadMemoryJob(pool, runtimeProjection.sessionId, triggerEventSeq)
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
    const eventItems = await extractEventMemoryItems(extractionInput)
    assert.ok(eventItems.length > 0, 'expected extracted event memory items')
    await insertMemoryItems(pool, eventItems)
    await markMemoryJobDone(pool, memoryJob.id)

    const eventMemoryCount = await countRows(
      pool,
      `
        SELECT COUNT(*) AS count
        FROM memory_items
        WHERE session_id = $1
          AND kind = 'event'
      `,
      [runtimeProjection.sessionId],
    )
    assert.ok(eventMemoryCount > 0)

    const planManager = new SessionManager({
      cwd: workspaceRoot,
      sessionDir,
      persist: false,
    })
    const planRunId = createRunId(`run_pg_smoke_plan_${smokeId}`) as RunId
    const planTodos: SerializedTodoItem[] = [
      {
        content: '补充 PostgreSQL 验收文档',
        activeForm: '正在补充 PostgreSQL 验收文档',
        status: 'in_progress',
      },
      {
        content: '整理 RAG 实验结果',
        activeForm: '整理 RAG 实验结果',
        status: 'completed',
        result: 'knowledge search smoke passed',
      },
    ]
    appendMessage(planManager, 'user', '请进入 plan 模式并拆分 PostgreSQL 验收任务。')
    appendMessage(planManager, 'assistant', '我会先准备环境，再整理 memory 与 RAG 的验收结果。')
    planManager.appendRunStarted(planRunId, 'plan')
    planManager.appendTodoUpdated(planRunId, [...planTodos])
    planManager.appendRunFinished(planRunId, 'completed')
    const planProjection = buildProjection(`pg-smoke-plan-${smokeId}`, planManager, 'PG Smoke Plan')
    await syncRuntimeSession(pool, planProjection, planManager.getEntries())
    await syncTodosToForesight({
      pgEnabled: true,
      projection: planProjection,
      runId: planRunId,
      items: planTodos,
    })

    const foresightCount = await countRows(
      pool,
      `
        SELECT COUNT(*) AS count
        FROM memory_items
        WHERE session_id = $1
          AND kind = 'foresight'
      `,
      [planProjection.sessionId],
    )
    assert.equal(foresightCount, planTodos.length)

    const compactManager = new SessionManager({
      cwd: workspaceRoot,
      sessionDir,
      persist: false,
    })
    for (let index = 0; index < 52; index += 1) {
      appendMessage(
        compactManager,
        index % 2 === 0 ? 'user' : 'assistant',
        `compact smoke message ${index + 1}: PostgreSQL acceptance context ${index + 1}`,
      )
    }
    assert.equal(await applyCompactionIfNeeded(compactManager), true)
    const compactProjection = buildProjection(`pg-smoke-compact-${smokeId}`, compactManager, 'PG Smoke Compact')
    await syncRuntimeSession(pool, compactProjection, compactManager.getEntries())

    const compactionCount = await countRows(
      pool,
      `
        SELECT COUNT(*) AS count
        FROM session_events
        WHERE session_id = $1
          AND event_type = 'compaction'
      `,
      [compactProjection.sessionId],
    )
    assert.equal(compactionCount, 1)

    const ingestResult = await ingestKnowledgeDocument({
      sourceType: 'smoke',
      sourceUri: `pg-smoke://${smokeId}`,
      title: `PG Smoke Knowledge ${smokeId}`,
      content: [
        'PostgreSQL 集成验收需要确认 migration、runtime dual-write 与 memory write path 都能真实落库。',
        'RAG 当前只做后端内部实验，不接 runtime、memory recall 或 WebSocket 主链路。',
        'compact 与 foresight 都需要在真实 PostgreSQL 环境下完成最小 smoke 验证。',
      ].join('\n\n'),
      metadata: {
        smoke_id: smokeId,
        source: 'pg_acceptance',
      },
    })

    const knowledgeDocumentCount = await countRows(
      pool,
      'SELECT COUNT(*) AS count FROM knowledge_documents WHERE id = $1',
      [ingestResult.documentId],
    )
    const knowledgeChunkCount = await countRows(
      pool,
      'SELECT COUNT(*) AS count FROM knowledge_chunks WHERE document_id = $1',
      [ingestResult.documentId],
    )
    assert.equal(knowledgeDocumentCount, 1)
    assert.equal(knowledgeChunkCount, ingestResult.chunkCount)

    const knowledgeHits = await searchKnowledgeChunks({
      query: 'PostgreSQL 验收 RAG',
      topK: 3,
      sourceFilter: ['smoke'],
    })
    assert.ok(
      knowledgeHits.some((hit) => hit.documentId === ingestResult.documentId),
      'expected knowledge search hit for smoke document',
    )

    console.log(JSON.stringify({
      migrations: 'ok',
      runtime: {
        sessionId: runtimeProjection.sessionId,
        sessions: sessionCount,
        sessionEvents: sessionEventCount,
      },
      memoryEvent: {
        sessionId: runtimeProjection.sessionId,
        eventItems: eventMemoryCount,
      },
      foresight: {
        sessionId: planProjection.sessionId,
        foresightItems: foresightCount,
      },
      compact: {
        sessionId: compactProjection.sessionId,
        compactionEvents: compactionCount,
      },
      rag: {
        documentId: ingestResult.documentId,
        chunkCount: knowledgeChunkCount,
        hitCount: knowledgeHits.length,
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
