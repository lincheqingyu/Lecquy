/**
 * 文件操作权限检查单元测试
 */

import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile, mkdir, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  canDeleteFile,
  canEditFile,
  canExecuteFile,
  canReadFile,
} from '../file-operations.js'

async function mkWorkspace(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), 'lecquy-permissions-'))
}

test('canReadFile 默认允许普通文件', async () => {
  const ws = await mkWorkspace()
  try {
    const d = canReadFile({ filePath: 'foo.txt', workspaceDir: ws })
    assert.equal(d.behavior, 'allow')
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('canReadFile 对 .env 返回 ask', async () => {
  const ws = await mkWorkspace()
  try {
    const d = canReadFile({ filePath: '.env', workspaceDir: ws })
    assert.equal(d.behavior, 'ask')
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('canReadFile 对路径遍历返回 deny', async () => {
  const ws = await mkWorkspace()
  try {
    const d = canReadFile({ filePath: '../../etc/passwd', workspaceDir: ws })
    assert.equal(d.behavior, 'deny')
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('canEditFile 对系统保护路径 deny', async () => {
  const ws = await mkWorkspace()
  try {
    const d = canEditFile({
      filePath: '/etc/hosts',
      workspaceDir: ws,
      allowOutsideWorkspace: true,
    })
    assert.equal(d.behavior, 'deny')
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('canEditFile 允许 /var/folders 工作区内的普通相对路径', () => {
  const ws = '/var/folders/xx/yy/workspace-root'
  const d = canEditFile({ filePath: 'foo/bar.ts', workspaceDir: ws })

  assert.equal(d.behavior, 'allow')
  assert.notEqual(d.reason, '命中系统保护路径')
})

test('canEditFile 仍拒绝 /var/folders 工作区外的 /var 系统路径', () => {
  const ws = '/var/folders/xx/yy/workspace-root'
  const d = canEditFile({
    filePath: '/var/log/syslog',
    workspaceDir: ws,
    allowOutsideWorkspace: true,
  })

  assert.equal(d.behavior, 'deny')
  assert.equal(d.reason, '命中系统保护路径')
})

test('canEditFile 对 .bashrc 返回 ask', async () => {
  const ws = await mkWorkspace()
  try {
    const d = canEditFile({ filePath: '.bashrc', workspaceDir: ws })
    assert.equal(d.behavior, 'ask')
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('canEditFile 普通文件 allow', async () => {
  const ws = await mkWorkspace()
  try {
    const d = canEditFile({ filePath: 'src/index.ts', workspaceDir: ws })
    assert.equal(d.behavior, 'allow')
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('canDeleteFile 对危险文件直接 deny', async () => {
  const ws = await mkWorkspace()
  try {
    const d = canDeleteFile({ filePath: '.bashrc', workspaceDir: ws })
    assert.equal(d.behavior, 'deny')
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('canDeleteFile 普通文件 allow', async () => {
  const ws = await mkWorkspace()
  try {
    const d = canDeleteFile({ filePath: 'foo.log', workspaceDir: ws })
    assert.equal(d.behavior, 'allow')
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('canExecuteFile 总是 ask', async () => {
  const ws = await mkWorkspace()
  try {
    const d = canExecuteFile({ filePath: 'build.sh', workspaceDir: ws })
    assert.equal(d.behavior, 'ask')
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})

test('canEditFile 拒绝指向工作区外的 symlink', async () => {
  const ws = await mkWorkspace()
  const outside = await mkdtemp(path.join(os.tmpdir(), 'lecquy-outside-'))
  try {
    const targetFile = path.join(outside, 'secret.txt')
    await writeFile(targetFile, 'secret')
    const linkPath = path.join(ws, 'evil')
    await symlink(targetFile, linkPath)
    const d = canEditFile({ filePath: 'evil', workspaceDir: ws })
    assert.equal(d.behavior, 'deny')
    assert.match(d.reason, /符号链接/)
  } finally {
    await rm(ws, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  }
})

test('canEditFile 允许工作区内的 symlink', async () => {
  const ws = await mkWorkspace()
  try {
    await mkdir(path.join(ws, 'src'))
    const real = path.join(ws, 'src', 'real.ts')
    await writeFile(real, 'x')
    await symlink(real, path.join(ws, 'alias'))
    const d = canEditFile({ filePath: 'alias', workspaceDir: ws })
    assert.equal(d.behavior, 'allow')
  } finally {
    await rm(ws, { recursive: true, force: true })
  }
})
