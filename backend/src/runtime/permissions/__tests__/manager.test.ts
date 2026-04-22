/**
 * PermissionManager 集成测试
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { PermissionManager } from '../manager.js'
import { InMemoryAuditSink } from '../audit-log.js'

async function mkWorkspace(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), 'lecquy-mgr-'))
}

test('PermissionManager.create 加载 builtin 规则', async () => {
  const ws = await mkWorkspace()
  try {
    const mgr = await PermissionManager.create({ workspaceDir: ws })
    const rules = mgr.getRules()
    assert.ok(rules.some((r) => r.toolName === 'read_file' && r.behavior === 'allow'))
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('check 走完整流程', async () => {
  const ws = await mkWorkspace()
  try {
    const mgr = await PermissionManager.create({ workspaceDir: ws })
    const r = await mgr.check({
      toolName: 'read_file',
      args: { path: 'foo.txt' },
      workspaceDir: ws,
    })
    assert.equal(r.decision.behavior, 'allow')
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('setMode 切换权限模式', async () => {
  const ws = await mkWorkspace()
  try {
    const mgr = await PermissionManager.create({ workspaceDir: ws })
    mgr.setMode('bypassPermissions')
    assert.equal(mgr.getMode(), 'bypassPermissions')
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('applyUpdate 动态添加规则', async () => {
  const ws = await mkWorkspace()
  try {
    const mgr = await PermissionManager.create({ workspaceDir: ws })
    const beforeLen = mgr.getRules().length
    mgr.applyUpdate({
      type: 'addRule',
      rule: {
        source: 'session',
        behavior: 'allow',
        toolName: 'bash',
        content: 'ls',
      },
    })
    assert.equal(mgr.getRules().length, beforeLen + 1)

    const r = await mgr.check({
      toolName: 'bash',
      args: { command: 'ls -la' },
      workspaceDir: ws,
    })
    assert.equal(r.decision.behavior, 'allow')
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('subscribe 收到变更事件', async () => {
  const ws = await mkWorkspace()
  try {
    const mgr = await PermissionManager.create({ workspaceDir: ws })
    const events: string[] = []
    const unsub = mgr.subscribe((e) => {
      events.push(e.type)
    })
    mgr.setMode('plan')
    mgr.applyUpdate({
      type: 'addRule',
      rule: { source: 'session', behavior: 'allow', toolName: 'read_file' },
    })
    await mgr.check({ toolName: 'read_file', args: {}, workspaceDir: ws })
    unsub()
    assert.ok(events.includes('modeChanged'))
    assert.ok(events.includes('rulesChanged'))
    assert.ok(events.includes('decision'))
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('审计日志记录决策', async () => {
  const ws = await mkWorkspace()
  try {
    const sink = new InMemoryAuditSink()
    const mgr = await PermissionManager.create({
      workspaceDir: ws,
      auditSink: sink,
    })
    await mgr.check({
      toolName: 'bash',
      args: { command: 'rm -rf /' },
      workspaceDir: ws,
    })
    // 等待异步 write
    await new Promise((resolve) => setImmediate(resolve))
    const rec = await sink.recent(10)
    assert.equal(rec.length, 1)
    assert.equal(rec[0].toolName, 'bash')
    assert.equal(rec[0].decision.behavior, 'deny')
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})
