// 中文：本文件（bash.smoke.test.ts）位于 backend/src/agent/tools/__tests__/bash.smoke.test.ts，属于backend链路中的测试用例代码，连接上游调用方与下游执行逻辑。
// English: This file (bash.smoke.test.ts) belongs to the backend 测试用例 layer in backend/src/agent/tools/__tests__/bash.smoke.test.ts, wiring upstream callers with downstream runtime logic.

import assert from 'node:assert/strict'
import test from 'node:test'

import type { AgentToolResult } from '@mariozechner/pi-agent-core'

import { createBashTool } from '../bash.js'

function firstText(result: AgentToolResult<Record<string, never>>): string {
  const item = result.content[0]
  assert.equal(item.type, 'text')
  return item.text
}

test('bash 执行简单命令', async () => {
  const tool = createBashTool()
  const result = await tool.execute('bash-echo', { command: 'echo hello' })

  assert.match(firstText(result), /hello/)
})

test('bash 非 0 退出返回错误文本', async () => {
  const tool = createBashTool()
  const result = await tool.execute('bash-fail', {
    command: 'node -e "process.stderr.write(\'fail\'); process.exit(7)"',
  })

  const text = firstText(result)
  assert.match(text, /错误/)
  assert.match(text, /退出码 7/)
  assert.match(text, /fail/)
})

test('bash 超时返回错误文本', async () => {
  const tool = createBashTool({ timeoutMs: 100 })
  const command = process.platform === 'win32'
    ? 'for /L %i in (0,0,1) do @rem'
    : 'while true; do :; done'
  const result = await tool.execute('bash-timeout', { command })

  assert.match(firstText(result), /超时/)
})

test('bash 不继承敏感环境变量', async () => {
  const previous = process.env.LLM_API_KEY
  process.env.LLM_API_KEY = 'should-not-leak'

  try {
    const tool = createBashTool()
    const result = await tool.execute('bash-env', {
      command: 'node -e "console.log(process.env.LLM_API_KEY ?? \'\')"',
    })

    assert.equal(firstText(result).trim(), '')
  } finally {
    if (previous === undefined) {
      delete process.env.LLM_API_KEY
    } else {
      process.env.LLM_API_KEY = previous
    }
  }
})
