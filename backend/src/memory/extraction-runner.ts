import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { getConfig } from '../config/index.js'
import { logger } from '../utils/logger.js'
import type {
  EventExtractionDiagnostics,
  EventExtractionExecution,
  EventExtractionInput,
  ExtractedEventCandidate,
  ExtractedEventType,
  MemoryItemInsert,
} from './types.js'

const MAX_EVENTS = 3
const MAX_SUMMARY_LENGTH = 80
const MAX_CONTENT_LENGTH = 200

const extractionOutputSchema = z.object({
  events: z.array(z.object({
    summary: z.string().min(1),
    content: z.string().min(1),
    event_type: z.enum([
      'user_fact',
      'assistant_commitment',
      'tool_action',
      'decision',
      'observation',
    ]),
    tags: z.array(z.string()).default([]),
    importance: z.number().min(1).max(10),
    occurred_at: z.string(),
    source_message_ids: z.array(z.string()).default([]),
  })).max(MAX_EVENTS).default([]),
})

interface ChatCompletionsResponse {
  readonly choices?: Array<{
    readonly message?: {
      readonly content?: string | Array<{ readonly type?: string; readonly text?: string }>
    }
  }>
}

function buildChatCompletionsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (
    normalized.endsWith('/v1')
    || normalized.endsWith('/api/paas/v4')
  ) {
    return `${normalized}/chat/completions`
  }
  return `${normalized}/v1/chat/completions`
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, maxLength - 3)}...`
}

function isTrivialText(text: string): boolean {
  const normalized = normalizeWhitespace(text).toLowerCase()
  if (!normalized) return true
  if (normalized.length <= 6) return true
  return [
    '你好',
    '您好',
    '谢谢',
    '好的',
    'ok',
    'okay',
    '收到',
    'hi',
    'hello',
  ].includes(normalized)
}

function extractContentText(content: string | Array<{ readonly type?: string; readonly text?: string }> | undefined): string {
  if (typeof content === 'string') {
    return content
  }
  if (!Array.isArray(content)) {
    return ''
  }
  return content
    .map((part) => (part?.type === 'text' && typeof part.text === 'string' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
}

function extractJsonCandidate(raw: string): string {
  const trimmed = raw.trim()
  if (!trimmed) return ''

  const fenced = trimmed.match(/```json\s*([\s\S]*?)```/i)
  if (fenced?.[1]) {
    return fenced[1].trim()
  }

  const objectMatch = trimmed.match(/\{[\s\S]*\}/)
  if (objectMatch?.[0]) {
    return objectMatch[0]
  }

  return trimmed
}

function clampImportance(value: number): number {
  return Math.max(1, Math.min(10, Math.round(value)))
}

function sanitizeTags(tags: string[]): string[] {
  const unique = new Set<string>()

  for (const tag of tags) {
    const normalized = normalizeWhitespace(tag)
    if (!normalized) continue
    if (normalized.length > 24) continue
    unique.add(normalized)
    if (unique.size >= 5) break
  }

  return [...unique]
}

function extractKeywordTags(text: string): string[] {
  const normalized = text
    .replace(/[^\p{L}\p{N}_\- ]+/gu, ' ')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2)

  const unique = new Set<string>()
  for (const token of normalized) {
    unique.add(token)
    if (unique.size >= 5) break
  }

  return [...unique]
}

function chooseOccurredAt(input: EventExtractionInput, sourceEventIds: string[]): string {
  for (const sourceEventId of sourceEventIds) {
    const match = input.messages.find((message) => message.eventId === sourceEventId)
    if (match) return match.timestamp
  }
  return input.messages[input.messages.length - 1]?.timestamp ?? new Date().toISOString()
}

function createHeuristicCandidates(input: EventExtractionInput): ExtractedEventCandidate[] {
  const candidates: ExtractedEventCandidate[] = []
  const lastUser = [...input.messages].reverse().find((message) => message.role === 'user' && !isTrivialText(message.text))
  const lastAssistant = [...input.messages].reverse().find((message) => message.role === 'assistant' && !isTrivialText(message.text))

  if (lastUser) {
    const eventType: ExtractedEventType = /决定|确定|改成|采用|先做|后续|接下来|计划|方案|路线/.test(lastUser.text)
      ? 'decision'
      : 'user_fact'
    candidates.push({
      summary: truncate(normalizeWhitespace(lastUser.text), MAX_SUMMARY_LENGTH),
      content: truncate(lastUser.text.trim(), MAX_CONTENT_LENGTH),
      eventType,
      tags: sanitizeTags(extractKeywordTags(lastUser.text)),
      importance: /数据库|记忆|agent|runtime|PostgreSQL|RAG|compact/i.test(lastUser.text) ? 7 : 5,
      confidence: 0.45,
      occurredAt: lastUser.timestamp,
      sourceEventIds: [lastUser.eventId],
    })
  }

  if (lastAssistant && /我会|将|已|已经|完成|改为|接入|新增|创建|实现/.test(lastAssistant.text)) {
    candidates.push({
      summary: truncate(normalizeWhitespace(lastAssistant.text), MAX_SUMMARY_LENGTH),
      content: truncate(lastAssistant.text.trim(), MAX_CONTENT_LENGTH),
      eventType: /完成|已|已经|创建|接入|实现/.test(lastAssistant.text)
        ? 'observation'
        : 'assistant_commitment',
      tags: sanitizeTags(extractKeywordTags(lastAssistant.text)),
      importance: 5,
      confidence: 0.4,
      occurredAt: lastAssistant.timestamp,
      sourceEventIds: [lastAssistant.eventId],
    })
  }

  return candidates.slice(0, MAX_EVENTS)
}

function normalizeExtractedEvents(input: EventExtractionInput, rawEvents: z.infer<typeof extractionOutputSchema>['events']): ExtractedEventCandidate[] {
  const availableEventIds = new Set(input.messages.map((message) => message.eventId))

  return rawEvents.map((event) => {
    const sourceEventIds = event.source_message_ids.filter((eventId) => availableEventIds.has(eventId))
    return {
      summary: truncate(normalizeWhitespace(event.summary), MAX_SUMMARY_LENGTH),
      content: truncate(event.content.trim(), MAX_CONTENT_LENGTH),
      eventType: event.event_type,
      tags: sanitizeTags(event.tags),
      importance: clampImportance(event.importance),
      confidence: 0.8,
      occurredAt: chooseOccurredAt(input, sourceEventIds),
      sourceEventIds: sourceEventIds.length > 0
        ? sourceEventIds
        : input.messages.map((message) => message.eventId),
    }
  }).filter((event) => event.summary && event.content)
}

function buildExtractionPrompt(input: EventExtractionInput, strictnessHint?: string): string {
  const messagesText = input.messages
    .map((message) => `[${message.role}] (${message.eventId}) ${message.text}`)
    .join('\n')

  return [
    '你是一个记忆提取器。请从以下对话片段中提取值得长期记住的原子事实。',
    '',
    '规则：',
    '1. 只提取明确、可核查的事实，不要提取模糊推测。',
    '2. 每个事实必须独立可理解，不依赖上下文。',
    '3. 事实类型包括：user_fact、assistant_commitment、tool_action、decision、observation。',
    '4. 每个事实给 1-5 个中英文关键词标签。',
    '5. importance 取值 1-10。',
    '6. 如果没有值得提取的事实，返回空数组。',
    '7. 请输出严格 JSON，不要输出 markdown、解释或额外文本。',
    strictnessHint ?? '',
    '',
    `会话标题：${input.sessionContext.title ?? '未命名会话'}`,
    `会话模式：${input.sessionContext.mode}`,
    '',
    '对话片段：',
    '---',
    messagesText,
    '---',
    '',
    '输出 JSON 结构：',
    '{"events":[{"summary":"...","content":"...","event_type":"user_fact","tags":["..."],"importance":7,"occurred_at":"ISO","source_message_ids":["evt_xxx"]}]}',
  ]
    .filter(Boolean)
    .join('\n')
}

async function requestLlmExtraction(input: EventExtractionInput, prompt: string): Promise<string> {
  const config = getConfig()
  const target = buildChatCompletionsUrl(config.LLM_BASE_URL)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (config.LLM_API_KEY.trim()) {
    headers.Authorization = `Bearer ${config.LLM_API_KEY.trim()}`
  }

  const response = await fetch(target, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.LLM_MODEL,
      stream: false,
      temperature: 0,
      max_tokens: 1200,
      messages: [
        {
          role: 'system',
          content: '你是一个只输出 JSON 的记忆提取器。',
        },
        {
          role: 'user',
          content: prompt,
        },
      ],
    }),
    signal: AbortSignal.timeout(config.LLM_TIMEOUT),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(`event extraction 上游请求失败: ${response.status} ${text}`)
  }

  const json = await response.json() as ChatCompletionsResponse
  const raw = extractContentText(json.choices?.[0]?.message?.content)
  if (!raw.trim()) {
    throw new Error('event extraction 返回空内容')
  }
  return raw
}

async function tryLlmExtraction(input: EventExtractionInput): Promise<{
  candidates: ExtractedEventCandidate[] | null
  diagnostics: Pick<EventExtractionDiagnostics, 'fallbackReason' | 'llmAttemptCount'>
}> {
  const hints = [
    '',
    '请再次检查：输出必须是合法 JSON，不能包含 ```json 代码块。',
    '如果你不确定，请只输出一个最重要的 event，并保持严格 JSON。',
  ]
  let fallbackReason: string | undefined

  for (const [index, hint] of hints.entries()) {
    try {
      const raw = await requestLlmExtraction(input, buildExtractionPrompt(input, hint))
      const jsonCandidate = extractJsonCandidate(raw)
      const parsed = extractionOutputSchema.parse(JSON.parse(jsonCandidate))
      return {
        candidates: normalizeExtractedEvents(input, parsed.events),
        diagnostics: {
          llmAttemptCount: index + 1,
        },
      }
    } catch (error) {
      fallbackReason = error instanceof Error ? error.message : String(error)
      logger.warn('event extraction LLM 尝试失败，准备回退或重试', {
        sessionId: input.sessionContext.sessionId,
        error: fallbackReason,
      })
    }
  }

  return {
    candidates: null,
    diagnostics: {
      fallbackReason,
      llmAttemptCount: hints.length,
    },
  }
}

function mapCandidatesToMemoryItems(
  input: EventExtractionInput,
  extracted: ExtractedEventCandidate[],
): MemoryItemInsert[] {
  const now = new Date().toISOString()

  return extracted.map((event) => ({
    id: `mem_${randomUUID()}`,
    kind: 'event',
    sessionId: input.sessionContext.sessionId,
    sessionKey: input.sessionContext.sessionKey,
    summary: event.summary,
    content: event.content,
    payloadJson: {
      event_type: event.eventType,
      occurred_at: event.occurredAt,
      extraction_strategy: event.confidence >= 0.7 ? 'llm' : 'heuristic',
    },
    tags: event.tags,
    importance: event.importance,
    confidence: event.confidence,
    status: 'active',
    sourceEventIds: event.sourceEventIds,
    sourceSessionId: input.sessionContext.sessionId,
    createdAt: now,
    updatedAt: now,
  }))
}

export async function extractEventMemoryItemsWithDiagnostics(
  input: EventExtractionInput,
  options?: { disableLlm?: boolean },
): Promise<EventExtractionExecution> {
  if (options?.disableLlm) {
    return {
      items: mapCandidatesToMemoryItems(input, createHeuristicCandidates(input)),
      diagnostics: {
        source: 'heuristic',
        fallbackReason: 'LLM disabled by caller',
        llmAttemptCount: 0,
      },
    }
  }

  const llmResult = await tryLlmExtraction(input)
  if (llmResult.candidates) {
    return {
      items: mapCandidatesToMemoryItems(input, llmResult.candidates),
      diagnostics: {
        source: 'llm',
        fallbackReason: llmResult.diagnostics.fallbackReason,
        llmAttemptCount: llmResult.diagnostics.llmAttemptCount,
      },
    }
  }

  return {
    items: mapCandidatesToMemoryItems(input, createHeuristicCandidates(input)),
    diagnostics: {
      source: 'heuristic',
      fallbackReason: llmResult.diagnostics.fallbackReason,
      llmAttemptCount: llmResult.diagnostics.llmAttemptCount,
    },
  }
}

export async function extractEventMemoryItems(input: EventExtractionInput): Promise<MemoryItemInsert[]> {
  const result = await extractEventMemoryItemsWithDiagnostics(input)
  return result.items
}
