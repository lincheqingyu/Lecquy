/**
 * 双引擎集成测试：`createPermissionAwareTools` + `PermissionManager`
 *
 * 覆盖策略 B 的关键路径：
 *   1. 未注入 manager 时保持旧行为（legacy 通路）
 *   2. 新引擎 deny 时短路抛 hard deny，不执行
 *   3. 新引擎 allow + 旧引擎 Confirm 时取更严格（Confirm）
 *   4. 新引擎 ask 翻译为 Confirm，描述来自新引擎
 *   5. 新引擎抛错时优雅降级到旧引擎
 *   6. 路径遍历被 file-operations 前置拦截（hardDeny）
 */

import assert from 'node:assert/strict'
import type { AgentTool } from '@mariozechner/pi-agent-core'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { PermissionTier } from '../../core/prompts/prompt-layer-types.js'
import {
  PermissionManager,
  NullAuditSink,
  type CommandClassifier,
  type ClassifierResult,
} from '../../runtime/permissions/index.js'
import {
  createPermissionAwareTools,
  type ToolPermissionEvent,
} from '../tool-permission.js'

async function mkWorkspace(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), 'lecquy-tp-integ-'))
}

/**
 * 构造一个最小的 AgentTool：记录是否被执行。
 */
function makeFakeTool(name: string): {
  tool: AgentTool<any>
  wasExecuted: () => boolean
} {
  let executed = false
  const tool: AgentTool<any> = {
    name,
    label: name,
    description: 'fake',
    parameters: { type: 'object', properties: {} } as any,
    execute: async () => {
      executed = true
      return { content: 'ok' } as any
    },
  }
  return { tool, wasExecuted: () => executed }
}

/**
 * 一个可配置的假分类器：每次返回给定的 ClassifierResult。
 */
function makeFakeClassifier(result: ClassifierResult): CommandClassifier {
  return {
    name: 'fake-classifier',
    async classify() {
      return result
    },
  }
}

test('未注入 manager：保持旧引擎行为（ls -la → Auto 执行）', async () => {
  const ws = await mkWorkspace()
  try {
    const { tool, wasExecuted } = makeFakeTool('bash')
    const events: ToolPermissionEvent[] = []
    const [wrapped] = createPermissionAwareTools([tool], {
      role: 'simple',
      workspaceDir: ws,
      enabled: true,
      onEvent: (e) => events.push(e),
    })
    await wrapped.execute('call-1', { command: 'ls -la' }, undefined as any, undefined as any)
    assert.equal(wasExecuted(), true)
    assert.equal(events.length, 0)
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('新引擎 deny：短路抛 hard deny，不执行', async () => {
  const ws = await mkWorkspace()
  try {
    const manager = await PermissionManager.create({
      workspaceDir: ws,
      auditSink: new NullAuditSink(),
      bashClassifier: makeFakeClassifier({
        level: 'deny',
        confidence: 'high',
        reason: '测试 deny',
      }),
    })
    const { tool, wasExecuted } = makeFakeTool('bash')
    const events: ToolPermissionEvent[] = []
    const [wrapped] = createPermissionAwareTools([tool], {
      role: 'simple',
      workspaceDir: ws,
      enabled: true,
      manager,
      onEvent: (e) => events.push(e),
    })

    await assert.rejects(
      async () => wrapped.execute('call-2', { command: 'anything' }, undefined as any, undefined as any),
      /已被安全策略阻止/,
    )
    assert.equal(wasExecuted(), false)
    assert.equal(events.length, 0)
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('新引擎 ask → 旧引擎 Auto：取更严格 Confirm', async () => {
  const ws = await mkWorkspace()
  try {
    const manager = await PermissionManager.create({
      workspaceDir: ws,
      auditSink: new NullAuditSink(),
      bashClassifier: makeFakeClassifier({
        level: 'ask',
        confidence: 'high',
        reason: '测试 ask',
      }),
    })
    const { tool, wasExecuted } = makeFakeTool('bash')
    const events: ToolPermissionEvent[] = []
    const [wrapped] = createPermissionAwareTools([tool], {
      role: 'simple',
      workspaceDir: ws,
      enabled: true,
      manager,
      onEvent: (e) => events.push(e),
    })

    await assert.rejects(
      async () => wrapped.execute('call-3', { command: 'ls -la' }, undefined as any, undefined as any),
      /需要用户确认/,
    )
    assert.equal(wasExecuted(), false)
    assert.equal(events[0].type, 'confirm_required')
    assert.ok(events[0].description.includes('测试 ask'))
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('新引擎 allow + 旧引擎 Confirm (rm -rf /tmp)：取更严格 Confirm', async () => {
  const ws = await mkWorkspace()
  try {
    const manager = await PermissionManager.create({
      workspaceDir: ws,
      auditSink: new NullAuditSink(),
      bashClassifier: makeFakeClassifier({
        level: 'allow',
        confidence: 'high',
        reason: '假分类器允许',
      }),
    })
    const { tool, wasExecuted } = makeFakeTool('bash')
    const events: ToolPermissionEvent[] = []
    const [wrapped] = createPermissionAwareTools([tool], {
      role: 'simple',
      workspaceDir: ws,
      enabled: true,
      manager,
      onEvent: (e) => events.push(e),
    })

    await assert.rejects(
      async () => wrapped.execute('call-4', { command: 'rm -rf /tmp' }, undefined as any, undefined as any),
    )
    assert.equal(wasExecuted(), false)
    assert.equal(events[0].type, 'confirm_required')
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('路径遍历：file-operations 前置 deny，短路不执行', async () => {
  const ws = await mkWorkspace()
  try {
    const manager = await PermissionManager.create({
      workspaceDir: ws,
      auditSink: new NullAuditSink(),
    })
    const { tool, wasExecuted } = makeFakeTool('edit_file')
    const events: ToolPermissionEvent[] = []
    const [wrapped] = createPermissionAwareTools([tool], {
      role: 'simple',
      workspaceDir: ws,
      enabled: true,
      manager,
      onEvent: (e) => events.push(e),
    })

    await assert.rejects(
      async () =>
        wrapped.execute(
          'call-5',
          { file_path: '../../etc/passwd', content: 'x' },
          undefined as any,
          undefined as any,
        ),
      /已被安全策略阻止/,
    )
    assert.equal(wasExecuted(), false)
    assert.equal(events.length, 0)
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('新引擎 allow + 旧引擎 Auto：允许执行', async () => {
  const ws = await mkWorkspace()
  try {
    // 关闭 builtin（builtin 默认 bash→ask 会压倒分类器的 allow）
    const manager = await PermissionManager.create({
      workspaceDir: ws,
      auditSink: new NullAuditSink(),
      loadOptions: {
        includeBuiltin: false,
        includeUserSettings: false,
        includeProjectSettings: false,
      },
      bashClassifier: makeFakeClassifier({
        level: 'allow',
        confidence: 'high',
        reason: '允许',
      }),
    })
    const { tool, wasExecuted } = makeFakeTool('bash')
    const events: ToolPermissionEvent[] = []
    const [wrapped] = createPermissionAwareTools([tool], {
      role: 'simple',
      workspaceDir: ws,
      enabled: true,
      manager,
      onEvent: (e) => events.push(e),
    })

    await wrapped.execute('call-6', { command: 'ls -la' }, undefined as any, undefined as any)
    assert.equal(wasExecuted(), true)
    // 双路 Auto，不发任何事件
    assert.equal(events.length, 0)
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('新引擎抛错：降级到旧引擎', async () => {
  const ws = await mkWorkspace()
  try {
    // 构造一个会抛错的 Manager（通过 classifier 抛错）
    const brokenClassifier: CommandClassifier = {
      name: 'broken',
      async classify() {
        throw new Error('classifier boom')
      },
    }
    const manager = await PermissionManager.create({
      workspaceDir: ws,
      auditSink: new NullAuditSink(),
      bashClassifier: brokenClassifier,
    })
    // checker 的 try/catch 会把 classifier 的异常翻译为 deny —— 这里我们改
    // 用 "manager.check 本身抛出" 的极端路径。由于 checker 吞下了所有内部
    // 异常，真正触发 tool-permission 的 catch 需要让 manager.check 抛错。
    // 覆盖 manager.check 为同步抛错函数：
    const brokenManager = {
      ...manager,
      check: async () => {
        throw new Error('manager boom')
      },
    } as unknown as typeof manager

    const { tool, wasExecuted } = makeFakeTool('bash')
    const events: ToolPermissionEvent[] = []
    const [wrapped] = createPermissionAwareTools([tool], {
      role: 'simple',
      workspaceDir: ws,
      enabled: true,
      manager: brokenManager,
      onEvent: (e) => events.push(e),
    })

    // rm -rf /tmp 旧引擎判定 Confirm —— 应走 Confirm 路径而非让 boom 冒泡
    await assert.rejects(
      async () => wrapped.execute('call-7', { command: 'rm -rf /tmp' }, undefined as any, undefined as any),
    )
    assert.equal(wasExecuted(), false)
    assert.equal(events[0].type, 'confirm_required')
    // 描述来自旧引擎（不含 manager boom）
    assert.ok(!events[0].description.includes('manager boom'))
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})
