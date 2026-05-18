// 中文：本文件（system-prompt-snapshot.test.ts）验证 FrozenSystemSnapshot builder 的确定性、source hash 与时间冻结。
// English: This file (system-prompt-snapshot.test.ts) verifies FrozenSystemSnapshot builder determinism, source hashes, and frozen time.

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import {
  buildFrozenSystemSnapshot,
  findLatestFrozenSystemSnapshot,
  isSystemPromptSnapshotEntryData,
  SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE,
  type SystemPromptSnapshotEntryData,
} from '../system-prompt-snapshot.js'
import { ensurePromptContextFiles, resolvePromptContextPaths } from '../context-files.js'
import { PromptLayer } from '../prompt-layer-types.js'
import { createSlice, serializeSystemPrompt } from '../prompt-serializer.js'
import { SessionManager } from '../../../runtime/pi-session-core/session-manager.js'

function createMockTool(name: string, description: string): AgentTool<any> {
  return {
    name,
    label: description,
    description,
    parameters: {} as never,
    execute: async (): Promise<AgentToolResult<Record<string, never>>> => ({
      content: [{ type: 'text', text: 'ok' }],
      details: {},
    }),
  }
}

async function createWorkspace(): Promise<string> {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'lecquy-snapshot-'))
  await mkdir(path.join(workspaceDir, 'docs', 'backend'), { recursive: true })
  await writeFile(path.join(workspaceDir, 'docs', 'README.md'), '# Docs\n', 'utf8')
  await mkdir(path.join(workspaceDir, 'backend'), { recursive: true })
  await writeFile(path.join(workspaceDir, 'backend', 'AGENTS.md'), '# Backend AGENTS\n', 'utf8')
  await ensurePromptContextFiles(workspaceDir)
  return workspaceDir
}

test('buildFrozenSystemSnapshot produces deterministic system text and source hashes for same inputs', async () => {
  const workspaceDir = await createWorkspace()
  const paths = resolvePromptContextPaths(workspaceDir)

  try {
    await writeFile(paths.soulFile, '沉稳、直接、先给结论。', 'utf8')
    await writeFile(paths.identityFile, 'Lecquy 是 kira 的个人助手。', 'utf8')
    await writeFile(paths.userFile, '---\nschema: lecquy.user/v1\n---\n# Profile\n- 称呼：kira\n\n# Preferences\n- 偏好 SQLite。\n', 'utf8')
    await writeFile(paths.memorySummaryFile, '稳定记忆：先实现核心链路。', 'utf8')

    const request = {
      sessionId: 'session_snapshot_test',
      createdReason: 'session_created' as const,
      role: 'simple' as const,
      mode: 'simple' as const,
      workspaceDir,
      route: {
        channel: 'webchat' as const,
        chatType: 'dm' as const,
        peerId: 'peer_test',
        userTimezone: 'Asia/Shanghai',
      },
      modelId: 'Qwen3',
      thinkingLevel: 'medium',
      tools: [createMockTool('bash', '执行命令'), createMockTool('read_file', '读取文件')],
      toolsEnabled: true,
      extraInstructions: '只在不冲突时生效。',
      now: new Date('2026-05-18T01:02:03.000Z'),
    }

    const first = await buildFrozenSystemSnapshot(request)
    const second = await buildFrozenSystemSnapshot(request)

    assert.equal(first.systemText, second.systemText)
    assert.equal(first.contentHash, second.contentHash)
    assert.equal(first.createdAt, '2026-05-18T01:02:03.000Z')
    assert.match(first.systemText, /Current local date:/)
    assert.match(first.systemText, /稳定记忆：先实现核心链路。/)
    assert.equal(first.sourceHashes.promptModules['identity-simple'].length, 64)
    assert.equal(first.sourceHashes.managedAgents.length, 64)
    assert.equal(first.sourceHashes.toolInventory.length, 64)
    assert.equal(first.sliceHashes.system.length, 64)
    assert.equal(first.sliceTokens.system > 0, true)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('buildFrozenSystemSnapshot freezes time at creation input', async () => {
  const workspaceDir = await createWorkspace()

  try {
    const baseRequest = {
      sessionId: 'session_time_test',
      createdReason: 'session_created' as const,
      role: 'simple' as const,
      mode: 'simple' as const,
      workspaceDir,
      route: {
        channel: 'webchat' as const,
        chatType: 'dm' as const,
        peerId: 'peer_test',
        userTimezone: 'UTC',
      },
      modelId: 'Qwen3',
      tools: [createMockTool('read_file', '读取文件')],
      toolsEnabled: true,
    }

    const first = await buildFrozenSystemSnapshot({
      ...baseRequest,
      now: new Date('2026-05-18T01:02:03.000Z'),
    })
    const second = await buildFrozenSystemSnapshot({
      ...baseRequest,
      now: new Date('2026-05-19T01:02:03.000Z'),
    })

    assert.match(first.systemText, /Current local date: 2026-05-18/)
    assert.match(second.systemText, /Current local date: 2026-05-19/)
    assert.notEqual(first.contentHash, second.contentHash)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('snapshot entry helpers store and restore the latest matching role snapshot', async () => {
  const workspaceDir = await createWorkspace()
  const sessionDir = path.join(workspaceDir, '.lecquy', 'sessions-test')
  const manager = new SessionManager({ cwd: workspaceDir, sessionDir, persist: false })

  try {
    const simpleSnapshot = await buildFrozenSystemSnapshot({
      sessionId: manager.getSessionId(),
      createdReason: 'session_created',
      role: 'simple',
      mode: 'simple',
      workspaceDir,
      modelId: 'Qwen3',
      tools: [createMockTool('read_file', '读取文件')],
      toolsEnabled: true,
      now: new Date('2026-05-18T01:02:03.000Z'),
    })
    const workerSnapshot = await buildFrozenSystemSnapshot({
      sessionId: manager.getSessionId(),
      createdReason: 'session_created',
      role: 'worker',
      mode: 'plan',
      workspaceDir,
      modelId: 'Qwen3',
      tools: [createMockTool('edit_file', '编辑文件')],
      toolsEnabled: true,
      now: new Date('2026-05-18T01:02:03.000Z'),
    })
    const data: SystemPromptSnapshotEntryData = {
      kind: SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE,
      snapshot: simpleSnapshot,
    }

    manager.appendCustomEntry(SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE, data)
    manager.appendCustomEntry(SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE, {
      kind: SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE,
      snapshot: workerSnapshot,
    } satisfies SystemPromptSnapshotEntryData)

    assert.equal(isSystemPromptSnapshotEntryData(data), true)
    assert.equal(findLatestFrozenSystemSnapshot(manager.getEntries(), manager.getSessionId(), 'simple')?.snapshotId, simpleSnapshot.snapshotId)
    assert.equal(findLatestFrozenSystemSnapshot(manager.getEntries(), manager.getSessionId(), 'worker')?.snapshotId, workerSnapshot.snapshotId)
    assert.equal(existsSync(sessionDir), false)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('serializeSystemPrompt rejects dynamic layers', () => {
  assert.throws(
    () => serializeSystemPrompt([createSlice(PromptLayer.MemoryRecall, '动态记忆')]),
    /非法层级/,
  )
})
