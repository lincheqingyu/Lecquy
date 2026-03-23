import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { buildSimpleSystemPrompt, buildWorkerPrompt } from './system-prompts.js'
import { ensurePromptContextFiles, readPromptContextFile, resolvePromptContextPaths } from './context-files.js'
import { ensurePromptModuleTemplates } from './prompt-module-files.js'

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
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'zxhclaw-prompts-'))
  await mkdir(path.join(workspaceDir, 'docs', 'backend'), { recursive: true })
  await writeFile(path.join(workspaceDir, 'docs', 'README.md'), '# Docs\n', 'utf8')
  await mkdir(path.join(workspaceDir, 'backend'), { recursive: true })
  await writeFile(path.join(workspaceDir, 'backend', 'AGENTS.md'), '# Backend AGENTS\n', 'utf8')
  return workspaceDir
}

test('ensurePromptContextFiles migrates legacy MEMORY.md into .ZxhClaw', async () => {
  const workspaceDir = await createWorkspace()
  const legacyDir = path.join(workspaceDir, '.memory')

  try {
    await mkdir(legacyDir, { recursive: true })
    await writeFile(path.join(legacyDir, 'MEMORY.md'), '# Legacy Memory\n\n已迁移内容\n', 'utf8')

    const paths = await ensurePromptContextFiles(workspaceDir)
    const migrated = await readFile(paths.memoryFile, 'utf8')
    const managedAgents = await readPromptContextFile('AGENTS.md', workspaceDir)
    const managedTools = await readPromptContextFile('TOOLS.md', workspaceDir)

    assert.equal(migrated, '# Legacy Memory\n\n已迁移内容\n')
    assert.equal(existsSync(paths.agentsFile), false)
    assert.equal(existsSync(paths.toolsFile), false)
    assert.match(managedAgents.content, /ZxhClaw Runtime AGENTS/)
    assert.match(managedTools.content, /ZxhClaw Runtime TOOLS/)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('buildSimpleSystemPrompt injects full project context, docs, timezone and tooling', async () => {
  const workspaceDir = await createWorkspace()
  const paths = resolvePromptContextPaths(workspaceDir)

  try {
    await ensurePromptContextFiles(workspaceDir)
    await writeFile(paths.soulFile, '你是一个沉稳直接的助手。', 'utf8')
    await writeFile(paths.identityFile, '- 名称：ZxhClaw\n- 气质：理性\n', 'utf8')
    await writeFile(paths.userFile, '- 称呼方式：HQY\n', 'utf8')
    await writeFile(paths.memoryFile, '重要记忆：优先结论先行。', 'utf8')

    const prompt = await buildSimpleSystemPrompt({
      mode: 'simple',
      route: {
        channel: 'webchat',
        chatType: 'dm',
        peerId: 'peer_test',
        userTimezone: 'Asia/Shanghai',
      },
      modelId: 'Qwen3',
      thinkingLevel: 'medium',
      tools: [createMockTool('read_file', '读取文件'), createMockTool('bash', '执行命令')],
      toolsEnabled: true,
      extraInstructions: '始终先给结论。',
      workspaceDir,
    })

    assert.match(prompt, /你是运行在 ZxhClaw 中的个人助手/)
    assert.match(prompt, /## Tooling/)
    assert.match(prompt, /- read_file: 读取文件/)
    assert.match(prompt, /## Documentation/)
    assert.match(prompt, /docs\/README\.md/)
    assert.match(prompt, /## Current Date & Time/)
    assert.match(prompt, /Time zone: Asia\/Shanghai/)
    assert.match(prompt, /## \.ZxhClaw\/SOUL\.md/)
    assert.match(prompt, /## \.ZxhClaw\/IDENTITY\.md/)
    assert.match(prompt, /## \.ZxhClaw\/USER\.md/)
    assert.match(prompt, /## \.ZxhClaw\/MEMORY\.md/)
    assert.match(prompt, /## Runtime/)
    assert.match(prompt, /role=simple \| mode=simple/)
    assert.match(prompt, /## Extra Instructions \(lowest priority\)/)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('buildWorkerPrompt keeps only AGENTS and TOOLS project files', async () => {
  const workspaceDir = await createWorkspace()
  const paths = resolvePromptContextPaths(workspaceDir)

  try {
    await ensurePromptContextFiles(workspaceDir)
    await writeFile(paths.soulFile, '不要给 worker 看到这个人格。', 'utf8')
    await writeFile(paths.identityFile, '- 名称：Hidden\n', 'utf8')
    await writeFile(paths.userFile, '- 称呼方式：不应出现在 worker\n', 'utf8')
    await writeFile(paths.memoryFile, '这条长期记忆不应进入 worker prompt。', 'utf8')

    const prompt = await buildWorkerPrompt({
      mode: 'plan',
      route: {
        channel: 'webchat',
        chatType: 'dm',
        peerId: 'peer_test',
      },
      modelId: 'Qwen3',
      thinkingLevel: 'off',
      tools: [createMockTool('edit_file', '编辑文件')],
      workspaceDir,
    })

    assert.match(prompt, /你是运行在 ZxhClaw 中的任务执行器/)
    assert.match(prompt, /## \.ZxhClaw\/AGENTS\.md/)
    assert.match(prompt, /## \.ZxhClaw\/TOOLS\.md/)
    assert.doesNotMatch(prompt, /\.ZxhClaw\/SOUL\.md/)
    assert.doesNotMatch(prompt, /\.ZxhClaw\/IDENTITY\.md/)
    assert.doesNotMatch(prompt, /\.ZxhClaw\/USER\.md/)
    assert.doesNotMatch(prompt, /\.ZxhClaw\/MEMORY\.md/)
    assert.doesNotMatch(prompt, /## Documentation/)
    assert.doesNotMatch(prompt, /## Current Date & Time/)
    assert.match(prompt, /role=worker \| mode=plan/)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('buildSimpleSystemPrompt reads overridable module templates from .ZxhClaw/system-prompt', async () => {
  const workspaceDir = await createWorkspace()

  try {
    await ensurePromptContextFiles(workspaceDir)
    await ensurePromptModuleTemplates(workspaceDir)
    await writeFile(
      path.join(workspaceDir, '.ZxhClaw', 'system-prompt', 'identity-simple.md'),
      '你是一个部署后可配置的助手模板。\n',
      'utf8',
    )

    const prompt = await buildSimpleSystemPrompt({
      mode: 'simple',
      route: {
        channel: 'webchat',
        chatType: 'dm',
        peerId: 'peer_test',
      },
      modelId: 'Qwen3',
      thinkingLevel: 'off',
      tools: [],
      workspaceDir,
    })

    assert.match(prompt, /你是一个部署后可配置的助手模板/)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
