import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { migrateLegacyRuntimeStorage } from './runtime-storage-migration.js'
import { resolveRuntimePaths } from './runtime-paths.js'

async function createWorkspace(): Promise<string> {
  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), 'zxhclaw-runtime-'))
  await mkdir(path.join(workspaceDir, 'backend'), { recursive: true })
  return workspaceDir
}

test('migrateLegacyRuntimeStorage merges legacy runtime dirs into root .ZxhClaw', async () => {
  const workspaceDir = await createWorkspace()
  const paths = resolveRuntimePaths(workspaceDir)

  try {
    await mkdir(path.dirname(paths.memoryFile), { recursive: true })
    await writeFile(paths.memoryFile, '根目录记忆优先\n', 'utf8')

    await mkdir(path.join(workspaceDir, '.sessions-v3'), { recursive: true })
    await writeFile(
      path.join(workspaceDir, '.sessions-v3', 'sessions.json'),
      JSON.stringify({ entries: { 'root-key': { key: 'root-key', sessionId: 'sess_root' } } }, null, 2),
      'utf8',
    )

    await mkdir(path.join(workspaceDir, 'backend', '.sessions-v3', 'sessions'), { recursive: true })
    await writeFile(
      path.join(workspaceDir, 'backend', '.sessions-v3', 'sessions.json'),
      JSON.stringify({ entries: { 'backend-key': { key: 'backend-key', sessionId: 'sess_backend' } } }, null, 2),
      'utf8',
    )
    await writeFile(
      path.join(workspaceDir, 'backend', '.sessions-v3', 'sessions', 'sess_backend.jsonl'),
      [
        JSON.stringify({
          type: 'session',
          version: 1,
          id: 'sess_backend',
          timestamp: '2026-03-19T00:00:00.000Z',
          cwd: path.join(workspaceDir, 'backend'),
        }),
        JSON.stringify({
          type: 'custom',
          customType: 'generated_files',
          id: 'custom_1',
          parentId: null,
          timestamp: '2026-03-19T00:00:01.000Z',
          data: {
            stepId: 'step_1',
            toolName: 'write_file',
            generatedFiles: [{
              filePath: 'docs/cadre_comparison.html',
              attachment: {
                kind: 'file',
                name: 'cadre_comparison.html',
                mimeType: 'text/html',
                text: '<html><body>legacy doc</body></html>',
              },
            }],
          },
        }),
      ].join('\n') + '\n',
      'utf8',
    )

    await mkdir(path.join(workspaceDir, 'backend', '.memory'), { recursive: true })
    await writeFile(path.join(workspaceDir, 'backend', '.memory', 'MEMORY.md'), '旧记忆内容\n', 'utf8')

    await mkdir(path.join(workspaceDir, 'backend', 'docs'), { recursive: true })
    await writeFile(path.join(workspaceDir, 'backend', 'docs', 'cadre_comparison.html'), '<html>legacy</html>', 'utf8')

    await mkdir(path.join(workspaceDir, 'backend', '.ZxhClaw', 'system-prompt'), { recursive: true })
    await writeFile(path.join(workspaceDir, 'backend', '.ZxhClaw', 'system-prompt', 'custom.md'), 'legacy prompt\n', 'utf8')

    await mkdir(path.join(workspaceDir, 'backend', '.sessions-v2', 'snapshots'), { recursive: true })
    await writeFile(path.join(workspaceDir, 'backend', '.sessions-v2', 'sessions.json'), '{"entries":{}}', 'utf8')

    await migrateLegacyRuntimeStorage(workspaceDir)

    const index = JSON.parse(await readFile(paths.sessionStoreIndexFile, 'utf8')) as {
      entries: Record<string, { key: string }>
    }
    assert.deepEqual(Object.keys(index.entries).sort(), ['backend-key', 'root-key'])

    const migratedSessionRaw = await readFile(path.join(paths.sessionStoreSessionsDir, 'sess_backend.jsonl'), 'utf8')
    assert.match(migratedSessionRaw, new RegExp(`"cwd":"${workspaceDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`))
    assert.match(migratedSessionRaw, /"generatedArtifacts":\[/)
    assert.match(migratedSessionRaw, /\.ZxhClaw\/artifacts\/docs\/legacy\/cadre_comparison\.html/)

    const legacyDocs = await readdir(paths.artifactsLegacyDocsDir)
    assert.ok(legacyDocs.some((name) => name.startsWith('cadre_comparison')))
    assert.equal(await readFile(paths.memoryFile, 'utf8'), '根目录记忆优先\n')
    assert.equal(await readFile(path.join(paths.systemPromptDir, 'custom.md'), 'utf8'), 'legacy prompt\n')

    assert.equal(existsSync(path.join(workspaceDir, '.sessions-v3')), false)
    assert.equal(existsSync(path.join(workspaceDir, 'backend', '.sessions-v3')), false)
    assert.equal(existsSync(path.join(workspaceDir, 'backend', '.memory')), false)
    assert.equal(existsSync(path.join(workspaceDir, 'backend', 'docs')), false)
    assert.equal(existsSync(path.join(workspaceDir, 'backend', '.ZxhClaw')), false)
    assert.equal(existsSync(path.join(workspaceDir, 'backend', '.sessions-v2')), false)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('migrateLegacyRuntimeStorage imports backend/.memory when root MEMORY is missing', async () => {
  const workspaceDir = await createWorkspace()
  const paths = resolveRuntimePaths(workspaceDir)

  try {
    await mkdir(path.join(workspaceDir, 'backend', '.memory'), { recursive: true })
    await writeFile(path.join(workspaceDir, 'backend', '.memory', 'MEMORY.md'), '从 backend 导入的记忆\n', 'utf8')

    await migrateLegacyRuntimeStorage(workspaceDir)

    assert.equal(await readFile(paths.memoryFile, 'utf8'), '从 backend 导入的记忆\n')
    assert.equal(existsSync(path.join(workspaceDir, 'backend', '.memory')), false)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
