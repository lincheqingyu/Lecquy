import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { PermissionTier } from '../../core/prompts/prompt-layer-types.js'
import {
  classifyToolPermission,
  isManagerAllowed,
  isWorkerAllowed,
} from '../tool-permission.js'

async function createWorkspace(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), 'lecquy-tool-permission-'))
}

test('read_file is auto', async () => {
  const workspaceDir = await createWorkspace()

  try {
    const tier = classifyToolPermission('read_file', { path: 'README.md' }, 'simple', workspaceDir)
    assert.equal(tier, PermissionTier.Auto)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('bash ls -la is auto', async () => {
  const workspaceDir = await createWorkspace()

  try {
    const tier = classifyToolPermission('bash', { command: 'ls -la' }, 'simple', workspaceDir)
    assert.equal(tier, PermissionTier.Auto)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('bash rm -rf /tmp is confirm', async () => {
  const workspaceDir = await createWorkspace()

  try {
    const tier = classifyToolPermission('bash', { command: 'rm -rf /tmp' }, 'simple', workspaceDir)
    assert.equal(tier, PermissionTier.Confirm)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('bash pip install requests is confirm', async () => {
  const workspaceDir = await createWorkspace()

  try {
    const tier = classifyToolPermission('bash', { command: 'pip install requests' }, 'simple', workspaceDir)
    assert.equal(tier, PermissionTier.Confirm)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('write_file new file inside workspace is auto', async () => {
  const workspaceDir = await createWorkspace()

  try {
    const tier = classifyToolPermission(
      'write_file',
      { file_path: 'notes/new-file.md', content: 'hello' },
      'simple',
      workspaceDir,
    )
    assert.equal(tier, PermissionTier.Auto)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('write_file overwrite inside workspace is preamble', async () => {
  const workspaceDir = await createWorkspace()

  try {
    await mkdir(path.join(workspaceDir, 'notes'), { recursive: true })
    await writeFile(path.join(workspaceDir, 'notes', 'existing.md'), 'old', 'utf8')

    const tier = classifyToolPermission(
      'write_file',
      { file_path: 'notes/existing.md', content: 'new' },
      'simple',
      workspaceDir,
    )
    assert.equal(tier, PermissionTier.Preamble)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('write_file outside workspace is confirm', async () => {
  const workspaceDir = await createWorkspace()
  const outsideDir = await createWorkspace()

  try {
    const tier = classifyToolPermission(
      'write_file',
      { file_path: path.join(outsideDir, 'outside.md'), content: 'danger' },
      'simple',
      workspaceDir,
    )
    assert.equal(tier, PermissionTier.Confirm)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
    await rm(outsideDir, { recursive: true, force: true })
  }
})

test('manager bash is not allowed', () => {
  assert.equal(isManagerAllowed('bash'), false)
})

test('worker todo_write is not allowed', () => {
  assert.equal(isWorkerAllowed('todo_write'), false)
})
