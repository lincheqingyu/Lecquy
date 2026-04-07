import test from 'node:test'
import assert from 'node:assert/strict'
import type { MemoryRecallResult } from './types.js'
import {
  formatMemoryRecallBlock,
  RELEVANT_MEMORY_HEADER,
} from '../runtime/context/templates/memory-recall.template.js'

function createRecallItem(overrides: Partial<MemoryRecallResult> = {}): MemoryRecallResult {
  return {
    id: 'mem_1',
    kind: 'event',
    summary: '后续先做记忆系统',
    content: '用户决定下一阶段优先开发记忆系统，再做 retrieval 和 compact。',
    tags: ['记忆系统', 'retrieval'],
    importance: 8,
    confidence: 0.9,
    occurredAt: '2026-04-06T00:00:00.000Z',
    sourceEventIds: ['evt_1'],
    score: 9.8,
    ...overrides,
  }
}

test('formatMemoryRecallBlock returns empty string when there are no recall items', () => {
  assert.equal(formatMemoryRecallBlock([]), '')
})

test('formatMemoryRecallBlock emits stable template with relevant memory header', () => {
  const block = formatMemoryRecallBlock([createRecallItem()])

  assert.match(block, new RegExp(RELEVANT_MEMORY_HEADER.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  assert.match(block, /summary: 后续先做记忆系统/)
  assert.match(block, /source: session memory/)
})

test('formatMemoryRecallBlock trims low-priority tail when char budget is exceeded', () => {
  const block = formatMemoryRecallBlock([
    createRecallItem({ id: 'mem_1' }),
    createRecallItem({
      id: 'mem_2',
      summary: '这条应该被预算裁掉',
      content: '这是一条很长的测试内容，用来验证在预算超限时后面的条目会被直接丢弃。',
    }),
  ], 220)

  assert.match(block, /summary: 后续先做记忆系统/)
  assert.doesNotMatch(block, /这条应该被预算裁掉/)
})
