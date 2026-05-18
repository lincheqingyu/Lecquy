// 中文：本文件（compact.test.ts）位于 backend/src/memory/compact.test.ts，属于backend链路中的测试用例代码，连接上游调用方与下游执行逻辑。
// English: This file (compact.test.ts) belongs to the backend 测试用例 layer in backend/src/memory/compact.test.ts, wiring upstream callers with downstream runtime logic.

import test, { describe, mock } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import type { AssistantMessage } from '@mariozechner/pi-ai'
import type { SessionEventEntry } from '@lecquy/shared'
import { loadConfig } from '../config/index.js'
import { SessionManager } from '../runtime/pi-session-core/session-manager.js'
import { formatCompactionContextMessage } from '../runtime/context/templates/compact-summary.template.js'
import {
  applyCompactionIfNeeded,
  buildCompactionPrompt,
  buildCompactSummary,
  formatHistoryForCompaction,
  setCompactionCompleteSimpleForTest,
} from './compact.js'

// ─── 辅助函数 ──────────────────────────────────────────────────────────────────

process.env.LLM_API_KEY ??= 'test-key'
loadConfig()

type CompleteSimpleMock = Parameters<typeof setCompactionCompleteSimpleForTest>[0]

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

/** 构造短文本消息，验证 token-aware 策略不会按条数过早触发 */
function fillMessages(manager: SessionManager, count = 50): void {
  for (let index = 0; index < count; index += 1) {
    manager.appendMessage({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `message ${index + 1}`,
      timestamp: Date.now() + index,
      provider: 'openai',
      model: 'glm-4.7',
    })
  }
}

function fillLargeMessages(manager: SessionManager, count = 12, charsPerMessage = 48_000): void {
  for (let index = 0; index < count; index += 1) {
    manager.appendMessage({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `large message ${index + 1}\n${'x'.repeat(charsPerMessage)}`,
      timestamp: Date.now() + index,
      provider: 'openai',
      model: 'glm-4.7',
    })
  }
}

/**
 * 默认的压缩选项。LLM 行为由 setCompactionCompleteSimpleForTest 控制。
 */
const FALLBACK_OPTIONS = {
  model: 'test-model',
  apiKey: 'test-key',
  timeoutMs: 3_000,
  modelContextWindow: 128_000,
  maxOutputTokens: 4_096,
  contextWindowSource: 'spec' as const,
}

function createAssistantText(text: string): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
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
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

function createValidSummary(lines: string[] = ['- 测试任务']): string {
  return [
    '## 目标',
    ...lines,
    '',
    '## 约束与偏好',
    '- （无）',
    '',
    '## 进度',
    '### 已完成',
    '- 已完成测试',
    '### 进行中',
    '- （无）',
    '### 受阻',
    '- （无）',
    '',
    '## 关键决策',
    '- （无）',
    '',
    '## 下一步',
    '- （无）',
    '',
    '## 关键上下文',
    '- （无）',
    '',
    '## 相关文件',
    '- backend/src/memory/compact.ts：测试目标',
  ].join('\n')
}

// ─── 原有集成测试（适配新签名）──────────────────────────────────────────────────

test('applyCompactionIfNeeded does not compact short-message long conversations below token threshold', async () => {
  const workspaceDir = await createWorkspace()

  try {
    const manager = createManager(workspaceDir)
    fillMessages(manager, 100)

    assert.equal(await applyCompactionIfNeeded(manager, FALLBACK_OPTIONS), false)
    assert.equal(manager.getEntries().some((entry) => entry.type === 'compaction'), false)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('applyCompactionIfNeeded appends compaction and keeps recent tail in context', async () => {
  const workspaceDir = await createWorkspace()

  try {
    const manager = createManager(workspaceDir)
    fillLargeMessages(manager, 12, 48_000)

    const completeImpl: CompleteSimpleMock = async () => {
      throw new Error('mock compaction failure')
    }
    const completeMock = mock.fn(completeImpl)
    const restore = setCompactionCompleteSimpleForTest(completeMock)

    try {
      assert.equal(await applyCompactionIfNeeded(manager, FALLBACK_OPTIONS), true)
    } finally {
      restore()
    }

    const compaction = manager.getEntries().find((entry) => entry.type === 'compaction')
    assert.ok(compaction, '应存在 compaction entry')

    // Step 1.7 验证：writeMemorySummary 与 compaction entry 同源
    const summaryPath = path.join(workspaceDir, '.lecquy', 'MEMORY.summary.md')
    const persistedSummary = await readFile(summaryPath, 'utf8')
    assert.equal(persistedSummary, compaction?.type === 'compaction' ? compaction.summary : '')

    // 上下文验证：token budget 约保留 1 条超长 recent tail + 1 条摘要消息
    const context = manager.buildSessionContext()
    const texts = context.messages.map((message) => {
      if (typeof message.content === 'string') return message.content
      return message.content
        .map((part) => ('text' in part ? part.text : ''))
        .join('\n')
    })

    assert.equal(texts[0] ?? '', formatCompactionContextMessage(compaction?.type === 'compaction' ? compaction.summary : ''))
    assert.equal(texts.length, 2)
    assert.match(texts[1] ?? '', /large message 12/)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('applyCompactionIfNeeded writes compaction_method to details', async () => {
  const workspaceDir = await createWorkspace()

  try {
    const manager = createManager(workspaceDir)
    fillLargeMessages(manager, 12, 48_000)

    const completeImpl: CompleteSimpleMock = async () => {
      throw new Error('mock compaction failure')
    }
    const completeMock = mock.fn(completeImpl)
    const restore = setCompactionCompleteSimpleForTest(completeMock)

    try {
      await applyCompactionIfNeeded(manager, {
        ...FALLBACK_OPTIONS,
        modelContextWindow: 128_000,
        maxOutputTokens: 4_096,
      })
    } finally {
      restore()
    }

    const compaction = manager.getEntries().find((entry) => entry.type === 'compaction')
    assert.ok(compaction?.type === 'compaction', '应存在 compaction entry')
    const details = compaction.details as Record<string, unknown>
    assert.equal(details.compaction_method, 'template')
    assert.equal(details.trigger, 'token_overflow')
    assert.equal(typeof details.estimated_tokens_before, 'number')
    assert.equal(details.model_context_window, 128_000)
    assert.equal(details.threshold_used, 117_904)
    assert.equal(details.context_window_source, 'spec')
    assert.deepEqual(details.reserved_breakdown, {
      output: 4_096,
      prompt_overhead: 4_000,
      next_input: 2_000,
    })
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('applyCompactionIfNeeded threshold follows model context window', async () => {
  const workspace32k = await createWorkspace()
  const workspace200k = await createWorkspace()

  const completeImpl: CompleteSimpleMock = async () => {
    throw new Error('mock compaction failure')
  }
  const completeMock = mock.fn(completeImpl)
  const restore = setCompactionCompleteSimpleForTest(completeMock)

  try {
    const manager32k = createManager(workspace32k)
    fillLargeMessages(manager32k, 6, 30_000)
    assert.equal(await applyCompactionIfNeeded(manager32k, {
      ...FALLBACK_OPTIONS,
      modelContextWindow: 32_000,
      maxOutputTokens: 4_096,
    }), true)

    const manager200k = createManager(workspace200k)
    fillLargeMessages(manager200k, 6, 30_000)
    assert.equal(await applyCompactionIfNeeded(manager200k, {
      ...FALLBACK_OPTIONS,
      modelContextWindow: 200_000,
      maxOutputTokens: 8_192,
    }), false)
  } finally {
    restore()
    await rm(workspace32k, { recursive: true, force: true })
    await rm(workspace200k, { recursive: true, force: true })
  }
})

test('applyCompactionIfNeeded does not immediately repeat after latest compaction', async () => {
  const workspaceDir = await createWorkspace()

  try {
    const manager = createManager(workspaceDir)
    fillLargeMessages(manager, 12, 48_000)

    const completeImpl: CompleteSimpleMock = async () => {
      throw new Error('mock compaction failure')
    }
    const completeMock = mock.fn(completeImpl)
    const restore = setCompactionCompleteSimpleForTest(completeMock)

    try {
      assert.equal(await applyCompactionIfNeeded(manager, FALLBACK_OPTIONS), true)
      assert.equal(await applyCompactionIfNeeded(manager, FALLBACK_OPTIONS), false)
    } finally {
      restore()
    }
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('applyCompactionIfNeeded records largest tool output tokens and tail split detection', async () => {
  const workspaceDir = await createWorkspace()

  try {
    const manager = createManager(workspaceDir)
    manager.appendMessage({
      role: 'user',
      content: 'x'.repeat(120_000),
      timestamp: 1,
    })
    manager.appendMessage({
      role: 'assistant',
      content: [{
        type: 'toolCall',
        id: 'call-pending',
        name: 'read_file',
        arguments: { path: 'large.txt' },
      }],
      timestamp: 2,
    })
    manager.appendMessage({
      role: 'user',
      content: 'z'.repeat(48_000),
      timestamp: 3,
    })

    const completeImpl: CompleteSimpleMock = async () => {
      throw new Error('mock compaction failure')
    }
    const completeMock = mock.fn(completeImpl)
    const restore = setCompactionCompleteSimpleForTest(completeMock)

    try {
      assert.equal(await applyCompactionIfNeeded(manager, {
        ...FALLBACK_OPTIONS,
        modelContextWindow: 32_000,
      }), true)
    } finally {
      restore()
    }

    const compaction = manager.getEntries().find((entry) => entry.type === 'compaction')
    assert.ok(compaction?.type === 'compaction', '应存在 compaction entry')
    const details = compaction.details as Record<string, unknown>
    assert.equal(details.tail_split_in_tool_chain, true)
    assert.equal(details.largest_single_part_tokens, 30_000)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

test('applyCompactionIfNeeded passes previous summary for multi-round fact iteration', async () => {
  const workspaceDir = await createWorkspace()

  try {
    const manager = createManager(workspaceDir)
    fillLargeMessages(manager, 12, 48_000)

    const completeImpl: CompleteSimpleMock = async (_model, context) => {
      const firstMessage = context.messages[0]
      const prompt = firstMessage && firstMessage.role === 'user' && typeof firstMessage.content === 'string'
        ? firstMessage.content
        : ''

      if (prompt.includes('<previous-summary>')) {
        assert.ok(prompt.includes('phase-one-summary'), '第二轮 prompt 应包含上一轮摘要')
        return createAssistantText(createValidSummary(['- phase-one-summary', '- phase-two-summary']))
      }

      return createAssistantText(createValidSummary(['- phase-one-summary']))
    }
    const completeMock = mock.fn(completeImpl)
    const restore = setCompactionCompleteSimpleForTest(completeMock)

    try {
      assert.equal(await applyCompactionIfNeeded(manager, FALLBACK_OPTIONS), true)

      for (let index = 0; index < 12; index += 1) {
        manager.appendMessage({
          role: index % 2 === 0 ? 'user' : 'assistant',
          content: `phase-two message ${index + 1}\n${'y'.repeat(48_000)}`,
          timestamp: Date.now() + index,
        })
      }

      assert.equal(await applyCompactionIfNeeded(manager, FALLBACK_OPTIONS), true)
    } finally {
      restore()
    }

    const compactions = manager.getEntries().filter((entry) => entry.type === 'compaction')
    const latest = compactions.at(-1)
    assert.ok(latest?.type === 'compaction', '应存在第二轮 compaction entry')
    assert.ok(latest.summary.includes('phase-one-summary'), '第二轮摘要应保留第一轮事实')
    assert.ok(latest.summary.includes('phase-two-summary'), '第二轮摘要应合并第二轮事实')
    assert.equal(completeMock.mock.callCount(), 2)
  } finally {
    await rm(workspaceDir, { recursive: true, force: true })
  }
})

// ─── buildCompactSummary：配置缺失降级 ───────────────────────────────────────

describe('buildCompactSummary 配置缺失降级', () => {
  // 构造一个最小 CompactSource（不依赖真实 SessionManager）
  function makeSource(): Parameters<typeof buildCompactSummary>[0]['source'] {
    return {
      previousSummary: undefined,
      compactedMessages: [],
      firstKeptEntryId: 'entry-0',
    }
  }

  test('model 为空时降级到模板方式，方法标记为 template', async () => {
    const result = await buildCompactSummary({
      source: makeSource(),
      model: '',
      apiKey: 'some-key',
      timeoutMs: 5_000,
    })
    assert.equal(result.method, 'template')
    assert.ok(result.llmError, '应有 llmError 字段')
    assert.equal(result.llmError?.name, 'ConfigError')
  })

  test('apiKey 为空时降级到模板方式，方法标记为 template', async () => {
    const result = await buildCompactSummary({
      source: makeSource(),
      model: 'test-model',
      apiKey: '',
      timeoutMs: 5_000,
    })
    assert.equal(result.method, 'template')
    assert.ok(result.llmError, '应有 llmError 字段')
    assert.equal(result.llmError?.name, 'ConfigError')
  })
})

// ─── buildCompactSummary：可控 LLM mock ──────────────────────────────────────

describe('buildCompactSummary LLM 路径', () => {
  function makeSource(previousSummary?: string): Parameters<typeof buildCompactSummary>[0]['source'] {
    return {
      previousSummary,
      compactedMessages: [
        {
          id: 'e1',
          type: 'message',
          message: { role: 'user', content: '请实现 compact', timestamp: 1 },
        } as SessionEventEntry,
      ],
      firstKeptEntryId: 'entry-0',
    }
  }

  test('LLM 返回合法摘要时使用 LLM 结果', async () => {
    const summary = createValidSummary(['- LLM 成功路径'])
    const completeImpl: CompleteSimpleMock = async () => createAssistantText(summary)
    const completeMock = mock.fn(completeImpl)
    const restore = setCompactionCompleteSimpleForTest(completeMock)

    try {
      const result = await buildCompactSummary({
        source: makeSource(),
        model: 'test-model',
        apiKey: 'test-key',
        timeoutMs: 5_000,
      })

      assert.equal(result.method, 'llm')
      assert.equal(result.summary, summary)
      assert.equal(result.llmError, undefined)
      assert.equal(completeMock.mock.callCount(), 1)
    } finally {
      restore()
    }
  })

  test('previousSummary 通过 buildCompactSummary 完整传入 completeSimple', async () => {
    const longSummary = '## 目标\n- 历史目标\n\n## 关键上下文\n- 重要信息\n'.repeat(80)
    let capturedPrompt = ''
    const completeImpl: CompleteSimpleMock = async (_model, context) => {
      const firstMessage = context.messages[0]
      capturedPrompt = firstMessage && firstMessage.role === 'user' && typeof firstMessage.content === 'string'
        ? firstMessage.content
        : ''
      return createAssistantText(createValidSummary(['- 合并旧摘要']))
    }
    const completeMock = mock.fn(completeImpl)
    const restore = setCompactionCompleteSimpleForTest(completeMock)

    try {
      await buildCompactSummary({
        source: makeSource(longSummary),
        model: 'test-model',
        apiKey: 'test-key',
        timeoutMs: 5_000,
      })

      assert.ok(capturedPrompt.includes(longSummary.slice(-100)), 'previousSummary 尾段应完整传入 LLM prompt')
      assert.ok(capturedPrompt.includes('<previous-summary>'), '应使用独立 previous-summary XML 块')
      assert.ok(capturedPrompt.includes('把上方对话历史中的新事实合并进来'), '应包含显式合并指令')
    } finally {
      restore()
    }
  })

  test('LLM 调用超时时走模板降级并记录 TimeoutError', async () => {
    const completeImpl: CompleteSimpleMock = async (_model, _context, options) => {
      await new Promise((_resolve, reject) => {
        const keepAlive = setTimeout(() => {
          reject(new Error('mock timeout signal did not abort'))
        }, 1_000)
        options?.signal?.addEventListener('abort', () => {
          clearTimeout(keepAlive)
          reject(options.signal?.reason ?? new Error('TimeoutError'))
        }, { once: true })
      })
      return createAssistantText(createValidSummary())
    }
    const completeMock = mock.fn(completeImpl)
    const restore = setCompactionCompleteSimpleForTest(completeMock)

    try {
      const result = await buildCompactSummary({
        source: makeSource(),
        model: 'test-model',
        apiKey: 'test-key',
        timeoutMs: 20,
      })

      assert.equal(result.method, 'template')
      assert.ok(result.llmError, '超时降级应记录 llmError')
      assert.ok(['AbortError', 'TimeoutError'].includes(result.llmError?.name ?? ''), '应记录 abort/timeout 错误名')
    } finally {
      restore()
    }
  })

  test('LLM 返回非法格式时软校验，不重试也不降级', async () => {
    const completeImpl: CompleteSimpleMock = async () => createAssistantText('只有一行，没有模板章节')
    const completeMock = mock.fn(completeImpl)
    const restore = setCompactionCompleteSimpleForTest(completeMock)

    try {
      const result = await buildCompactSummary({
        source: makeSource(),
        model: 'test-model',
        apiKey: 'test-key',
        timeoutMs: 5_000,
      })

      assert.equal(result.method, 'llm')
      assert.equal(result.summary, '只有一行，没有模板章节')
      assert.equal(completeMock.mock.callCount(), 1)
    } finally {
      restore()
    }
  })
})

// ─── buildCompactionPrompt：previousSummary 完整传入 ─────────────────────────

describe('buildCompactionPrompt', () => {
  test('无 previousSummary 时 user prompt 包含生成新摘要指令', () => {
    const result = buildCompactionPrompt({ history: '历史内容' })
    assert.ok(result.system.length > 0, 'system prompt 不为空')
    assert.ok(result.user.includes('生成一份新的锚定摘要'), 'user prompt 包含新摘要指令')
    assert.ok(result.user.includes('历史内容'), 'user prompt 包含 history 内容')
  })

  test('有 previousSummary 时完整传入不截断', () => {
    // 构造 > 1k 字符的 previousSummary
    const longSummary = '## 目标\n- 测试任务\n\n## 关键上下文\n- 重要信息\n'.repeat(60) // ~1800 字符
    const result = buildCompactionPrompt({ history: '新历史', previousSummary: longSummary })

    // 验证 user prompt 包含 previousSummary 的尾段（确认未被截断）
    const tail = longSummary.slice(-100)
    assert.ok(result.user.includes(tail), 'previousSummary 尾段应完整出现在 user prompt 中')

    // 验证包含合并指令
    assert.ok(result.user.includes('把上方对话历史中的新事实合并进来'), 'user prompt 包含合并指令')
    assert.ok(result.user.includes('<previous-summary>'), '包含 previous-summary 标签')
  })

  test('system prompt 包含 SUMMARY_TEMPLATE 的所有章节', () => {
    const result = buildCompactionPrompt({ history: 'test' })
    for (const section of ['## 目标', '## 约束与偏好', '## 进度', '## 关键决策', '## 下一步', '## 关键上下文', '## 相关文件']) {
      assert.ok(result.system.includes(section), `system prompt 缺少章节：${section}`)
    }
  })
})

// ─── formatHistoryForCompaction：序列化格式验证 ───────────────────────────────

describe('formatHistoryForCompaction', () => {
  test('纯文本消息正确格式化', () => {
    const entries: SessionEventEntry[] = [
      {
        id: 'e1',
        type: 'message',
        message: { role: 'user', content: '你好', timestamp: 1 },
      } as SessionEventEntry,
      {
        id: 'e2',
        type: 'message',
        message: { role: 'assistant', content: '你好，有什么可以帮你的？', timestamp: 2 },
      } as SessionEventEntry,
    ]

    const result = formatHistoryForCompaction(entries)
    assert.ok(result.includes('[用户] 你好'), '包含用户消息')
    assert.ok(result.includes('[助手] 你好，有什么可以帮你的？'), '包含助手消息')
  })

  test('toolCall 嵌入助手段落，以 ↳ 行呈现', () => {
    const entries: SessionEventEntry[] = [
      {
        id: 'e1',
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: '我来读取文件。' },
            {
              type: 'toolCall',
              id: 'call-1',
              name: 'read_file',
              arguments: { path: 'src/index.ts' },
              status: 'success',
            },
          ],
          timestamp: 1,
        },
      } as unknown as SessionEventEntry,
    ]

    const result = formatHistoryForCompaction(entries)
    assert.ok(result.includes('[助手]'), '包含助手角色')
    assert.ok(result.includes('↳ read_file('), '工具调用以 ↳ 形式嵌入')
    assert.ok(result.includes('→ [已完成]'), '包含工具状态')
    // 工具调用不应单独成为独立角色行
    assert.ok(!result.includes('\n[read_file]'), '工具调用不单独成角色行')
  })

  test('toolCall output 写入 ↳ 行并截断到 2000 字符', () => {
    const longOutput = `${'a'.repeat(2_100)}TAIL`
    const entries: SessionEventEntry[] = [
      {
        id: 'e1',
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: '我来读取文件。' },
            {
              type: 'toolCall',
              id: 'call-1',
              name: 'read_file',
              arguments: { path: 'src/index.ts' },
              status: 'success',
              output: longOutput,
            },
          ],
          timestamp: 1,
        },
      } as unknown as SessionEventEntry,
    ]

    const result = formatHistoryForCompaction(entries)
    assert.ok(result.includes(`→ ${'a'.repeat(2_000)}`), '工具输出应保留前 2000 字符')
    assert.ok(result.includes('截断，原长 2104 字符'), '工具输出应标记截断')
    assert.ok(!result.includes('TAIL'), '2000 字符后的尾段不应进入 compaction history')
  })

  test('tool_use/tool_result 切口断裂场景不抛错', () => {
    // 模拟切口刚好把工具调用和结果分在两端的情况
    // 这里构造只有 toolCall 无后续 tool_result 的孤立 toolCall
    const entries: SessionEventEntry[] = [
      {
        id: 'e1',
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            {
              type: 'toolCall',
              id: 'orphan-call',
              name: 'edit_file',
              arguments: { path: 'src/foo.ts', old: 'a', new: 'b' },
              // status 未回填（模拟孤立断裂）
            },
          ],
          timestamp: 1,
        },
      } as unknown as SessionEventEntry,
    ]

    // 不抛错
    assert.doesNotThrow(() => formatHistoryForCompaction(entries))
    const result = formatHistoryForCompaction(entries)
    assert.ok(result.includes('↳ edit_file('), '孤立 toolCall 仍以 ↳ 行呈现')
  })

  test('thinking / image / file 类型被跳过', () => {
    const entries: SessionEventEntry[] = [
      {
        id: 'e1',
        type: 'message',
        message: {
          role: 'assistant',
          content: [
            { type: 'thinking', thinking: '内部思考内容，不应出现' },
            { type: 'text', text: '最终回复内容' },
          ],
          timestamp: 1,
        },
      } as unknown as SessionEventEntry,
    ]

    const result = formatHistoryForCompaction(entries)
    assert.ok(!result.includes('内部思考内容'), 'thinking 内容被跳过')
    assert.ok(result.includes('最终回复内容'), '文本内容保留')
  })

  test('非 message 类型的 entry 被跳过', () => {
    const entries: SessionEventEntry[] = [
      {
        id: 'c1',
        type: 'compaction',
        summary: '这是 compaction entry，不应出现',
        firstKeptEntryId: 'e1',
        estimatedTokensBefore: 100,
      } as unknown as SessionEventEntry,
      {
        id: 'e2',
        type: 'message',
        message: { role: 'user', content: '正常消息', timestamp: 1 },
      } as SessionEventEntry,
    ]

    const result = formatHistoryForCompaction(entries)
    assert.ok(!result.includes('这是 compaction entry'), 'compaction entry 被跳过')
    assert.ok(result.includes('[用户] 正常消息'), '正常消息保留')
  })
})

// ─── LLM 任意异常均触发降级 ──────────────────────────────────────────────────

test('buildCompactSummary LLM 调用失败时降级到模板方式并记录 llmError', async () => {
  const completeImpl: CompleteSimpleMock = async () => {
    throw new Error('mock llm failure')
  }
  const completeMock = mock.fn(completeImpl)
  const restore = setCompactionCompleteSimpleForTest(completeMock)

  try {
    const result = await buildCompactSummary({
      source: {
        previousSummary: undefined,
        compactedMessages: [],
        firstKeptEntryId: 'e0',
      },
      model: 'test-model',
      apiKey: 'test-key',
      timeoutMs: 1_000,
    })

    assert.equal(result.method, 'template', 'LLM 失败后应降级到模板方式')
    assert.ok(result.llmError, '应记录 llmError 字段')
    assert.equal(result.llmError?.message, 'mock llm failure')
  } finally {
    restore()
  }
})
