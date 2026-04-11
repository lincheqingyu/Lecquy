import test from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { SessionManager } from '../runtime/pi-session-core/session-manager.js'
import { formatCompactionContextMessage } from '../runtime/context/templates/compact-summary.template.js'
import { applyCompactionIfNeeded } from './compact.js'

async function createWorkspace(): Promise<string> {
  return await mkdtemp(path.join(os.tmpdir(), 'lecquy-memory-compact-'))
}

function createManager(workspaceDir: string): SessionManager {
  return new SessionManager({
    cwd: workspaceDir,
    sessionDir: '/tmp',
    persist: false,
  })
}

test('applyCompactionIfNeeded does nothing below message threshold', async () => {
  const workspaceDir = await createWorkspace()

  try {
    const manager = createManager(workspaceDir)

    for (let index = 0; index < 49; index += 1) {
      manager.appendMessage({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `message ${index + 1}`,
        timestamp: Date.now() + index,
      })
    }

    assert.equal(await applyCompactionIfNeeded(manager), false)
    assert.equal(manager.getEntries().some((entry) => entry.type === 'compaction'), false)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('applyCompactionIfNeeded appends compaction and keeps recent tail in context', async () => {
  const workspaceDir = await createWorkspace()

  try {
    const manager = createManager(workspaceDir)

    for (let index = 0; index < 50; index += 1) {
      manager.appendMessage({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: `message ${index + 1}`,
        timestamp: Date.now() + index,
        provider: 'openai',
        model: 'glm-4.7',
      })
    }

    assert.equal(await applyCompactionIfNeeded(manager), true)
    const compaction = manager.getEntries().find((entry) => entry.type === 'compaction')
    const summaryPath = path.join(workspaceDir, '.lecquy', 'MEMORY.summary.md')
    const persistedSummary = await readFile(summaryPath, 'utf8')

    const context = manager.buildSessionContext()
    const texts = context.messages.map((message) => {
      if (typeof message.content === 'string') return message.content
      return message.content
        .map((part) => ('text' in part ? part.text : ''))
        .join('\n')
    })

    assert.equal(persistedSummary, compaction?.type === 'compaction' ? compaction.summary : '')
    assert.equal(texts[0] ?? '', formatCompactionContextMessage(compaction?.type === 'compaction' ? compaction.summary : ''))
    assert.equal(texts.length, 11)
    assert.match(texts[1] ?? '', /message 41/)
    assert.match(texts[10] ?? '', /message 50/)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})
