import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import {
  completeSimple,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type UserMessage,
} from '@mariozechner/pi-ai'
import { type SessionContentBlock, type SessionEventEntry, extractSessionText } from '@lecquy/shared'
import { createVllmModel } from '../agent/vllm-model.js'
import { resolvePromptContextPaths } from '../core/prompts/context-files.js'
import { formatCompactSummaryFallback } from '../runtime/context/templates/compact-summary.template.js'
import { logger } from '../utils/logger.js'
import type { SessionManager } from '../runtime/pi-session-core/session-manager.js'

// ─── 触发常量 ──────────────────────────────────────────────────────────────────

const COMPACT_TRIGGER_MESSAGE_EVENTS = 50
const COMPACT_RECENT_TAIL = 10

// ─── LLM 摘要相关常量（见文档 9 第 9 节配置项与默认值）──────────────────────────

/** 压缩摘要 LLM 最大输出 token 数 */
const COMPACTION_MAX_OUTPUT_TOKENS = 4_096

/** 序列化历史时工具输出的最大字符数（与 OpenCode 一致）*/
const COMPACTION_TOOL_OUTPUT_MAX_CHARS = 2_000

// ─── 内部类型 ──────────────────────────────────────────────────────────────────

type CompactionCompleteSimple = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => Promise<AssistantMessage>

let completeSimpleForCompaction: CompactionCompleteSimple = (model, context, options) =>
  completeSimple(model, context, options)

interface CompactSource {
  readonly previousSummary?: string
  readonly compactedMessages: SessionEventEntry[]
  readonly firstKeptEntryId: string
}

/** buildCompactSummary 的入参 */
export interface CompactSummaryInput {
  readonly source: CompactSource
  readonly model: string    // model ID，如 "glm-4.7"；来源：bound.projection.model
  readonly apiKey: string   // 来源：cfg.LLM_API_KEY
  readonly timeoutMs: number
}

/** buildCompactSummary 的结果 */
export interface CompactSummaryResult {
  readonly summary: string
  readonly method: 'llm' | 'template'
  readonly llmError?: { name: string; message: string }
}

export function setCompactionCompleteSimpleForTest(
  impl: CompactionCompleteSimple,
): () => void {
  const previous = completeSimpleForCompaction
  completeSimpleForCompaction = impl
  return () => {
    completeSimpleForCompaction = previous
  }
}

// ─── Step 1.1：SUMMARY_INSTRUCTIONS（system prompt，每次不变）────────────────

const SUMMARY_INSTRUCTIONS = `\
按照下方 <template> 内的 Markdown 结构输出，保持章节顺序，不要在回复中输出 <template> 标签。

<template>
## 目标
- [单句总结用户的核心任务]

## 约束与偏好
- [用户明确的约束条件、偏好或规范，无则写"（无）"]

## 进度
### 已完成
- [已完成的工作，无则写"（无）"]
### 进行中
- [当前进行中的工作，无则写"（无）"]
### 受阻
- [当前阻塞点，无则写"（无）"]

## 关键决策
- [已做的重要决策及原因，无则写"（无）"]

## 下一步
- [按优先级排列的后续行动，无则写"（无）"]

## 关键上下文
- [重要技术事实、错误信息、开放问题，无则写"（无）"]

## 相关文件
- [文件或目录路径：与任务的关联原因，无则写"（无）"]
</template>

规则：
- 所有章节必须保留，即使内容为空也写"（无）"。
- 使用简洁的要点，不要写成段落式散文。
- 保留精确的文件路径、命令、错误字符串和标识符。
- 不要提及摘要过程本身，也不要说"上下文已被压缩"之类的话。`

// ─── Step 1.3：history 序列化（文本块方案，↳ 格式）───────────────────────────

function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}... (截断，原长 ${text.length} 字符)`
}

function formatToolOutput(part: Extract<SessionContentBlock, { type: 'toolCall' }>): string {
  const output = part.output?.trim()
  if (output) return truncateText(output, COMPACTION_TOOL_OUTPUT_MAX_CHARS)

  if (part.status === 'error') {
    return `[error] ${truncateText(part.errorMessage ?? '未知错误', COMPACTION_TOOL_OUTPUT_MAX_CHARS)}`
  }

  if (part.status === 'success') return '[已完成]'
  return '[状态未知]'
}

/**
 * 把 compactedMessages 序列化为可读文本块。
 * 工具调用嵌入助手段落，以 ↳ 行形式呈现，不单独成角色（见文档 7 第 4.1 节）。
 * tool_use/tool_result 切口断裂时不抛错（见文档 7 第 5.7 节）。
 */
export function formatHistoryForCompaction(entries: SessionEventEntry[]): string {
  const paragraphs: string[] = []

  for (const entry of entries) {
    if (entry.type !== 'message') continue

    const role = entry.message.role === 'user' ? '用户' : '助手'
    const content = entry.message.content

    // 纯字符串消息
    if (typeof content === 'string') {
      const text = content.trim()
      if (text) paragraphs.push(`[${role}] ${text}`)
      continue
    }

    if (!Array.isArray(content)) continue

    // 数组内容：文本与工具调用组合为一个段落
    const lines: string[] = []
    for (const part of content as SessionContentBlock[]) {
      if (part.type === 'text') {
        const text = part.text.trim()
        if (text) lines.push(text)
      } else if (part.type === 'toolCall') {
        // args 摘要：JSON 序列化后保留前 200 字符
        const argsStr = JSON.stringify(part.arguments).slice(0, 200)
        lines.push(`  ↳ ${part.name}(${argsStr}) → ${formatToolOutput(part)}`)
      }
      // thinking / image / file 类型跳过
    }

    if (lines.length > 0) {
      paragraphs.push(`[${role}] ${lines.join('\n')}`)
    }
  }

  return paragraphs.join('\n\n')
}

const REQUIRED_SUMMARY_SECTIONS = [
  '## 目标',
  '## 约束与偏好',
  '## 进度',
  '## 关键决策',
  '## 下一步',
  '## 关键上下文',
  '## 相关文件',
] as const

function findMissingSummarySections(summary: string): string[] {
  return REQUIRED_SUMMARY_SECTIONS.filter((section) => !summary.includes(section))
}

// ─── Step 1.4：prompt 构建（返回 { system, user }）────────────────────────────

/**
 * 构建传给 compaction LLM 的 prompt。
 * previousSummary 完整传入，不截断（见文档 7 第 4.3 节）。
 */
export function buildCompactionPrompt(input: {
  history: string
  previousSummary?: string
}): { system: string; user: string } {
  const userParts: string[] = []

  userParts.push('以下是需要压缩的对话历史：')
  userParts.push('<conversation-history>')
  userParts.push(input.history)
  userParts.push('</conversation-history>')

  if (input.previousSummary) {
    userParts.push('')
    userParts.push('请在以下锚定摘要的基础上更新：')
    userParts.push('- 把上方对话历史中的新事实合并进来')
    userParts.push('- 删除已被新事实超越或不再成立的内容')
    userParts.push('- 保留仍然成立的细节')
    userParts.push('- 输出仍然按 system prompt 中 SUMMARY_TEMPLATE 的章节结构')
    userParts.push('')
    userParts.push('<previous-summary>')
    userParts.push(input.previousSummary) // 完整传入，不截断
    userParts.push('</previous-summary>')
  } else {
    userParts.push('')
    userParts.push('请根据以上对话历史生成一份新的锚定摘要。')
  }

  return {
    system: SUMMARY_INSTRUCTIONS,
    user: userParts.join('\n'),
  }
}

// ─── Step 1.2：LLM 调用（callCompactionLLM）──────────────────────────────────

/**
 * 调用 completeSimple 生成压缩摘要。
 * 异常时直接 throw，由 buildCompactSummary 统一降级处理。
 */
async function callCompactionLLM(input: CompactSummaryInput): Promise<string> {
  const history = formatHistoryForCompaction(input.source.compactedMessages)
  const prompt = buildCompactionPrompt({
    history,
    previousSummary: input.source.previousSummary,
  })

  // 使用与主对话相同的 vLLM 适配层构建 Model 对象
  const model = createVllmModel({ modelId: input.model })

  const response = await completeSimpleForCompaction(
    model,
    {
      systemPrompt: prompt.system,
      messages: [
        {
          role: 'user',
          content: prompt.user,
          timestamp: Date.now(),
        } satisfies UserMessage,
      ],
    },
    {
      apiKey: input.apiKey,
      signal: AbortSignal.timeout(input.timeoutMs),
      maxTokens: COMPACTION_MAX_OUTPUT_TOKENS,
    },
  )

  // 从 AssistantMessage 提取文本内容
  const text = extractSessionText(response.content)
  return text.trim()
}

// ─── Step 1.5：降级处理（logger.warn + llmError 写入）──────────────────────────

/**
 * 生成压缩摘要。LLM 调用失败时降级到模板方式，不 crash。
 * 降级原因记录在返回的 llmError 字段中（由调用方写入 compaction details）。
 */
export async function buildCompactSummary(input: CompactSummaryInput): Promise<CompactSummaryResult> {
  // 前置校验：model 或 apiKey 缺失直接走降级
  if (!input.model || !input.apiKey) {
    logger.error('[compact] model 或 apiKey 缺失，跳过 LLM 摘要，降级到模板方式', {
      hasModel: Boolean(input.model),
      hasApiKey: Boolean(input.apiKey),
    })
    return {
      summary: formatCompactSummaryFallback({
        previousSummary: input.source.previousSummary,
        compactedMessages: input.source.compactedMessages,
        recentTailCount: COMPACT_RECENT_TAIL,
      }),
      method: 'template',
      llmError: { name: 'ConfigError', message: 'model 或 apiKey 缺失' },
    }
  }

  try {
    const summary = await callCompactionLLM(input)
    const missingSections = findMissingSummarySections(summary)
    if (missingSections.length > 0) {
      logger.warn('[compact] LLM 摘要格式不完整，继续使用原始输出', {
        missingSections,
      })
    }
    return { summary, method: 'llm' }
  } catch (error) {
    logger.warn('[compact] LLM 摘要失败，降级到模板方式', {
      reason: error instanceof Error ? error.name : 'unknown',
      message: error instanceof Error ? error.message : String(error),
    })
    const summary = formatCompactSummaryFallback({
      previousSummary: input.source.previousSummary,
      compactedMessages: input.source.compactedMessages,
      recentTailCount: COMPACT_RECENT_TAIL,
    })
    return {
      summary,
      method: 'template',
      llmError: {
        name: error instanceof Error ? error.name : 'unknown',
        message: error instanceof Error ? error.message : String(error),
      },
    }
  }
}

// ─── 辅助函数（保持原有逻辑）─────────────────────────────────────────────────

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function extractMessageText(entry: SessionEventEntry): string {
  if (entry.type !== 'message') return ''
  return normalizeWhitespace(extractSessionText(entry.message.content))
}

function getDurableMessageEntries(entries: SessionEventEntry[]): SessionEventEntry[] {
  return entries.filter((entry) =>
    entry.type === 'message'
    && (entry.message.role === 'user' || entry.message.role === 'assistant')
    && extractMessageText(entry).length > 0,
  )
}

function findLatestCompaction(entries: SessionEventEntry[]): SessionEventEntry | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.type === 'compaction') {
      return entry
    }
  }
  return null
}

function resolveCompactSource(entries: SessionEventEntry[]): CompactSource | null {
  const messageEntries = getDurableMessageEntries(entries)
  if (messageEntries.length < COMPACT_TRIGGER_MESSAGE_EVENTS) {
    return null
  }

  const latestCompaction = findLatestCompaction(entries)
  let candidateMessages = messageEntries
  let previousSummary: string | undefined

  if (latestCompaction?.type === 'compaction') {
    const startIndex = messageEntries.findIndex((entry) => entry.id === latestCompaction.firstKeptEntryId)
    if (startIndex >= 0) {
      candidateMessages = messageEntries.slice(startIndex)
      previousSummary = latestCompaction.summary
    }
  }

  if (candidateMessages.length < COMPACT_TRIGGER_MESSAGE_EVENTS) {
    return null
  }

  const firstKeptEntry = candidateMessages[candidateMessages.length - COMPACT_RECENT_TAIL]
  if (!firstKeptEntry) {
    return null
  }

  return {
    previousSummary,
    compactedMessages: candidateMessages.slice(0, candidateMessages.length - COMPACT_RECENT_TAIL),
    firstKeptEntryId: firstKeptEntry.id,
  }
}

function estimateTokensBefore(source: CompactSource): number {
  const previous = source.previousSummary ?? ''
  const messageText = source.compactedMessages
    .map((entry) => extractMessageText(entry))
    .filter(Boolean)
    .join('\n')

  return Math.max(1, Math.ceil((previous.length + messageText.length) / 4))
}

async function writeMemorySummary(workspaceDir: string, summary: string): Promise<void> {
  const summaryPath = resolvePromptContextPaths(workspaceDir).memorySummaryFile
  await fs.mkdir(dirname(summaryPath), { recursive: true })
  await fs.writeFile(summaryPath, summary, 'utf8')
}

// ─── Step 1.6：applyCompactionIfNeeded（开放结构 CompactionOptions）───────────

/**
 * 压缩选项（开放结构，Phase 2 可直接扩展不改 schema）。
 * 不暴露 llmClient，由内部根据 model + apiKey 调 completeSimple（见文档 7 第 5.5 节）。
 */
export interface CompactionOptions {
  readonly model: string      // model ID（bound.projection.model，见文档 11 事实 2）
  readonly apiKey: string     // cfg.LLM_API_KEY（见文档 11 事实 3）
  readonly timeoutMs: number  // cfg.COMPACTION_TIMEOUT_MS
  // Phase 2 预留字段：
  readonly estimatedTokens?: number
  readonly modelContextWindow?: number
  readonly thresholdUsed?: number
}

export async function applyCompactionIfNeeded(
  manager: SessionManager,
  options: CompactionOptions,
): Promise<boolean> {
  const source = resolveCompactSource(manager.getEntries())
  if (!source) {
    return false
  }

  // Step 1.5：buildCompactSummary 内含降级逻辑
  const result = await buildCompactSummary({
    source,
    model: options.model,
    apiKey: options.apiKey,
    timeoutMs: options.timeoutMs,
  })

  // Step 1.7：appendCompaction 与 writeMemorySummary 使用同一个 result.summary
  manager.appendCompaction(
    result.summary,
    source.firstKeptEntryId,
    estimateTokensBefore(source),
    {
      trigger: 'message_threshold',
      compaction_method: result.method,
      ...(result.llmError ? { llm_error: result.llmError } : {}),
      kept_message_count: COMPACT_RECENT_TAIL,
      compacted_message_count: source.compactedMessages.length,
      compacted_through_entry_id: source.compactedMessages[source.compactedMessages.length - 1]?.id,
      estimated_tokens_before: options.estimatedTokens,
      model_context_window: options.modelContextWindow,
      threshold_used: options.thresholdUsed,
    },
  )

  await writeMemorySummary(manager.getCwd(), result.summary)

  return true
}
