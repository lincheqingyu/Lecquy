import test from 'node:test'
import assert from 'node:assert/strict'
import type { RunId, SessionProjection } from '@webclaw/shared'
import { buildForesightMemoryItems } from './foresight-sync.js'

function createProjection(): SessionProjection {
  return {
    key: 'main',
    sessionId: 'sess_test',
    branchId: 'root',
    kind: 'main',
    channel: 'webchat',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    route: {
      channel: 'webchat',
      chatType: 'dm',
    },
    stats: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      contextTokens: 0,
    },
  }
}

test('buildForesightMemoryItems creates deterministic ids and active pending records', () => {
  const items = buildForesightMemoryItems(createProjection(), 'run_test' as RunId, [
    {
      content: '实现 retrieval',
      status: 'pending',
      activeForm: '正在实现 retrieval',
    },
  ])

  assert.equal(items[0]?.id, 'mem_foresight_sess_test_run_test_0')
  assert.equal(items[0]?.kind, 'foresight')
  assert.equal(items[0]?.status, 'active')
  assert.equal(items[0]?.payloadJson.progress, 'pending')
})

test('buildForesightMemoryItems maps completed todo with error to cancelled foresight progress', () => {
  const items = buildForesightMemoryItems(createProjection(), 'run_test' as RunId, [
    {
      content: '执行任务',
      status: 'completed',
      activeForm: '正在执行任务',
      errorMessage: 'tool failed',
    },
  ])

  assert.equal(items[0]?.status, 'superseded')
  assert.equal(items[0]?.payloadJson.progress, 'cancelled')
  assert.equal(items[0]?.payloadJson.error, 'tool failed')
})
