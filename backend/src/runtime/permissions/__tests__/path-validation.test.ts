/**
 * 路径验证单元测试
 */

import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'

import {
  containsPathTraversal,
  containsVulnerableUncPath,
  isWithinWorkspace,
  matchGlob,
  normalizePath,
  PathOutsideWorkspaceError,
  resolveWithinWorkspace,
  validatePath,
} from '../path-validation.js'

test('containsPathTraversal 检测 .. 段', () => {
  assert.equal(containsPathTraversal('../../etc/passwd'), true)
  assert.equal(containsPathTraversal('a/b/../c'), true)
  assert.equal(containsPathTraversal('..\\windows\\system32'), true)
  assert.equal(containsPathTraversal('foo/bar'), false)
  assert.equal(containsPathTraversal('..foo/bar'), false) // 不是段
  assert.equal(containsPathTraversal('foo/..bar'), false)
})

test('containsPathTraversal 检测 URL 编码 %2e%2e', () => {
  assert.equal(containsPathTraversal('%2e%2e/etc/passwd'), true)
  assert.equal(containsPathTraversal('%2E%2E/secret'), true)
})

test('containsVulnerableUncPath 识别设备路径', () => {
  assert.equal(containsVulnerableUncPath('\\\\?\\C:\\Windows'), true)
  assert.equal(containsVulnerableUncPath('\\\\.\\PhysicalDrive0'), true)
  assert.equal(containsVulnerableUncPath('\\\\server\\share\\file'), true)
  assert.equal(containsVulnerableUncPath('C:\\Users\\foo'), false)
  assert.equal(containsVulnerableUncPath('/tmp/foo'), false)
})

test('normalizePath 折叠冗余分隔符', () => {
  assert.equal(normalizePath('a\\b\\c'), 'a/b/c')
  assert.equal(normalizePath('a//b///c'), 'a/b/c')
  assert.equal(normalizePath(''), '')
})

test('resolveWithinWorkspace 限制在工作区内', () => {
  const ws = '/tmp/lecquy-workspace'
  const resolved = resolveWithinWorkspace({ filePath: 'foo/bar.txt', workspaceDir: ws })
  assert.equal(resolved, path.resolve(ws, 'foo/bar.txt'))
})

test('resolveWithinWorkspace 拒绝越界路径', () => {
  assert.throws(
    () => resolveWithinWorkspace({ filePath: '/etc/passwd', workspaceDir: '/tmp/ws' }),
    PathOutsideWorkspaceError,
  )
})

test('isWithinWorkspace 返回布尔', () => {
  const ws = '/tmp/lecquy-workspace'
  assert.equal(isWithinWorkspace('a/b', ws), true)
  assert.equal(isWithinWorkspace('/etc/passwd', ws), false)
})

test('validatePath 一站式校验', () => {
  const ws = '/tmp/lecquy-workspace'
  assert.equal(validatePath({ filePath: '../x', workspaceDir: ws }).ok, false)
  assert.equal(validatePath({ filePath: 'foo', workspaceDir: ws }).ok, true)
})

test('matchGlob * 匹配单段', () => {
  assert.equal(matchGlob('*.ts', 'a.ts'), true)
  assert.equal(matchGlob('*.ts', 'src/a.ts'), false)
})

test('matchGlob ** 匹配跨段', () => {
  assert.equal(matchGlob('**/*.ts', 'src/a.ts'), true)
  assert.equal(matchGlob('**/*.ts', 'a.ts'), true)
  assert.equal(matchGlob('src/**/foo', 'src/a/b/foo'), true)
  assert.equal(matchGlob('src/**/foo', 'src/foo'), true)
})

test('matchGlob ? 单字符', () => {
  assert.equal(matchGlob('a?.ts', 'ab.ts'), true)
  assert.equal(matchGlob('a?.ts', 'a.ts'), false)
})

test('matchGlob 字面量和转义', () => {
  assert.equal(matchGlob('foo.bar', 'foo.bar'), true)
  assert.equal(matchGlob('foo.bar', 'fooxbar'), false)
})
