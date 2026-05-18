// 中文：本文件（sqlite-store.test.ts）位于 backend/src/memory/__tests__/sqlite-store.test.ts，属于backend链路中的测试用例代码，连接上游调用方与下游执行逻辑。
// English: This file (sqlite-store.test.ts) belongs to the backend 测试用例 layer in backend/src/memory/__tests__/sqlite-store.test.ts, wiring upstream callers with downstream runtime logic.

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { deriveProjectId } from '../project-id.js'
import {
  closeDb,
  countMemoryItems,
  getLastExtractedSeq,
  getDb,
  insertItemsAndAdvanceWatermark,
  insertMemoryItems,
  searchForRecall,
  searchMemoryItems,
  setLastExtractedSeq,
  type SQLiteMemoryItemInsert,
} from '../sqlite-store.js'

async function withTempDb(run: (dbPath: string) => Promise<void> | void): Promise<void> {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'lecquy-sqlite-memory-'))
  const dbPath = join(workspaceDir, 'memory-test.db')
  const previousDbPath = process.env.LECQUY_MEMORY_DB_PATH
  process.env.LECQUY_MEMORY_DB_PATH = dbPath
  closeDb()

  try {
    await run(dbPath)
  } finally {
    closeDb()
    if (previousDbPath === undefined) {
      delete process.env.LECQUY_MEMORY_DB_PATH
    } else {
      process.env.LECQUY_MEMORY_DB_PATH = previousDbPath
    }
    await rm(workspaceDir, { recursive: true, force: true })
  }
}

function createMemoryItem(overrides: Partial<SQLiteMemoryItemInsert> = {}): SQLiteMemoryItemInsert {
  const now = '2026-05-08T00:00:00.000Z'
  const baseItem: SQLiteMemoryItemInsert = {
    id: 'mem_test',
    kind: 'event',
    sessionId: 'sess_test',
    sessionKey: 'main',
    summary: '测试记忆',
    content: '这是一条测试记忆',
    payloadJson: {
      event_type: 'observation',
      occurred_at: now,
    },
    tags: ['测试'],
    importance: 5,
    confidence: 0.8,
    status: 'active',
    sourceEventIds: ['evt_test'],
    sourceSessionId: 'sess_test',
    createdAt: now,
    updatedAt: now,
  }

  return {
    ...baseItem,
    ...overrides,
    payloadJson: {
      ...baseItem.payloadJson,
      ...overrides.payloadJson,
    },
  }
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function createRecallItem(
  id: string,
  overrides: Partial<SQLiteMemoryItemInsert> = {},
): SQLiteMemoryItemInsert {
  const occurredAt = getPayloadOccurredAt(overrides) ?? isoDaysAgo(0)

  return createMemoryItem({
    id,
    sessionId: `sess_${id}`,
    summary: `召回测试 ${id}`,
    content: `召回测试内容 ${id}`,
    sourceEventIds: [`evt_${id}`],
    createdAt: occurredAt,
    updatedAt: occurredAt,
    ...overrides,
    payloadJson: {
      event_type: 'decision',
      occurred_at: occurredAt,
      ...overrides.payloadJson,
    },
  })
}

function getPayloadOccurredAt(item: Partial<SQLiteMemoryItemInsert>): string | undefined {
  const value = item.payloadJson?.occurred_at
  return typeof value === 'string' ? value : undefined
}

test('getDb initializes SQLite schema idempotently', async () => {
  await withTempDb(() => {
    const first = getDb()
    const second = getDb()
    assert.equal(first, second)

    const table = first
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'memory_items'")
      .get() as { name: string } | undefined

    assert.equal(table?.name, 'memory_items')
  })
})

test('insertMemoryItems writes rows and countMemoryItems counts them', async () => {
  await withTempDb(() => {
    const items = Array.from({ length: 5 }, (_, index) => createMemoryItem({
      id: `mem_count_${index}`,
      summary: `测试记忆 ${index}`,
      content: `测试内容 ${index}`,
      sourceEventIds: [`evt_count_${index}`],
    }))

    insertMemoryItems(items)

    assert.equal(countMemoryItems(), 5)
  })
})

test('getLastExtractedSeq returns 0 for a session without watermark', async () => {
  await withTempDb(() => {
    assert.equal(getLastExtractedSeq('sess_missing'), 0)
  })
})

test('setLastExtractedSeq upserts the latest seq for a session', async () => {
  await withTempDb(() => {
    setLastExtractedSeq('sess_watermark', 4)
    setLastExtractedSeq('sess_watermark', 12)

    assert.equal(getLastExtractedSeq('sess_watermark'), 12)
  })
})

test('insertItemsAndAdvanceWatermark writes items and watermark atomically', async () => {
  await withTempDb(() => {
    insertItemsAndAdvanceWatermark([
      createMemoryItem({
        id: 'mem_tx',
        sessionId: 'sess_tx',
        summary: '事务写入',
      }),
    ], 'sess_tx', 8)

    assert.equal(countMemoryItems(), 1)
    assert.equal(getLastExtractedSeq('sess_tx'), 8)
  })
})

test('searchMemoryItems uses FTS5 for text search', async () => {
  await withTempDb(() => {
    insertMemoryItems([
      createMemoryItem({
        id: 'mem_ssl_cert',
        summary: '配置 SSL 证书',
        content: '为本地服务配置 SSL 证书。',
      }),
      createMemoryItem({
        id: 'mem_ssl_error',
        summary: '修复 SSL 握手错误',
        content: '排查并修复 SSL 握手错误。',
      }),
      createMemoryItem({
        id: 'mem_theme',
        summary: '用户偏好深色主题',
        content: '用户更偏好深色主题。',
      }),
    ])

    const ids = searchMemoryItems({ query: 'SSL', limit: 10 }).map((item) => item.id)

    assert.deepEqual(new Set(ids), new Set(['mem_ssl_cert', 'mem_ssl_error']))
  })
})

test('searchMemoryItems filters by projectId', async () => {
  await withTempDb(() => {
    insertMemoryItems([
      createMemoryItem({
        id: 'mem_project_a_1',
        projectId: 'A',
        summary: 'A 项目记忆 1',
      }),
      createMemoryItem({
        id: 'mem_project_a_2',
        projectId: 'A',
        summary: 'A 项目记忆 2',
      }),
      createMemoryItem({
        id: 'mem_project_b_1',
        projectId: 'B',
        summary: 'B 项目记忆 1',
      }),
    ])

    const rows = searchMemoryItems({ projectId: 'A', limit: 10 })

    assert.equal(rows.length, 2)
    assert.ok(rows.every((row) => row.projectId === 'A'))
  })
})

test('searchForRecall ranks query matches above metadata-only rows', async () => {
  await withTempDb(() => {
    insertMemoryItems([
      createRecallItem('mem_query_match', {
        projectId: 'github.com/lincheqingyu/Lecquy',
        summary: 'SQLite 召回排序决策',
        content: '当前记忆召回使用 SQLite FTS5 和合成分数。',
        importance: 10,
      }),
      createRecallItem('mem_metadata_only', {
        projectId: 'github.com/lincheqingyu/Lecquy',
        summary: '高重要度但不含关键词',
        content: '这条只靠 importance、recency 和项目加权召回。',
        importance: 10,
      }),
      createRecallItem('mem_other_project', {
        projectId: 'github.com/other/project',
        summary: 'SQLite 旧项目决策',
        content: '另一个项目也提到 SQLite。',
        importance: 8,
      }),
    ])

    const rows = searchForRecall({
      currentProjectId: 'github.com/lincheqingyu/Lecquy',
      userQuery: '为什么选 SQLite',
      limit: 3,
    })

    assert.equal(rows[0]?.id, 'mem_query_match')
    assert.ok((rows[0]?.score ?? 0) > (rows[1]?.score ?? 0))
  })
})

test('searchForRecall uses metadata ordering for cold-start recall', async () => {
  await withTempDb(() => {
    insertMemoryItems([
      createRecallItem('mem_recent_medium', {
        projectId: 'github.com/lincheqingyu/Lecquy',
        summary: '较新的中高重要记忆',
        importance: 7,
        payloadJson: { occurred_at: isoDaysAgo(0) },
      }),
      createRecallItem('mem_old_high', {
        projectId: 'github.com/lincheqingyu/Lecquy',
        summary: '较旧的高重要记忆',
        importance: 10,
        payloadJson: { occurred_at: isoDaysAgo(60) },
      }),
      createRecallItem('mem_old_low', {
        projectId: 'github.com/lincheqingyu/Lecquy',
        summary: '较旧的低重要记忆',
        importance: 3,
        payloadJson: { occurred_at: isoDaysAgo(60) },
      }),
    ])

    const rows = searchForRecall({
      currentProjectId: 'github.com/lincheqingyu/Lecquy',
      userQuery: '？',
      limit: 3,
    })

    assert.equal(rows[0]?.id, 'mem_recent_medium')
    assert.deepEqual(rows.map((row) => row.id), [
      'mem_recent_medium',
      'mem_old_high',
      'mem_old_low',
    ])
  })
})

test('searchForRecall fills remaining slots from global rows after project rows', async () => {
  await withTempDb(() => {
    insertMemoryItems([
      createRecallItem('mem_project_1', {
        projectId: 'github.com/lincheqingyu/Lecquy',
        importance: 7,
      }),
      createRecallItem('mem_project_2', {
        projectId: 'github.com/lincheqingyu/Lecquy',
        importance: 6,
      }),
      createRecallItem('mem_global_1', {
        projectId: 'github.com/other/alpha',
        importance: 10,
      }),
      createRecallItem('mem_global_2', {
        projectId: 'github.com/other/beta',
        importance: 9,
      }),
      createRecallItem('mem_global_3', {
        projectId: 'github.com/other/gamma',
        importance: 8,
      }),
      createRecallItem('mem_global_4', {
        projectId: 'github.com/other/delta',
        importance: 7,
      }),
    ])

    const rows = searchForRecall({
      currentProjectId: 'github.com/lincheqingyu/Lecquy',
      userQuery: '',
      limit: 5,
    })

    assert.equal(rows.length, 5)
    assert.equal(rows.filter((row) => row.projectId === 'github.com/lincheqingyu/Lecquy').length, 2)
    assert.equal(rows.filter((row) => row.projectId !== 'github.com/lincheqingyu/Lecquy').length, 3)
  })
})

test('deriveProjectId returns a stable non-empty id in a real git repo', () => {
  const projectId = deriveProjectId(process.cwd())

  assert.ok(projectId)
  assert.notEqual(projectId, 'unknown')
})
