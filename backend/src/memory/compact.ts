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
import { resolveModelSpec, type ModelContextWindowSource } from '../agent/model-registry.js'
import { resolvePromptContextPaths } from '../core/prompts/context-files.js'
import { formatCompactSummaryFallback } from '../runtime/context/templates/compact-summary.template.js'
import { logger } from '../utils/logger.js'
import type { SessionManager } from '../runtime/pi-session-core/session-manager.js'

// ─── 触发常量 ──────────────────────────────────────────────────────────────────

const COMPACTION_PROMPT_OVERHEAD_TOKENS = 4_000
const COMPACTION_NEXT_INPUT_BUFFER_TOKENS = 2_000
const COMPACTION_DEFAULT_MAX_OUTPUT_TOKENS = 8_192

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
  readonly estimatedTokens?: number
  readonly modelContextWindow?: number
  readonly thresholdUsed?: number
  readonly recentTailBudgetTokens?: number
  readonly recentTailEstimatedTokens?: number
  readonly keptMessageCount?: number
  readonly contextWindowSource?: ModelContextWindowSource
  readonly reservedBreakdown?: {
    readonly output: number
    readonly prompt_overhead: number
    readonly next_input: number
  }
  readonly tailSplitInToolChain?: boolean
  readonly largestSinglePartTokens?: number
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
        recentTailCount: input.source.keptMessageCount ?? 0,
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
      recentTailCount: input.source.keptMessageCount ?? 0,
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

// ─── 辅助函数 ────────────────────────────────────────────────────────────────

interface TokenStats {
  readonly tokens: number
  readonly largestSinglePartTokens: number
}

interface ResolvedCompactionPolicy {
  readonly modelContextWindow: number
  readonly contextWindowSource: ModelContextWindowSource
  readonly outputReserved: number
  readonly promptOverhead: number
  readonly nextInputBuffer: number
  readonly threshold: number
}

interface TailSelection {
  readonly compactedMessages: SessionEventEntry[]
  readonly keptMessages: SessionEventEntry[]
  readonly recentTailEstimatedTokens: number
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function safeJsonTokens(value: unknown): number {
  try {
    return estimateTextTokens(JSON.stringify(value))
  } catch (error) {
    logger.debug('[compact] token estimate skipped non-serializable value', {
      error: error instanceof Error ? error.message : String(error),
    })
    return 0
  }
}

function maxStats(stats: TokenStats[]): TokenStats {
  return stats.reduce<TokenStats>(
    (acc, item) => ({
      tokens: acc.tokens + item.tokens,
      largestSinglePartTokens: Math.max(acc.largestSinglePartTokens, item.largestSinglePartTokens),
    }),
    { tokens: 0, largestSinglePartTokens: 0 },
  )
}

function estimatePartTokenStats(part: unknown): TokenStats {
  if (typeof part === 'string') {
    const tokens = estimateTextTokens(part)
    return { tokens, largestSinglePartTokens: tokens }
  }
  if (!isRecord(part)) {
    return { tokens: 0, largestSinglePartTokens: 0 }
  }

  if (part.type === 'thinking' || part.type === 'image') {
    return { tokens: 0, largestSinglePartTokens: 0 }
  }

  if (part.type === 'text' && typeof part.text === 'string') {
    const tokens = estimateTextTokens(part.text)
    return { tokens, largestSinglePartTokens: tokens }
  }

  if (part.type === 'file' && typeof part.text === 'string') {
    const tokens = estimateTextTokens(part.text)
    return { tokens, largestSinglePartTokens: tokens }
  }

  if (part.type === 'toolCall') {
    const nameTokens = typeof part.name === 'string' ? estimateTextTokens(part.name) : 0
    const argumentTokens = safeJsonTokens(part.arguments ?? {})
    const outputTokens = typeof part.output === 'string' ? estimateTextTokens(part.output) : 0
    const errorTokens = typeof part.errorMessage === 'string' ? estimateTextTokens(part.errorMessage) : 0
    return {
      tokens: nameTokens + argumentTokens + outputTokens + errorTokens,
      largestSinglePartTokens: Math.max(nameTokens, argumentTokens, outputTokens, errorTokens),
    }
  }

  if (typeof part.text === 'string') {
    const tokens = estimateTextTokens(part.text)
    return { tokens, largestSinglePartTokens: tokens }
  }

  const tokens = safeJsonTokens(part)
  return { tokens, largestSinglePartTokens: tokens }
}

function extractMessageText(entry: SessionEventEntry): string {
  if (entry.type !== 'message') return ''
  const content = entry.message.content
  if (typeof content === 'string') return normalizeWhitespace(content)
  if (!Array.isArray(content)) return normalizeWhitespace(extractSessionText(content))

  const parts = content
    .map((part) => {
      if (typeof part === 'string') return part
      if (!isRecord(part)) return ''
      if (part.type === 'text' && typeof part.text === 'string') return part.text
      if (part.type === 'file' && typeof part.text === 'string') return part.text
      if (part.type === 'toolCall') {
        const chunks = [
          typeof part.name === 'string' ? part.name : '',
          JSON.stringify(part.arguments ?? {}),
          typeof part.output === 'string' ? part.output : '',
          typeof part.errorMessage === 'string' ? part.errorMessage : '',
        ]
        return chunks.filter(Boolean).join('\n')
      }
      return ''
    })
    .filter(Boolean)
    .join('\n')

  return normalizeWhitespace(parts)
}

function estimateMessageTokenStats(entry: SessionEventEntry): TokenStats {
  if (entry.type !== 'message') return { tokens: 0, largestSinglePartTokens: 0 }

  const content = entry.message.content
  if (typeof content === 'string') {
    const tokens = estimateTextTokens(content)
    return { tokens, largestSinglePartTokens: tokens }
  }
  if (!Array.isArray(content)) {
    const tokens = safeJsonTokens(content)
    return { tokens, largestSinglePartTokens: tokens }
  }
  return maxStats(content.map((part) => estimatePartTokenStats(part)))
}

export function estimateMessageTokens(entry: SessionEventEntry): number {
  return estimateMessageTokenStats(entry).tokens
}

function estimateSessionTokenStats(
  candidateMessages: SessionEventEntry[],
  previousSummary?: string,
): TokenStats {
  const previousTokens = previousSummary ? estimateTextTokens(previousSummary) : 0
  const messageStats = maxStats(candidateMessages.map((entry) => estimateMessageTokenStats(entry)))
  return {
    tokens: previousTokens + messageStats.tokens,
    largestSinglePartTokens: Math.max(previousTokens, messageStats.largestSinglePartTokens),
  }
}

export function estimateSessionTokens(
  candidateMessages: SessionEventEntry[],
  previousSummary?: string,
): number {
  return estimateSessionTokenStats(candidateMessages, previousSummary).tokens
}

export function getCompactionThreshold(input: {
  readonly modelContextWindow: number
  readonly outputReserved: number
  readonly promptOverhead: number
  readonly nextInputBuffer: number
}): number {
  return Math.max(
    1,
    input.modelContextWindow - input.outputReserved - input.promptOverhead - input.nextInputBuffer,
  )
}

function getRecentTailBudget(usableTokens: number): number {
  return clamp(Math.floor(usableTokens * 0.25), 2_000, 8_000)
}

function resolveCompactionPolicy(options: CompactionOptions): ResolvedCompactionPolicy {
  const spec = resolveModelSpec({
    modelId: options.model,
    explicitContextWindow: options.modelContextWindow,
    explicitMaxTokens: options.maxOutputTokens,
    contextWindowSource: options.contextWindowSource,
    warnOnFallback: true,
  })
  const outputReserved = clamp(
    options.maxOutputTokens ?? spec.maxTokens ?? COMPACTION_DEFAULT_MAX_OUTPUT_TOKENS,
    2_000,
    20_000,
  )
  const promptOverhead = COMPACTION_PROMPT_OVERHEAD_TOKENS
  const nextInputBuffer = COMPACTION_NEXT_INPUT_BUFFER_TOKENS
  return {
    modelContextWindow: spec.contextWindow,
    contextWindowSource: spec.contextWindowSource,
    outputReserved,
    promptOverhead,
    nextInputBuffer,
    threshold: getCompactionThreshold({
      modelContextWindow: spec.contextWindow,
      outputReserved,
      promptOverhead,
      nextInputBuffer,
    }),
  }
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

function selectRecentTail(
  candidateMessages: SessionEventEntry[],
  tailBudgetTokens: number,
): TailSelection | null {
  if (candidateMessages.length === 0) return null

  let tokens = 0
  let firstKeptIndex = candidateMessages.length
  for (let index = candidateMessages.length - 1; index >= 0; index -= 1) {
    const messageTokens = estimateMessageTokens(candidateMessages[index])
    if (firstKeptIndex < candidateMessages.length && tokens + messageTokens > tailBudgetTokens) {
      break
    }
    firstKeptIndex = index
    tokens += messageTokens
  }

  const compactedMessages = candidateMessages.slice(0, firstKeptIndex)
  const keptMessages = candidateMessages.slice(firstKeptIndex)
  if (compactedMessages.length === 0 || keptMessages.length === 0) {
    return null
  }

  return {
    compactedMessages,
    keptMessages,
    recentTailEstimatedTokens: keptMessages.reduce((sum, entry) => sum + estimateMessageTokens(entry), 0),
  }
}

function getToolCallIds(entry: SessionEventEntry | undefined): string[] {
  if (!entry || entry.type !== 'message' || !Array.isArray(entry.message.content)) return []

  return entry.message.content
    .map((part) => {
      if (!isRecord(part) || part.type !== 'toolCall') return undefined
      return typeof part.id === 'string' ? part.id : undefined
    })
    .filter((id): id is string => Boolean(id))
}

function getToolResultId(entry: SessionEventEntry | undefined): string | undefined {
  if (!entry || entry.type !== 'message') return undefined
  const message = entry.message as { toolCallId?: unknown }
  return typeof message.toolCallId === 'string' ? message.toolCallId : undefined
}

function hasPendingToolCall(entry: SessionEventEntry | undefined): boolean {
  if (!entry || entry.type !== 'message' || !Array.isArray(entry.message.content)) return false

  return entry.message.content.some((part) =>
    isRecord(part)
    && part.type === 'toolCall'
    && typeof part.output !== 'string'
    && part.status !== 'success'
    && part.status !== 'error',
  )
}

function detectTailSplitInToolChain(
  compactedMessages: SessionEventEntry[],
  keptMessages: SessionEventEntry[],
): boolean {
  const lastCompacted = compactedMessages.at(-1)
  const firstKept = keptMessages[0]
  const toolCallIds = getToolCallIds(lastCompacted)
  const toolResultId = getToolResultId(firstKept)

  if (toolResultId && toolCallIds.includes(toolResultId)) {
    return true
  }

  return hasPendingToolCall(lastCompacted)
}

function resolveCompactSource(
  entries: SessionEventEntry[],
  policy: ResolvedCompactionPolicy,
): CompactSource | null {
  const messageEntries = getDurableMessageEntries(entries)
  if (messageEntries.length === 0) {
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

  if (candidateMessages.length === 0) {
    return null
  }

  const sessionTokenStats = estimateSessionTokenStats(candidateMessages, previousSummary)
  if (sessionTokenStats.tokens < policy.threshold) {
    return null
  }

  const recentTailBudgetTokens = getRecentTailBudget(policy.threshold)
  const tail = selectRecentTail(candidateMessages, recentTailBudgetTokens)
  const firstKeptEntry = tail?.keptMessages[0]
  if (!tail || !firstKeptEntry) return null

  return {
    previousSummary,
    compactedMessages: tail.compactedMessages,
    firstKeptEntryId: firstKeptEntry.id,
    estimatedTokens: sessionTokenStats.tokens,
    modelContextWindow: policy.modelContextWindow,
    thresholdUsed: policy.threshold,
    recentTailBudgetTokens,
    recentTailEstimatedTokens: tail.recentTailEstimatedTokens,
    keptMessageCount: tail.keptMessages.length,
    contextWindowSource: policy.contextWindowSource,
    reservedBreakdown: {
      output: policy.outputReserved,
      prompt_overhead: policy.promptOverhead,
      next_input: policy.nextInputBuffer,
    },
    tailSplitInToolChain: detectTailSplitInToolChain(tail.compactedMessages, tail.keptMessages),
    largestSinglePartTokens: sessionTokenStats.largestSinglePartTokens,
  }
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
  /** 当前 run 模型规格；传入时视为显式 spec，除非 contextWindowSource 另行指定 */
  readonly estimatedTokens?: number
  readonly modelContextWindow?: number
  readonly maxOutputTokens?: number
  readonly thresholdUsed?: number
  readonly contextWindowSource?: ModelContextWindowSource
}

export async function applyCompactionIfNeeded(
  manager: SessionManager,
  options: CompactionOptions,
): Promise<boolean> {
  const policy = resolveCompactionPolicy(options)
  const source = resolveCompactSource(manager.getEntries(), policy)
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
    source.estimatedTokens ?? options.estimatedTokens ?? 0,
    {
      trigger: 'token_overflow',
      compaction_method: result.method,
      ...(result.llmError ? { llm_error: result.llmError } : {}),
      kept_message_count: source.keptMessageCount,
      compacted_message_count: source.compactedMessages.length,
      compacted_through_entry_id: source.compactedMessages[source.compactedMessages.length - 1]?.id,
      estimated_tokens_before: source.estimatedTokens ?? options.estimatedTokens,
      model_context_window: source.modelContextWindow ?? options.modelContextWindow,
      threshold_used: source.thresholdUsed ?? options.thresholdUsed,
      recent_tail_budget_tokens: source.recentTailBudgetTokens,
      recent_tail_estimated_tokens: source.recentTailEstimatedTokens,
      context_window_source: source.contextWindowSource,
      reserved_breakdown: source.reservedBreakdown,
      tail_split_in_tool_chain: source.tailSplitInToolChain,
      largest_single_part_tokens: source.largestSinglePartTokens,
    },
  )

  await writeMemorySummary(manager.getCwd(), result.summary)

  return true
}
