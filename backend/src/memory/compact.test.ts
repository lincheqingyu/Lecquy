import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionManager } from '../runtime/pi-session-core/session-manager.js'
import { formatCompactionContextMessage } from '../runtime/context/templates/compact-summary.template.js'
import { applyCompactionIfNeeded } from './compact.js'

function createManager(): SessionManager {
  return new SessionManager({
    cwd: process.cwd(),
    sessionDir: '/tmp',
    persist: false,
  })
}

test('applyCompactionIfNeeded does nothing below message threshold', () => {
  const manager = createManager()

  for (let index = 0; index < 49; index += 1) {
    manager.appendMessage({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message ${index + 1}`,
      timestamp: Date.now() + index,
    })
  }

  assert.equal(applyCompactionIfNeeded(manager), false)
  assert.equal(manager.getEntries().some((entry) => entry.type === 'compaction'), false)
})

test('applyCompactionIfNeeded appends compaction and keeps recent tail in context', () => {
  const manager = createManager()

  for (let index = 0; index < 50; index += 1) {
    manager.appendMessage({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message ${index + 1}`,
      timestamp: Date.now() + index,
      provider: 'openai',
      model: 'glm-4.7',
    })
  }

  assert.equal(applyCompactionIfNeeded(manager), true)
  const compaction = manager.getEntries().find((entry) => entry.type === 'compaction')

  const context = manager.buildSessionContext()
  const texts = context.messages.map((message) => {
    if (typeof message.content === 'string') return message.content
    return message.content
      .map((part) => ('text' in part ? part.text : ''))
      .join('\n')
  })

  assert.equal(texts[0] ?? '', formatCompactionContextMessage(compaction?.type === 'compaction' ? compaction.summary : ''))
  assert.equal(texts.length, 11)
  assert.match(texts[1] ?? '', /message 41/)
  assert.match(texts[10] ?? '', /message 50/)
})
