// 中文：本文件（coordinator.test.ts）位于 backend/src/memory/coordinator.test.ts，属于backend链路中的测试用例代码，连接上游调用方与下游执行逻辑。
// English: This file (coordinator.test.ts) belongs to the backend 测试用例 layer in backend/src/memory/coordinator.test.ts, wiring upstream callers with downstream runtime logic.

import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { SessionProjection } from '@lecquy/shared'
import { SessionManager } from '../runtime/pi-session-core/session-manager.js'
import {
  buildEventExtractionInput,
  extractAndPersistOnTurnComplete,
} from './coordinator.js'
import {
  closeDb,
  getLastExtractedSeq,
} from './sqlite-store.js'
import type { EventExtractionInput } from './types.js'

async function withTempDb(run: (workspaceDir: string) => Promise<void> | void): Promise<void> {
  const workspaceDir = await mkdtemp(join(tmpdir(), 'lecquy-coordinator-watermark-'))
  const previousDbPath = process.env.LECQUY_MEMORY_DB_PATH
  process.env.LECQUY_MEMORY_DB_PATH = join(workspaceDir, 'memory-test.db')
  closeDb()

  try {
    await run(workspaceDir)
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

function createProjection(sessionId = 'sess_watermark'): SessionProjection {
  return {
    key: 'main',
    sessionId,
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

function createManager(workspaceDir: string): SessionManager {
  return new SessionManager({
    cwd: workspaceDir,
    sessionDir: join(workspaceDir, '.lecquy', 'sessions'),
    persist: false,
  })
}

function appendMessages(manager: SessionManager, count: number): void {
  for (let index = 0; index < count; index += 1) {
    manager.appendMessage({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `可持久化测试消息 ${index + 1}`,
      timestamp: Date.now() + index,
    })
  }
}

test('SQLite extraction watermark prevents already-processed messages from re-entering input', async () => {
  await withTempDb(async (workspaceDir) => {
    const projection = createProjection()
    const manager = createManager(workspaceDir)
    appendMessages(manager, 10)

    const capturedInputs: EventExtractionInput[] = []
    await extractAndPersistOnTurnComplete(projection, manager, workspaceDir, {
      extractItems: async (input) => {
        capturedInputs.push(input)
        return []
      },
    })

    assert.equal(capturedInputs.length, 1)
    assert.equal(getLastExtractedSeq(projection.sessionId), 10)

    appendMessages(manager, 2)
    const nextInput = buildEventExtractionInput(projection, manager, 10)

    assert.equal(nextInput.messages.length, 2)
    assert.deepEqual(nextInput.messages.map((message) => message.seq), [11, 12])
  })
})

test('SQLite extraction does not advance watermark when extraction throws', async () => {
  await withTempDb(async (workspaceDir) => {
    const projection = createProjection('sess_throw')
    const manager = createManager(workspaceDir)
    appendMessages(manager, 4)

    await assert.rejects(
      async () => extractAndPersistOnTurnComplete(projection, manager, workspaceDir, {
        extractItems: async () => {
          throw new Error('mock extraction failure')
        },
      }),
      /mock extraction failure/,
    )

    assert.equal(getLastExtractedSeq(projection.sessionId), 0)
  })
})
