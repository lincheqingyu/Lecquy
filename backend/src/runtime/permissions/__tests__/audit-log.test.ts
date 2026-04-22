/**
 * 审计日志测试
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  CompositeAuditSink,
  InMemoryAuditSink,
  JsonFileAuditSink,
  NullAuditSink,
} from '../audit-log.js'
import type { PermissionAuditRecord } from '../types.js'

function makeRecord(partial: Partial<PermissionAuditRecord> = {}): PermissionAuditRecord {
  return {
    timestamp: Date.now(),
    toolName: 'bash',
    args: { command: 'ls' },
    decision: { behavior: 'allow', reason: '测试' },
    mode: 'default',
    ...partial,
  }
}

test('InMemoryAuditSink 环形限额', async () => {
  const sink = new InMemoryAuditSink(3)
  for (let i = 0; i < 5; i++) {
    await sink.write(makeRecord({ args: { i } }))
  }
  const recent = await sink.recent(10)
  assert.equal(recent.length, 3)
  assert.equal((recent[0].args as { i: number }).i, 2)
  assert.equal((recent[2].args as { i: number }).i, 4)
})

test('JsonFileAuditSink 追加写入并读取', async () => {
  const ws = await mkdtemp(path.join(os.tmpdir(), 'lecquy-audit-'))
  try {
    const sink = JsonFileAuditSink.forWorkspace(ws)
    await sink.write(makeRecord({ args: { i: 1 } }))
    await sink.write(makeRecord({ args: { i: 2 } }))
    await sink.close()
    const content = await readFile(
      path.join(ws, '.lecquy', 'permissions-audit.jsonl'),
      'utf-8',
    )
    const lines = content.trim().split('\n')
    assert.equal(lines.length, 2)

    const recent = await sink.recent(10)
    assert.equal(recent.length, 2)
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('CompositeAuditSink 多后端同时写入', async () => {
  const a = new InMemoryAuditSink()
  const b = new InMemoryAuditSink()
  const composite = new CompositeAuditSink([a, b])
  await composite.write(makeRecord())
  assert.equal(a.snapshot().length, 1)
  assert.equal(b.snapshot().length, 1)
})

test('NullAuditSink 无副作用', async () => {
  const s = new NullAuditSink()
  await s.write(makeRecord())
  assert.deepEqual(await s.recent(10), [])
})
