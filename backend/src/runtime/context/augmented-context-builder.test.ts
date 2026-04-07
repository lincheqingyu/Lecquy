import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionManager } from '../pi-session-core/session-manager.js'
import { buildAugmentedContext } from './augmented-context-builder.js'
import { formatCompactionContextMessage } from './templates/compact-summary.template.js'

function createManager(): SessionManager {
  return new SessionManager({
    cwd: process.cwd(),
    sessionDir: '/tmp',
    persist: false,
  })
}

function extractText(message: { content: unknown }): string {
  if (typeof message.content === 'string') return message.content
  if (!Array.isArray(message.content)) return ''
  return message.content
    .map((part) => (part && typeof part === 'object' && 'text' in part ? String((part as { text?: unknown }).text ?? '') : ''))
    .join('\n')
}

test('buildAugmentedContext appends memory recall after stable session history', () => {
  const manager = createManager()
  manager.appendMessage({ role: 'user', content: 'first user', timestamp: Date.now() - 3_000 })
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'first assistant' }],
    timestamp: Date.now() - 2_000,
    provider: 'openai',
    model: 'glm-4.7',
  })

  const { contextMessages } = buildAugmentedContext({
    sessionManager: manager,
    memoryRecallBlock: 'memory block',
  })

  assert.deepEqual(contextMessages.map(extractText), [
    'first user',
    'first assistant',
    'memory block',
  ])
})

test('buildAugmentedContext keeps compaction summary before recent tail and avoids duplicate injection', () => {
  const manager = createManager()
  const now = Date.now()

  for (let index = 0; index < 40; index += 1) {
    manager.appendMessage({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `early message ${index + 1}`,
      timestamp: now + index,
      provider: 'openai',
      model: 'glm-4.7',
    })
  }

  const keptId = manager.appendMessage({
    role: 'user',
    content: 'recent message 41',
    timestamp: now + 40,
  })

  for (let index = 41; index < 50; index += 1) {
    manager.appendMessage({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `recent message ${index + 1}`,
      timestamp: now + index,
      provider: 'openai',
      model: 'glm-4.7',
    })
  }

  manager.appendCompaction('summary before kept tail', keptId, 123)

  const { contextMessages } = buildAugmentedContext({
    sessionManager: manager,
    memoryRecallBlock: 'memory block',
  })

  const texts = contextMessages.map(extractText)
  assert.equal(texts[0], 'memory block')
  assert.equal(texts[1], formatCompactionContextMessage('summary before kept tail'))
  assert.equal(texts[2], 'recent message 41')
  assert.equal(texts.length, 12)
})

test('buildAugmentedContext keeps regular session history unchanged when no compaction metadata exists', () => {
  const manager = createManager()
  manager.appendMessage({ role: 'user', content: 'hello', timestamp: Date.now() - 1_000 })
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'world' }],
    timestamp: Date.now(),
    provider: 'openai',
    model: 'glm-4.7',
  })

  const { contextMessages } = buildAugmentedContext({
    sessionManager: manager,
    memoryRecallBlock: '',
  })

  assert.deepEqual(contextMessages.map(extractText), ['hello', 'world'])
})
