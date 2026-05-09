import test from 'node:test'
import assert from 'node:assert/strict'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { compactInLoop } from './in-loop-compactor.js'

function assistantMessage(index: number): AgentMessage {
  return {
    role: 'assistant',
    content: [{
      type: 'toolCall',
      id: `call-${index}`,
      name: 'read_file',
      arguments: { path: `file-${index}.txt` },
    }],
    api: 'openai-completions',
    provider: 'openai',
    model: 'test-model',
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: 'toolUse',
    timestamp: index,
  }
}

function toolResultMessage(index: number, text = 'x'.repeat(50_000)): AgentMessage {
  return {
    role: 'toolResult',
    toolCallId: `call-${index}`,
    toolName: 'read_file',
    content: [{ type: 'text', text }],
    isError: false,
    timestamp: index,
  }
}

function getText(part: unknown): string {
  if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
    return part.text
  }
  return ''
}

test('compactInLoop returns the original array when below total char threshold', () => {
  const messages: AgentMessage[] = [
    { role: 'user', content: 'hello', timestamp: 1 },
    assistantMessage(1),
  ]

  const result = compactInLoop(messages, {
    maxTotalChars: 10_000,
    keepRecentTurns: 2,
    minToolResultChars: 2_000,
  })

  assert.strictEqual(result, messages)
})

test('compactInLoop replaces old large tool results and preserves the latest two assistant turns', () => {
  const messages: AgentMessage[] = []
  for (let index = 0; index < 10; index += 1) {
    messages.push(assistantMessage(index))
    messages.push(toolResultMessage(index))
  }

  const result = compactInLoop(messages, {
    maxTotalChars: 1,
    keepRecentTurns: 2,
    minToolResultChars: 2_000,
  })

  assert.notStrictEqual(result, messages)
  for (let index = 0; index < 8; index += 1) {
    const content = result[index * 2 + 1].content
    assert.ok(Array.isArray(content))
    assert.match(getText(content[0]), /\[tool_result truncated:/)
  }

  assert.strictEqual(result[17], messages[17])
  assert.strictEqual(result[18], messages[18])
  assert.strictEqual(result[19], messages[19])
})

test('compactInLoop replaces old image blocks with text placeholders', () => {
  const messages: AgentMessage[] = [
    assistantMessage(1),
    {
      role: 'user',
      content: [
        { type: 'text', text: 'look at this' },
        { type: 'image', data: 'a'.repeat(10_000), mimeType: 'image/png', name: 'shot.png' },
      ],
      timestamp: 2,
    } as AgentMessage,
    assistantMessage(2),
  ]

  const result = compactInLoop(messages, {
    maxTotalChars: 1,
    keepRecentTurns: 1,
    minToolResultChars: 2_000,
  })

  assert.notStrictEqual(result, messages)
  const content = result[1].content
  assert.ok(Array.isArray(content))
  assert.deepEqual(content[0], { type: 'text', text: 'look at this' })
  assert.match(getText(content[1]), /\[image removed from in-loop context: shot\.png, 10000B]/)
})

test('compactInLoop returns the original array when there is no older assistant turn to compact', () => {
  const messages: AgentMessage[] = [
    assistantMessage(1),
    toolResultMessage(1),
    assistantMessage(2),
    toolResultMessage(2),
  ]

  const result = compactInLoop(messages, {
    maxTotalChars: 1,
    keepRecentTurns: 2,
    minToolResultChars: 2_000,
  })

  assert.strictEqual(result, messages)
})
