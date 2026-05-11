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

// ─── B2: toolCall ↔ toolResult 配对完整性 ──────────────────────────────────────
test('compactInLoop preserves toolCall/toolResult pairing across replacements', () => {
  const messages: AgentMessage[] = []
  for (let i = 0; i < 10; i += 1) {
    messages.push(assistantMessage(i)) // toolCall id=call-i
    messages.push(toolResultMessage(i)) // toolCallId=call-i
  }

  const result = compactInLoop(messages, {
    maxTotalChars: 1,
    keepRecentTurns: 2,
    minToolResultChars: 2_000,
  })

  // 收集 result 里所有 toolCall.id
  const allToolCallIds = new Set<string>()
  for (const message of result) {
    if (message.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (
        part && typeof part === 'object'
        && 'type' in part && (part as { type?: unknown }).type === 'toolCall'
        && 'id' in part && typeof (part as { id?: unknown }).id === 'string'
      ) {
        allToolCallIds.add((part as { id: string }).id)
      }
    }
  }

  // 收集 result 里所有 toolResult.toolCallId
  const allToolResultIds = new Set<string>()
  for (const message of result) {
    if (message.role !== 'toolResult') continue
    const callId = (message as { toolCallId?: unknown }).toolCallId
    if (typeof callId === 'string') {
      allToolResultIds.add(callId)
    }
  }

  // 每个 toolCall.id 必须在 result 里有对应 toolResult.toolCallId
  for (const callId of allToolCallIds) {
    assert.ok(
      allToolResultIds.has(callId),
      `toolCall ${callId} 缺失对应 toolResult，配对被压缩破坏`,
    )
  }

  // 每个 toolResult.toolCallId 也必须有对应 toolCall（反向校验，防止替换流程产生孤儿）
  for (const callId of allToolResultIds) {
    assert.ok(
      allToolCallIds.has(callId),
      `toolResult ${callId} 缺失对应 toolCall`,
    )
  }

  // 数量对齐：10 个 assistant 都应保留 toolCall id（不能被砍）
  assert.equal(allToolCallIds.size, 10)
  assert.equal(allToolResultIds.size, 10)
})

test('compactInLoop preserves chronological order after replacement', () => {
  const messages: AgentMessage[] = []
  for (let i = 0; i < 10; i += 1) {
    messages.push(assistantMessage(i))
    messages.push(toolResultMessage(i))
  }

  const result = compactInLoop(messages, {
    maxTotalChars: 1,
    keepRecentTurns: 2,
    minToolResultChars: 2_000,
  })

  // 顺序与长度都不能变
  assert.equal(result.length, messages.length)
  for (let i = 0; i < result.length; i += 1) {
    assert.equal(
      result[i].role,
      messages[i].role,
      `位置 ${i} 角色不应被改变`,
    )
  }
})
