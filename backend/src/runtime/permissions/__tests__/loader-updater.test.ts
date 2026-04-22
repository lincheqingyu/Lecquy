/**
 * 规则加载器与更新器集成测试
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  detectShadowedRules,
  loadPermissionRules,
  parseCliRule,
  sortRulesByPriority,
} from '../loader.js'
import { applyUpdate, applyUpdates, persistRules } from '../updater.js'
import type { PermissionRule } from '../types.js'

async function mkWorkspace(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), 'lecquy-loader-'))
}

test('sortRulesByPriority 高优先级源排前', () => {
  const input: PermissionRule[] = [
    { source: 'builtin', behavior: 'ask', toolName: 'bash' },
    { source: 'projectSettings', behavior: 'deny', toolName: 'bash' },
    { source: 'userSettings', behavior: 'allow', toolName: 'bash' },
    { source: 'cliArg', behavior: 'allow', toolName: 'bash' },
  ]
  const sorted = sortRulesByPriority(input)
  assert.equal(sorted[0].source, 'cliArg')
  assert.equal(sorted[1].source, 'projectSettings')
  assert.equal(sorted[2].source, 'userSettings')
  assert.equal(sorted[3].source, 'builtin')
})

test('detectShadowedRules 汇报被遮蔽', () => {
  const input: PermissionRule[] = [
    { source: 'cliArg', behavior: 'allow', toolName: 'bash', content: 'ls' },
    { source: 'projectSettings', behavior: 'deny', toolName: 'bash', content: 'ls' },
  ]
  const reports = detectShadowedRules(input)
  assert.equal(reports.length, 1)
  assert.equal(reports[0].shadowed.source, 'projectSettings')
  assert.equal(reports[0].shadowedBy.source, 'cliArg')
})

test('parseCliRule 解析 allow:read_file', () => {
  const r = parseCliRule('allow:read_file')
  assert.equal(r?.behavior, 'allow')
  assert.equal(r?.toolName, 'read_file')
  assert.equal(r?.source, 'cliArg')
})

test('parseCliRule 解析 deny:bash:rm -rf', () => {
  const r = parseCliRule('deny:bash:rm -rf')
  assert.equal(r?.behavior, 'deny')
  assert.equal(r?.toolName, 'bash')
  assert.equal(r?.content, 'rm -rf')
})

test('parseCliRule 非法返回 null', () => {
  assert.equal(parseCliRule('xxx'), null)
  assert.equal(parseCliRule('force:bash'), null)
})

test('loadPermissionRules 读取项目配置', async () => {
  const ws = await mkWorkspace()
  try {
    await mkdir(path.join(ws, '.lecquy'), { recursive: true })
    await writeFile(
      path.join(ws, '.lecquy', 'permissions.json'),
      JSON.stringify({
        version: '1.0',
        defaultMode: 'acceptEdits',
        rules: [
          { behavior: 'deny', toolName: 'bash', content: 'rm -rf' },
        ],
      }),
    )
    const loaded = await loadPermissionRules({
      workspaceDir: ws,
      includeUserSettings: false,
      includeProjectSettings: true,
    })
    assert.equal(loaded.defaultMode, 'acceptEdits')
    assert.ok(
      loaded.rules.some(
        (r) =>
          r.source === 'projectSettings' &&
          r.behavior === 'deny' &&
          r.content === 'rm -rf',
      ),
    )
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('applyUpdate add/remove/clear', () => {
  const initial: PermissionRule[] = [
    { source: 'session', behavior: 'allow', toolName: 'bash', content: 'ls' },
  ]
  // add
  const added = applyUpdate(initial, {
    type: 'addRule',
    rule: { source: 'session', behavior: 'allow', toolName: 'bash', content: 'cat' },
  })
  assert.equal(added.length, 2)

  // add dup 幂等
  const dup = applyUpdate(added, {
    type: 'addRule',
    rule: { source: 'session', behavior: 'allow', toolName: 'bash', content: 'ls' },
  })
  assert.equal(dup.length, 2)

  // remove
  const removed = applyUpdate(added, {
    type: 'removeRule',
    source: 'session',
    toolName: 'bash',
    content: 'cat',
  })
  assert.equal(removed.length, 1)

  // clearSource
  const cleared = applyUpdate(added, { type: 'clearSource', source: 'session' })
  assert.equal(cleared.length, 0)
})

test('persistRules 写回磁盘', async () => {
  const ws = await mkWorkspace()
  try {
    const rules: PermissionRule[] = [
      { source: 'projectSettings', behavior: 'deny', toolName: 'bash', content: 'rm' },
      { source: 'session', behavior: 'allow', toolName: 'read_file' },
    ]
    const filePath = await persistRules({
      destination: 'projectSettings',
      rules,
      workspaceDir: ws,
    })
    const content = await readFile(filePath, 'utf-8')
    const parsed = JSON.parse(content)
    assert.equal(parsed.version, '1.0')
    assert.equal(parsed.rules.length, 1) // 只持久化 projectSettings 的规则
    assert.equal(parsed.rules[0].content, 'rm')
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('applyUpdates 批量', () => {
  const initial: PermissionRule[] = []
  const next = applyUpdates(initial, [
    {
      type: 'addRule',
      rule: { source: 'session', behavior: 'allow', toolName: 'read_file' },
    },
    {
      type: 'addRule',
      rule: { source: 'session', behavior: 'deny', toolName: 'bash', content: 'rm' },
    },
  ])
  assert.equal(next.length, 2)
})
