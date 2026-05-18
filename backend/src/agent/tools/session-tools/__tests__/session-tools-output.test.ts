// 中文：本文件（session-tools-output.test.ts）位于 backend/src/agent/tools/session-tools/__tests__/session-tools-output.test.ts，属于backend链路中的测试用例代码，连接上游调用方与下游执行逻辑。
// English: This file (session-tools-output.test.ts) belongs to the backend 测试用例 layer in backend/src/agent/tools/session-tools/__tests__/session-tools-output.test.ts, wiring upstream callers with downstream runtime logic.

import assert from 'node:assert/strict'
import test from 'node:test'

import type { AgentToolResult } from '@mariozechner/pi-agent-core'

import { TOOL_OUTPUT_LIMIT } from '../../../types.js'
import type { SessionRuntimeService } from '../../../../runtime/index.js'
import {
  bindSessionService,
  clearCurrentToolSessionKey,
  setCurrentToolSessionKey,
} from '../runtime.js'
import { createSessionsHistoryTool } from '../sessions-history.js'
import { createSessionsListTool } from '../sessions-list.js'
import { createSessionsSendTool } from '../sessions-send.js'
import { createSessionsSpawnTool } from '../sessions-spawn.js'

function firstText(result: AgentToolResult<Record<string, never>>): string {
  const item = result.content[0]
  assert.equal(item.type, 'text')
  return item.text
}

function bindFakeSessionService(service: Record<string, unknown>): void {
  bindSessionService(service as unknown as SessionRuntimeService)
}

test('sessions_history defaults limit to 20', async () => {
  let receivedLimit: number | undefined
  bindFakeSessionService({
    history: async (_sessionKey: string, limit?: number) => {
      receivedLimit = limit
      return []
    },
  })

  const tool = createSessionsHistoryTool()
  await tool.execute('history-default-limit', { sessionKey: 'session-a' })

  assert.equal(receivedLimit, 20)
})

test('sessions_history truncates oversized output', async () => {
  bindFakeSessionService({
    history: async () => [{ role: 'user', content: 'x'.repeat(TOOL_OUTPUT_LIMIT * 2) }],
  })

  const tool = createSessionsHistoryTool()
  const text = firstText(await tool.execute('history-truncate', { sessionKey: 'session-a', limit: 1 }))

  assert.ok(text.length <= TOOL_OUTPUT_LIMIT)
  assert.match(text, /输出被截断/)
})

test('sessions_history resolves current session key', async () => {
  let receivedSessionKey: string | undefined
  bindFakeSessionService({
    history: async (sessionKey: string) => {
      receivedSessionKey = sessionKey
      return []
    },
  })
  setCurrentToolSessionKey('real-session-key')

  try {
    const tool = createSessionsHistoryTool()
    await tool.execute('history-current', { sessionKey: 'current' })
  } finally {
    clearCurrentToolSessionKey()
  }

  assert.equal(receivedSessionKey, 'real-session-key')
})

test('sessions_history current without runtime session returns error text', async () => {
  let called = false
  bindFakeSessionService({
    history: async () => {
      called = true
      return []
    },
  })
  clearCurrentToolSessionKey()

  const tool = createSessionsHistoryTool()
  const text = firstText(await tool.execute('history-current-missing', { sessionKey: 'current' }))

  assert.equal(called, false)
  assert.match(text, /current.*不可用/)
})

test('sessions_list defaults limit and truncates output', async () => {
  let receivedLimit: number | undefined
  let receivedMessageLimit: number | undefined
  bindFakeSessionService({
    listSessions: async (args: { limit?: number; activeMinutes?: number; messageLimit?: number }) => {
      receivedLimit = args.limit
      receivedMessageLimit = args.messageLimit
      return [{ key: 'session-a', preview: 'x'.repeat(TOOL_OUTPUT_LIMIT * 2) }]
    },
  })

  const tool = createSessionsListTool()
  const text = firstText(await tool.execute('list-default-limit', {}))

  assert.equal(receivedLimit, 20)
  assert.equal(receivedMessageLimit, 0)
  assert.ok(text.length <= TOOL_OUTPUT_LIMIT)
  assert.match(text, /输出被截断/)
})

test('sessions_send truncates oversized reply', async () => {
  bindFakeSessionService({
    runSend: async () => ({
      runId: 'run-a',
      status: 'ok',
      reply: 'x'.repeat(TOOL_OUTPUT_LIMIT * 2),
    }),
  })

  const tool = createSessionsSendTool()
  const text = firstText(await tool.execute('send-truncate', {
    sessionKey: 'session-a',
    message: 'hello',
  }))

  assert.ok(text.length <= TOOL_OUTPUT_LIMIT)
  assert.match(text, /输出被截断/)
})

test('sessions_spawn truncates oversized result', async () => {
  bindFakeSessionService({
    spawnTask: async () => ({
      status: 'accepted',
      runId: 'run-a',
      childSessionKey: `child-${'x'.repeat(TOOL_OUTPUT_LIMIT * 2)}`,
    }),
  })
  setCurrentToolSessionKey('requester-session-key')

  try {
    const tool = createSessionsSpawnTool()
    const text = firstText(await tool.execute('spawn-truncate', { task: 'do work' }))

    assert.ok(text.length <= TOOL_OUTPUT_LIMIT)
    assert.match(text, /输出被截断/)
  } finally {
    clearCurrentToolSessionKey()
  }
})
