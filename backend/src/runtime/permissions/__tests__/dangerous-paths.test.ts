/**
 * 危险路径单元测试
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DANGEROUS_DIRECTORIES,
  DANGEROUS_FILES,
  isDangerousFile,
  isDangerousPath,
  isInDangerousDirectory,
  isProtectedSystemPath,
} from '../dangerous-paths.js'

test('isDangerousFile 识别 .bashrc / .env / id_rsa', () => {
  assert.equal(isDangerousFile('/home/user/.bashrc'), true)
  assert.equal(isDangerousFile('.zshrc'), true)
  assert.equal(isDangerousFile('C:\\Users\\u\\.env'), true)
  assert.equal(isDangerousFile('~/.ssh/id_rsa'), true)
  assert.equal(isDangerousFile('README.md'), false)
  assert.equal(isDangerousFile('src/main.ts'), false)
})

test('isDangerousFile 大小写不敏感', () => {
  assert.equal(isDangerousFile('/path/.BASHRC'), true)
})

test('isInDangerousDirectory 识别 .git / .ssh / .lecquy', () => {
  assert.equal(isInDangerousDirectory('/home/user/.ssh/config'), true)
  assert.equal(isInDangerousDirectory('project/.git/HEAD'), true)
  assert.equal(isInDangerousDirectory('.lecquy/permissions.json'), false) // 起始相对路径
  assert.equal(isInDangerousDirectory('/tmp/.lecquy/foo'), true)
  assert.equal(isInDangerousDirectory('foo\\.idea\\bar'), true)
  assert.equal(isInDangerousDirectory('src/code.ts'), false)
})

test('isProtectedSystemPath 识别 /etc、C:/Windows 等', () => {
  assert.equal(isProtectedSystemPath('/etc/passwd'), true)
  assert.equal(isProtectedSystemPath('/var/log/syslog'), true)
  assert.equal(isProtectedSystemPath('C:\\Windows\\System32\\cmd.exe'), true)
  assert.equal(isProtectedSystemPath('C:/Program Files/App'), true)
  assert.equal(isProtectedSystemPath('/home/user/file'), false)
  assert.equal(isProtectedSystemPath('/tmp/foo'), false)
})

test('isDangerousPath 聚合三种检查', () => {
  const a = isDangerousPath('/etc/passwd')
  assert.equal(a.dangerous, true)
  const b = isDangerousPath('/home/u/.bashrc')
  assert.equal(b.dangerous, true)
  const c = isDangerousPath('/home/u/.git/HEAD')
  assert.equal(c.dangerous, true)
  const d = isDangerousPath('/home/u/code.ts')
  assert.equal(d.dangerous, false)
})

test('常量清单非空', () => {
  assert.ok(DANGEROUS_FILES.length > 10)
  assert.ok(DANGEROUS_DIRECTORIES.length > 3)
})
