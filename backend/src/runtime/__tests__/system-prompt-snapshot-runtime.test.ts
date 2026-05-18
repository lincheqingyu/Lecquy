// 中文：本文件（system-prompt-snapshot-runtime.test.ts）验证 SessionRuntimeService 对 FrozenSystemSnapshot 的复用与事件恢复。
// English: This file (system-prompt-snapshot-runtime.test.ts) verifies SessionRuntimeService reuse and event restore for FrozenSystemSnapshot.

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import type { Env } from '../../config/index.js'
import { ensurePromptContextFiles, resolvePromptContextPaths } from '../../core/prompts/context-files.js'
import { SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE } from '../../core/prompts/system-prompt-snapshot.js'
import { SessionManager } from '../pi-session-core/session-manager.js'
import { SessionRuntimeService } from '../session-runtime-service.js'

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

function createTestConfig(sessionStoreDir: string): Env {
  return {
    BACKEND_PORT: 3000,
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    LLM_API_KEY: 'test-key',
    LLM_BASE_URL: 'https://example.com/v1/',
    LLM_MODEL: 'Qwen3',
    LLM_TEMPERATURE: 0.7,
    LLM_MAX_TOKENS: 8192,
    LLM_TIMEOUT: 120000,
    COMPACTION_TIMEOUT_MS: 60000,
    LOG_LEVEL: 'error',
    SESSION_MAIN_KEY: 'main',
    SESSION_RESET_MODE: 'daily',
    SESSION_RESET_AT_HOUR: 4,
    SESSION_IDLE_MINUTES: 120,
    SESSION_STORE_DIR: sessionStoreDir,
    SESSION_PRUNING_MODE: 'off',
    SESSION_PRUNING_TTL: '5m',
    SESSION_PRUNING_KEEP_LAST_ASSISTANTS: 3,
    SESSION_PRUNING_SOFT_RATIO: 0.3,
    SESSION_PRUNING_HARD_RATIO: 0.5,
    SESSION_PRUNING_MIN_TOOL_CHARS: 50000,
    PG_ENABLED: false,
    PG_HOST: 'localhost',
    PG_PORT: 5432,
    PG_DATABASE: 'lecquy',
    PG_USER: 'postgres',
    PG_POOL_MAX: 10,
    PG_SSL: 'false',
  }
}

async function createWorkspace(): Promise<string> {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'lecquy-runtime-snapshot-'))
  await mkdir(path.join(workspaceDir, 'docs', 'backend'), { recursive: true })
  await writeFile(path.join(workspaceDir, 'docs', 'README.md'), '# Docs\n', 'utf8')
  await mkdir(path.join(workspaceDir, 'backend'), { recursive: true })
  await writeFile(path.join(workspaceDir, 'backend', 'AGENTS.md'), '# Backend AGENTS\n', 'utf8')
  await ensurePromptContextFiles(workspaceDir)
  return workspaceDir
}

function getBuildRunSystemPrompt(service: SessionRuntimeService) {
  return (service as unknown as {
    buildRunSystemPrompt(request: {
      sessionId: string
      manager: SessionManager
      role: 'simple' | 'manager' | 'worker'
      mode: 'simple' | 'plan'
      route?: { channel: string; chatType: string; peerId: string; userTimezone?: string }
      modelId: string
      thinkingLevel: 'off' | 'low' | 'medium' | 'high'
      tools: ReadonlyArray<AgentTool<any>>
      toolsEnabled: boolean
      extraInstructions?: string
    }): Promise<string>
  }).buildRunSystemPrompt.bind(service)
}

test('runtime reuses one layered snapshot for repeated calls and restores it from session events', async () => {
  const previousLayeredPrompt = process.env.LAYERED_PROMPT
  const previousWorkspaceRoot = process.env.LECQUY_WORKSPACE_ROOT
  const workspaceDir = await createWorkspace()
  const paths = resolvePromptContextPaths(workspaceDir)
  const manager = new SessionManager({
    cwd: workspaceDir,
    sessionDir: path.join(workspaceDir, '.lecquy', 'sessions-test'),
    persist: false,
  })

  try {
    process.env.LAYERED_PROMPT = 'true'
    process.env.LECQUY_WORKSPACE_ROOT = workspaceDir
    await writeFile(paths.userFile, '初始 USER 内容。', 'utf8')

    const config = createTestConfig('.lecquy/sessions-test')
    const firstService = new SessionRuntimeService(config)
    const buildFirstPrompt = getBuildRunSystemPrompt(firstService)
    const request = {
      sessionId: manager.getSessionId(),
      manager,
      role: 'simple' as const,
      mode: 'simple' as const,
      route: {
        channel: 'webchat',
        chatType: 'dm',
        peerId: 'peer_test',
        userTimezone: 'Asia/Shanghai',
      },
      modelId: 'Qwen3',
      thinkingLevel: 'medium' as const,
      tools: [createMockTool('read_file', '读取文件')],
      toolsEnabled: true,
      extraInstructions: '低优先级附加说明。',
    }

    const firstPrompt = await buildFirstPrompt(request)
    await writeFile(paths.userFile, '修改后的 USER 内容不应影响当前 snapshot。', 'utf8')
    const secondPrompt = await buildFirstPrompt(request)
    const snapshotEntriesAfterSecondCall = manager.getEntries()
      .filter((entry) => entry.type === 'custom' && entry.customType === SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE)

    assert.equal(secondPrompt, firstPrompt)
    assert.equal(snapshotEntriesAfterSecondCall.length, 1)

    const secondService = new SessionRuntimeService(config)
    const restoredPrompt = await getBuildRunSystemPrompt(secondService)(request)
    const snapshotEntriesAfterRestore = manager.getEntries()
      .filter((entry) => entry.type === 'custom' && entry.customType === SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE)

    assert.equal(restoredPrompt, firstPrompt)
    assert.equal(snapshotEntriesAfterRestore.length, 1)
  } finally {
    if (previousLayeredPrompt === undefined) {
      delete process.env.LAYERED_PROMPT
    } else {
      process.env.LAYERED_PROMPT = previousLayeredPrompt
    }
    if (previousWorkspaceRoot === undefined) {
      delete process.env.LECQUY_WORKSPACE_ROOT
    } else {
      process.env.LECQUY_WORKSPACE_ROOT = previousWorkspaceRoot
    }
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('runtime keeps non-layered prompt path on legacy builder without snapshot entry', async () => {
  const previousLayeredPrompt = process.env.LAYERED_PROMPT
  const previousWorkspaceRoot = process.env.LECQUY_WORKSPACE_ROOT
  const workspaceDir = await createWorkspace()
  const manager = new SessionManager({
    cwd: workspaceDir,
    sessionDir: path.join(workspaceDir, '.lecquy', 'sessions-test'),
    persist: false,
  })

  try {
    process.env.LAYERED_PROMPT = 'false'
    process.env.LECQUY_WORKSPACE_ROOT = workspaceDir

    const service = new SessionRuntimeService(createTestConfig('.lecquy/sessions-test'))
    const prompt = await getBuildRunSystemPrompt(service)({
      sessionId: manager.getSessionId(),
      manager,
      role: 'simple',
      mode: 'simple',
      modelId: 'Qwen3',
      thinkingLevel: 'off',
      tools: [createMockTool('read_file', '读取文件')],
      toolsEnabled: true,
    })
    const snapshotEntries = manager.getEntries()
      .filter((entry) => entry.type === 'custom' && entry.customType === SYSTEM_PROMPT_SNAPSHOT_CUSTOM_TYPE)

    assert.match(prompt, /你是运行在 Lecquy 中的个人助手/)
    assert.equal(snapshotEntries.length, 0)
  } finally {
    if (previousLayeredPrompt === undefined) {
      delete process.env.LAYERED_PROMPT
    } else {
      process.env.LAYERED_PROMPT = previousLayeredPrompt
    }
    if (previousWorkspaceRoot === undefined) {
      delete process.env.LECQUY_WORKSPACE_ROOT
    } else {
      process.env.LECQUY_WORKSPACE_ROOT = previousWorkspaceRoot
    }
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
