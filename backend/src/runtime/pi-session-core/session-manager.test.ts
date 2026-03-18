import test from 'node:test'
import assert from 'node:assert/strict'
import { SessionManager } from './session-manager.js'

function createManager(): SessionManager {
  return new SessionManager({
    cwd: process.cwd(),
    sessionDir: '/tmp',
    persist: false,
  })
}

test('buildSessionContext respects compaction boundary and kept entries', () => {
  const manager = createManager()
  manager.appendThinkingLevelChange('off')

  manager.appendMessage({ role: 'user', content: 'first user', timestamp: Date.now() - 10_000 })
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'first assistant' }],
    timestamp: Date.now() - 9_000,
    provider: 'openai',
    model: 'glm-4.7',
  })
  const keptId = manager.appendMessage({ role: 'user', content: 'kept user', timestamp: Date.now() - 8_000 })
  manager.appendCompaction('summary before kept user', keptId, 1234)
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'after compaction' }],
    timestamp: Date.now() - 7_000,
    provider: 'openai',
    model: 'glm-4.7',
  })

  const context = manager.buildSessionContext()
  const texts = context.messages.map((message) => {
    if (typeof message.content === 'string') return message.content
    return message.content
      .map((part) => ('text' in part ? part.text : ''))
      .join('\n')
  })

  assert.deepEqual(texts, [
    '此前的对话已被压缩为以下摘要：\n\nsummary before kept user',
    'kept user',
    'after compaction',
  ])
})

test('branchWithSummary creates alternate branch context', () => {
  const manager = createManager()
  const rootId = manager.appendMessage({ role: 'user', content: 'root question', timestamp: Date.now() - 10_000 })
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'old answer' }],
    timestamp: Date.now() - 9_000,
    provider: 'openai',
    model: 'glm-4.7',
  })
  manager.appendMessage({ role: 'user', content: 'follow up', timestamp: Date.now() - 8_000 })

  manager.branchWithSummary(rootId, 'old branch summary')
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'new answer' }],
    timestamp: Date.now() - 7_000,
    provider: 'openai',
    model: 'glm-4.7',
  })

  const context = manager.buildSessionContext()
  const texts = context.messages.map((message) => {
    if (typeof message.content === 'string') return message.content
    return message.content
      .map((part) => ('text' in part ? part.text : ''))
      .join('\n')
  })

  assert.equal(texts[0], 'root question')
  assert.equal(texts[1], `你正在继续一条分支，会话在 ${rootId} 处分叉。此前分支摘要：\n\nold branch summary`)
  assert.equal(texts[2], 'new answer')
})

test('buildSessionContext preserves thinking blocks for assistant messages', () => {
  const manager = createManager()
  manager.appendThinkingLevelChange('medium')
  manager.appendMessage({ role: 'user', content: 'why?', timestamp: Date.now() - 10_000 })
  manager.appendMessage({
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: 'first thought', thinkingSignature: 'reasoning' },
      { type: 'text', text: 'final answer' },
    ],
    timestamp: Date.now() - 9_000,
    provider: 'openai',
    model: 'qwen3',
  })

  const context = manager.buildSessionContext()
  const assistant = context.messages.find((message) => message.role === 'assistant')

  assert.equal(context.thinkingLevel, 'medium')
  assert.ok(assistant)
  assert.deepEqual(assistant.content, [
    { type: 'thinking', thinking: 'first thought', thinkingSignature: 'reasoning' },
    { type: 'text', text: 'final answer' },
  ])
})
