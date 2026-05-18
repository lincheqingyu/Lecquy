// 中文：本文件（prompt-injector.test.ts）位于 backend/src/memory/__tests__/prompt-injector.test.ts，属于backend链路中的测试用例代码，连接上游调用方与下游执行逻辑。
// English: This file (prompt-injector.test.ts) belongs to the backend 测试用例 layer in backend/src/memory/__tests__/prompt-injector.test.ts, wiring upstream callers with downstream runtime logic.

import assert from 'node:assert/strict'
import test from 'node:test'
import type { MemoryItemRow } from '../sqlite-store.js'
import { buildMemoryRecallMessages, promptInjectorDeps } from '../prompt-injector.js'

type PromptInjectorDeps = {
  getPool: typeof promptInjectorDeps.getPool
  searchEventMemories: typeof promptInjectorDeps.searchEventMemories
  searchForRecall: typeof promptInjectorDeps.searchForRecall
  deriveProjectId: typeof promptInjectorDeps.deriveProjectId
  formatMemoryRecallBlock: typeof promptInjectorDeps.formatMemoryRecallBlock
  loadMemoryInjectionText: typeof promptInjectorDeps.loadMemoryInjectionText
  logger: typeof promptInjectorDeps.logger
}

function createMemoryRow(overrides: Partial<MemoryItemRow> = {}): MemoryItemRow {
  return {
    id: 'mem_sqlite_1',
    kind: 'event',
    eventType: 'decision',
    projectId: 'github.com/lincheqingyu/Lecquy',
    sessionId: 'sess_sqlite',
    sessionKey: 'main',
    summary: 'SQLite 记忆召回已接入',
    content: '用户要求优先使用 SQLite 召回，PG 仅保留 legacy fallback。',
    tags: ['memory', 'sqlite'],
    importance: 8,
    confidence: 0.9,
    status: 'active',
    sourceEventIds: ['evt_sqlite_1'],
    sourceSessionId: 'sess_sqlite',
    occurredAt: '2026-05-08T00:00:00.000Z',
    createdAt: '2026-05-08T00:00:00.000Z',
    updatedAt: '2026-05-08T00:00:00.000Z',
    score: 0.92,
    ...overrides,
  }
}

async function withPatchedDeps(
  patch: Partial<PromptInjectorDeps>,
  run: () => Promise<void>,
): Promise<void> {
  const mutableDeps = promptInjectorDeps as PromptInjectorDeps
  const originalDeps: PromptInjectorDeps = {
    getPool: mutableDeps.getPool,
    searchEventMemories: mutableDeps.searchEventMemories,
    searchForRecall: mutableDeps.searchForRecall,
    deriveProjectId: mutableDeps.deriveProjectId,
    formatMemoryRecallBlock: mutableDeps.formatMemoryRecallBlock,
    loadMemoryInjectionText: mutableDeps.loadMemoryInjectionText,
    logger: mutableDeps.logger,
  }
  const previousPgLegacy = process.env.MEMORY_PG_LEGACY
  const previousMemoryDisabled = process.env.LECQUY_MEMORY_DISABLED

  delete process.env.MEMORY_PG_LEGACY
  delete process.env.LECQUY_MEMORY_DISABLED

  Object.assign(mutableDeps, patch)

  try {
    await run()
  } finally {
    Object.assign(mutableDeps, originalDeps)
    if (previousPgLegacy === undefined) {
      delete process.env.MEMORY_PG_LEGACY
    } else {
      process.env.MEMORY_PG_LEGACY = previousPgLegacy
    }
    if (previousMemoryDisabled === undefined) {
      delete process.env.LECQUY_MEMORY_DISABLED
    } else {
      process.env.LECQUY_MEMORY_DISABLED = previousMemoryDisabled
    }
  }
}

test('buildMemoryRecallMessages returns memory_recall layer when SQLite recall hits', async () => {
  await withPatchedDeps({
    getPool: () => ({}) as never,
    searchEventMemories: async () => {
      throw new Error('PG legacy should not be called')
    },
    deriveProjectId: () => 'github.com/lincheqingyu/Lecquy',
    searchForRecall: () => [
      createMemoryRow({ id: 'mem_sqlite_1', summary: 'SQLite 召回 1' }),
      createMemoryRow({ id: 'mem_sqlite_2', summary: 'SQLite 召回 2' }),
      createMemoryRow({ id: 'mem_sqlite_3', summary: 'SQLite 召回 3' }),
    ],
    formatMemoryRecallBlock: (items) => `命中 ${items.length} 条 SQLite 记忆：${items.map((item) => item.summary).join(' / ')}`,
    loadMemoryInjectionText: async () => '',
  }, async () => {
    const messages = await buildMemoryRecallMessages({
      pgEnabled: true,
      sessionId: 'session_test',
      sessionKey: 'session_test',
      userQuery: '最近关于 memory recall 的决定是什么？',
      workspaceDir: '/tmp/lecquy-memory-test',
      mode: 'simple',
    })

    assert.equal(messages.length, 1)
    assert.equal(messages[0]?.role, 'user')
    assert.equal(typeof messages[0]?.content, 'string')
    assert.equal(
      messages[0]?.content,
      '<LAYER:memory_recall>\n命中 3 条 SQLite 记忆：SQLite 召回 1 / SQLite 召回 2 / SQLite 召回 3\n</LAYER>',
    )
  })
})

test('buildMemoryRecallMessages falls back to file system when SQLite recall misses', async () => {
  await withPatchedDeps({
    deriveProjectId: () => 'github.com/lincheqingyu/Lecquy',
    searchForRecall: () => [],
    formatMemoryRecallBlock: () => '',
    loadMemoryInjectionText: async () => '来自文件系统的 recall',
  }, async () => {
    const messages = await buildMemoryRecallMessages({
      pgEnabled: false,
      sessionId: 'session_test',
      userQuery: '回忆一下',
      workspaceDir: '/tmp/lecquy-memory-test',
    })

    assert.equal(messages.length, 1)
    assert.equal(messages[0]?.content, '<LAYER:memory_recall>\n来自文件系统的 recall\n</LAYER>')
  })
})

test('buildMemoryRecallMessages returns empty array when no recall content exists', async () => {
  await withPatchedDeps({
    getPool: () => ({}) as never,
    searchEventMemories: async () => [],
    deriveProjectId: () => 'github.com/lincheqingyu/Lecquy',
    searchForRecall: () => [],
    formatMemoryRecallBlock: () => '',
    loadMemoryInjectionText: async () => '',
  }, async () => {
    const messages = await buildMemoryRecallMessages({
      pgEnabled: true,
      sessionId: 'session_test',
      sessionKey: 'session_test',
      userQuery: '没有任何 recall 吗',
      workspaceDir: '/tmp/lecquy-memory-test',
      mode: 'simple',
    })

    assert.deepEqual(messages, [])
  })
})

test('buildMemoryRecallMessages always returns user-role messages', async () => {
  await withPatchedDeps({
    deriveProjectId: () => 'github.com/lincheqingyu/Lecquy',
    searchForRecall: () => [],
    formatMemoryRecallBlock: () => '',
    loadMemoryInjectionText: async () => '只要有 recall 就应该是 user role',
  }, async () => {
    const messages = await buildMemoryRecallMessages({
      pgEnabled: false,
      sessionId: 'session_test',
      userQuery: '检查 role',
      workspaceDir: '/tmp/lecquy-memory-test',
    })

    assert.equal(messages.length, 1)
    assert.equal(messages[0]?.role, 'user')
  })
})
