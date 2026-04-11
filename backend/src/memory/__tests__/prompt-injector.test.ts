import assert from 'node:assert/strict'
import test from 'node:test'
import type { MemoryRecallResult } from '../types.js'
import { buildMemoryRecallMessages, promptInjectorDeps } from '../prompt-injector.js'

type PromptInjectorDeps = {
  getPool: typeof promptInjectorDeps.getPool
  searchEventMemories: typeof promptInjectorDeps.searchEventMemories
  formatMemoryRecallBlock: typeof promptInjectorDeps.formatMemoryRecallBlock
  loadMemoryInjectionText: typeof promptInjectorDeps.loadMemoryInjectionText
  logger: typeof promptInjectorDeps.logger
}

function createRecallItem(overrides: Partial<MemoryRecallResult> = {}): MemoryRecallResult {
  return {
    id: 'mem_1',
    kind: 'event',
    summary: '记住用户当前在做 Memory 路径收敛',
    content: '用户要求把 startup summary 和 recall 路径拆开，避免重复注入。',
    tags: ['memory', 'prompt'],
    importance: 8,
    confidence: 0.9,
    occurredAt: '2026-04-10T00:00:00.000Z',
    sourceEventIds: ['evt_1'],
    score: 9.8,
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
    formatMemoryRecallBlock: mutableDeps.formatMemoryRecallBlock,
    loadMemoryInjectionText: mutableDeps.loadMemoryInjectionText,
    logger: mutableDeps.logger,
  }

  Object.assign(mutableDeps, patch)

  try {
    await run()
  } finally {
    Object.assign(mutableDeps, originalDeps)
  }
}

test('buildMemoryRecallMessages returns memory_recall layer when pg recall hits', async () => {
  await withPatchedDeps({
    getPool: () => ({}) as never,
    searchEventMemories: async () => [createRecallItem()],
    formatMemoryRecallBlock: () => '命中 PostgreSQL 记忆',
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
    assert.equal(messages[0]?.content, '<LAYER:memory_recall>\n命中 PostgreSQL 记忆\n</LAYER>')
  })
})

test('buildMemoryRecallMessages falls back to file system when pg is disabled', async () => {
  await withPatchedDeps({
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
