// 中文：本文件（store.test.ts）位于 backend/src/memory/__tests__/store.test.ts，属于backend链路中的测试用例代码，连接上游调用方与下游执行逻辑。
// English: This file (store.test.ts) belongs to the backend 测试用例 layer in backend/src/memory/__tests__/store.test.ts, wiring upstream callers with downstream runtime logic.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { loadMemorySummary } from '../store.js'

async function createWorkspace(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), 'lecquy-memory-store-'))
}

test('loadMemorySummary returns MEMORY.summary.md content when it exists', async () => {
  const workspaceDir = await createWorkspace()

  try {
    const runtimeDir = path.join(workspaceDir, '.lecquy')
    await mkdir(runtimeDir, { recursive: true })
    await writeFile(path.join(runtimeDir, 'MEMORY.summary.md'), '这是 summary 内容。', 'utf8')

    const summary = await loadMemorySummary(workspaceDir)

    assert.equal(summary, '这是 summary 内容。')
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('loadMemorySummary returns empty string when MEMORY.summary.md does not exist', async () => {
  const workspaceDir = await createWorkspace()

  try {
    const summary = await loadMemorySummary(workspaceDir)

    assert.equal(summary, '')
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
