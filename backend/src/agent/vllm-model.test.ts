import test from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from '../config/index.js'
import { createVllmModel } from './vllm-model.js'

process.env.PORT ??= '3011'
process.env.NODE_ENV ??= 'test'
process.env.LLM_API_KEY ??= 'test-key'
process.env.LLM_BASE_URL ??= 'https://example.com/v1'
process.env.LLM_MODEL ??= 'test-model'
process.env.LLM_MAX_TOKENS ??= '4096'
process.env.LLM_TEMPERATURE ??= '0.7'
process.env.LLM_TIMEOUT ??= '30000'

loadConfig()

test('createVllmModel enables qwen thinking compat', () => {
  const model = createVllmModel({
    modelId: 'qwen-test',
    baseUrl: 'https://example.com/v1',
    maxTokens: 2048,
    thinkingProtocol: 'qwen',
  })

  assert.equal(model.reasoning, true)
  assert.equal(model.compat?.thinkingFormat, 'qwen')
  assert.equal(model.compat?.supportsReasoningEffort, false)
})

test('createVllmModel enables openai reasoning effort compat', () => {
  const model = createVllmModel({
    modelId: 'gpt-test',
    baseUrl: 'https://example.com/v1',
    maxTokens: 2048,
    thinkingProtocol: 'openai_reasoning',
  })

  assert.equal(model.reasoning, true)
  assert.equal(model.compat?.supportsReasoningEffort, true)
})

test('createVllmModel keeps thinking disabled when protocol is off', () => {
  const model = createVllmModel({
    modelId: 'plain-test',
    baseUrl: 'https://example.com/v1',
    maxTokens: 2048,
    thinkingProtocol: 'off',
  })

  assert.equal(model.reasoning, false)
  assert.equal(model.compat?.thinkingFormat, undefined)
  assert.equal(model.compat?.supportsReasoningEffort, false)
})
