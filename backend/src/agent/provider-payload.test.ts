// 中文：本文件（provider-payload.test.ts）位于 backend/src/agent/provider-payload.test.ts，属于backend链路中的测试用例代码，连接上游调用方与下游执行逻辑。
// English: This file (provider-payload.test.ts) belongs to the backend 测试用例 layer in backend/src/agent/provider-payload.test.ts, wiring upstream callers with downstream runtime logic.

import assert from 'node:assert/strict'
import test from 'node:test'
import type { Model } from '@mariozechner/pi-ai'
import { inferProviderFlavor, mutateProviderPayload } from './provider-payload.js'

function createModel(baseUrl: string): Model<'openai-completions'> {
  return {
    id: 'test-model',
    name: 'test-model',
    api: 'openai-completions',
    provider: 'openai',
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 4096,
    compat: {},
  }
}

test('inferProviderFlavor detects bigmodel and local vllm endpoints', () => {
  assert.equal(inferProviderFlavor('https://open.bigmodel.cn/api/paas/v4/'), 'bigmodel')
  assert.equal(inferProviderFlavor('http://127.0.0.1:8000/v1'), 'vllm')
  assert.equal(inferProviderFlavor('https://example.com/v1'), 'other')
})

test('mutateProviderPayload enables tool_stream for bigmodel requests with tools', () => {
  const payload: Record<string, unknown> = {
    stream: true,
    tools: [{ type: 'function' }],
  }

  mutateProviderPayload(createModel('https://open.bigmodel.cn/api/paas/v4/'), payload)

  assert.equal(payload.tool_stream, true)
})

test('mutateProviderPayload enables tool_stream for local vllm requests with tools', () => {
  const payload: Record<string, unknown> = {
    stream: true,
    tools: [{ type: 'function' }],
  }

  mutateProviderPayload(createModel('http://127.0.0.1:8000/v1'), payload)

  assert.equal(payload.tool_stream, true)
})

test('mutateProviderPayload keeps generic openai-compatible requests unchanged', () => {
  const payload: Record<string, unknown> = {
    stream: true,
    tools: [{ type: 'function' }],
  }

  mutateProviderPayload(createModel('https://example.com/v1'), payload)

  assert.equal(payload.tool_stream, undefined)
})
