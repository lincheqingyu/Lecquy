/**
 * 权限检查核心引擎测试
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { checkPermission, findMatchingRule } from '../checker.js'
import type {
  PermissionCheckContext,
  PermissionMode,
  PermissionRule,
} from '../types.js'

async function mkWorkspace(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), 'lecquy-checker-'))
}

const baseCtx = (toolName: string, args: Record<string, unknown> = {}, workspaceDir = '/tmp'): PermissionCheckContext => ({
  toolName,
  args,
  workspaceDir,
})

test('deny 规则直接拒绝', async () => {
  const ws = await mkWorkspace()
  try {
    const rules: PermissionRule[] = [
      { source: 'projectSettings', behavior: 'deny', toolName: 'bash', content: 'rm' },
    ]
    const r = await checkPermission({
      rules,
      mode: 'default',
      context: baseCtx('bash', { command: 'rm foo' }, ws),
    })
    assert.equal(r.decision.behavior, 'deny')
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('allow 规则通过', async () => {
  const rules: PermissionRule[] = [
    { source: 'projectSettings', behavior: 'allow', toolName: 'read_file' },
  ]
  const r = await checkPermission({
    rules,
    mode: 'default',
    context: baseCtx('read_file', { path: 'foo.txt' }, '/tmp'),
  })
  assert.equal(r.decision.behavior, 'allow')
})

test('bash 分类器在无规则情况下触发 ask', async () => {
  const r = await checkPermission({
    rules: [],
    mode: 'default',
    context: baseCtx('bash', { command: 'curl https://example.com' }, '/tmp'),
  })
  assert.equal(r.decision.behavior, 'ask')
})

test('bash 分类器的 deny 高于规则', async () => {
  const rules: PermissionRule[] = [
    { source: 'projectSettings', behavior: 'allow', toolName: 'bash' },
  ]
  const r = await checkPermission({
    rules,
    mode: 'default',
    context: baseCtx('bash', { command: 'rm -rf /' }, '/tmp'),
  })
  assert.equal(r.decision.behavior, 'deny')
})

test('acceptEdits 放行编辑类工具', async () => {
  const ws = await mkWorkspace()
  try {
    const r = await checkPermission({
      rules: [
        { source: 'builtin', behavior: 'ask', toolName: 'edit_file' },
      ],
      mode: 'acceptEdits',
      context: baseCtx('edit_file', { file_path: 'src/foo.ts' }, ws),
    })
    assert.equal(r.decision.behavior, 'allow')
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('acceptEdits 不放行 bash', async () => {
  const r = await checkPermission({
    rules: [],
    mode: 'acceptEdits',
    context: baseCtx('bash', { command: 'sudo apt install x' }, '/tmp'),
  })
  assert.equal(r.decision.behavior, 'ask')
})

test('bypassPermissions 全部 allow', async () => {
  const r = await checkPermission({
    rules: [
      { source: 'projectSettings', behavior: 'deny', toolName: 'bash' },
    ],
    mode: 'bypassPermissions',
    context: baseCtx('bash', { command: 'rm -rf /' }, '/tmp'),
  })
  // 注意：deny 规则优先于 mode.bypass，这是语义上更安全的选择
  // 但 bash 分类器判定 rm -rf / 为 deny，规则 deny 也成立
  // 因此结果应为 deny
  assert.equal(r.decision.behavior, 'deny')
})

test('bypassPermissions 在没有 deny 规则时 allow', async () => {
  const r = await checkPermission({
    rules: [],
    mode: 'bypassPermissions',
    context: baseCtx('read_file', { path: 'foo' }, '/tmp'),
  })
  assert.equal(r.decision.behavior, 'allow')
})

test('plan 模式返回 plan 决策', async () => {
  const r = await checkPermission({
    rules: [],
    mode: 'plan' as PermissionMode,
    context: baseCtx('read_file', { path: 'foo' }, '/tmp'),
  })
  assert.equal(r.decision.behavior, 'plan')
})

test('dontAsk 模式下未批准操作 deny', async () => {
  const r = await checkPermission({
    rules: [],
    mode: 'dontAsk',
    context: baseCtx('bash', { command: 'curl https://x.com' }, '/tmp'),
  })
  assert.equal(r.decision.behavior, 'deny')
})

test('dontAsk 模式下明确 allow 的工具放行', async () => {
  const r = await checkPermission({
    rules: [
      { source: 'userSettings', behavior: 'allow', toolName: 'read_file' },
    ],
    mode: 'dontAsk',
    context: baseCtx('read_file', { path: 'foo' }, '/tmp'),
  })
  assert.equal(r.decision.behavior, 'allow')
})

test('findMatchingRule 精确匹配优先（经 sortRulesByPriority）', async () => {
  const { sortRulesByPriority } = await import('../loader.js')
  const rules: PermissionRule[] = sortRulesByPriority([
    { source: 'builtin', behavior: 'deny', toolName: '*' },
    { source: 'userSettings', behavior: 'allow', toolName: 'read_file' },
  ])
  const r = findMatchingRule(
    { toolName: 'read_file', args: {}, workspaceDir: '/tmp' },
    rules,
  )
  assert.equal(r?.toolName, 'read_file')
})

test('findMatchingRule content glob', () => {
  const rules: PermissionRule[] = [
    { source: 'projectSettings', behavior: 'deny', toolName: 'edit_file', content: '**/*.env' },
  ]
  const match = findMatchingRule(
    { toolName: 'edit_file', args: { file_path: 'config/.env' }, workspaceDir: '/tmp' },
    rules,
  )
  assert.equal(match?.behavior, 'deny')
})

test('findMatchingRule bash 前缀匹配', () => {
  const rules: PermissionRule[] = [
    { source: 'projectSettings', behavior: 'allow', toolName: 'bash', content: 'git ' },
  ]
  const match = findMatchingRule(
    { toolName: 'bash', args: { command: 'git status' }, workspaceDir: '/tmp' },
    rules,
  )
  assert.equal(match?.behavior, 'allow')
})

test('路径遍历 checker 直接 deny', async () => {
  const r = await checkPermission({
    rules: [],
    mode: 'default',
    context: baseCtx('edit_file', { file_path: '../../etc/passwd' }, '/tmp'),
  })
  assert.equal(r.decision.behavior, 'deny')
})
