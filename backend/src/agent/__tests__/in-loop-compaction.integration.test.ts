import test from 'node:test'
import assert from 'node:assert/strict'
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Message,
  type SimpleStreamOptions,
} from '@mariozechner/pi-ai'
import type { StreamFn } from '@mariozechner/pi-agent-core'
import { loadConfig } from '../../config/index.js'
import { createVllmModel } from '../vllm-model.js'
import { runSimpleAgent } from '../agent-runner.js'

process.env.LLM_API_KEY ??= 'test-key'
loadConfig()

function estimateContextChars(messages: Message[]): number {
  return messages.reduce((sum, message) => {
    if (typeof message.content === 'string') return sum + message.content.length
    return sum + JSON.stringify(message.content).length
  }, 0)
}

function createAssistantMessage(content: AssistantMessage['content'], stopReason: AssistantMessage['stopReason']): AssistantMessage {
  return {
    role: 'assistant',
    content,
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
    stopReason,
    timestamp: Date.now(),
  }
}

function streamMessage(message: AssistantMessage): ReturnType<typeof createAssistantMessageEventStream> {
  const stream = createAssistantMessageEventStream()
  queueMicrotask(() => {
    stream.push({
      type: 'done',
      reason: message.stopReason === 'toolUse' ? 'toolUse' : 'stop',
      message,
    })
  })
  return stream
}

test('runSimpleAgent compacts accumulated in-loop tool results before the final LLM call', async () => {
  const capturedCharCounts: number[] = []
  const streamFn: StreamFn = (
    _model,
    context: Context,
    _options?: SimpleStreamOptions,
  ) => {
    capturedCharCounts.push(estimateContextChars(context.messages))
    const toolResultCount = context.messages.filter((message) => message.role === 'toolResult').length

    if (toolResultCount < 8) {
      return streamMessage(createAssistantMessage([
        {
          type: 'toolCall',
          id: `read-${toolResultCount}`,
          name: 'read_file',
          arguments: { path: 'pnpm-lock.yaml' },
        },
      ], 'toolUse'))
    }

    return streamMessage(createAssistantMessage([{ type: 'text', text: 'done' }], 'stop'))
  }

  await runSimpleAgent({
    messages: [{ role: 'user', content: 'read repeatedly and summarize', timestamp: Date.now() }],
    model: createVllmModel({ modelId: 'local-128k' }),
    apiKey: 'test-key',
    enableTools: true,
    disableLegacyMemoryFlush: true,
    streamFn,
  })

  assert.ok(capturedCharCounts.length >= 9)
  assert.ok(capturedCharCounts.at(-1)! < 200_000)
})
