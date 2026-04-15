import type { AgentEvent } from '@mariozechner/pi-agent-core'
import type { Model } from '@mariozechner/pi-ai'
import { logger } from '../utils/logger.js'
import { inferProviderFlavor } from './provider-payload.js'

/**
 * 诊断 <think> / </think> 字面标签来源的工具。
 * - THINK_TAG_PATTERN：命中完整的 <think> 或 </think>
 * - TRAILING_PARTIAL_TAG_PATTERN：命中 delta 末尾可能被跨 chunk 切断的半截标签
 *   （例如 "…内容</th" 下一个 chunk 以 "ink>" 起）
 */
const THINK_TAG_PATTERN = /<\/?think>/i
const TRAILING_PARTIAL_TAG_PATTERN = /<\/?t(?:h(?:i(?:nk?)?)?)?$/i

function detectThinkTagAnomaly(
  stream: 'text' | 'thinking',
  delta: string,
): { hitType: 'complete' | 'trailing'; match: string } | null {
  const complete = delta.match(THINK_TAG_PATTERN)
  if (complete) {
    return { hitType: 'complete', match: complete[0] }
  }

  // thinking 流里出现半截标签倒不稀奇（思考里讨论标签是可能的），
  // 重点看 text 流被切断 —— 所以 trailing 只在 text 流告警
  if (stream === 'text') {
    const trailing = delta.match(TRAILING_PARTIAL_TAG_PATTERN)
    if (trailing && trailing[0].length >= 2) {
      return { hitType: 'trailing', match: trailing[0] }
    }
  }

  return null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function summarizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return { type: 'string', length: value.length }
  }
  if (Array.isArray(value)) {
    return { type: 'array', length: value.length }
  }
  if (isObject(value)) {
    return { type: 'object', keys: Object.keys(value).slice(0, 6) }
  }
  return value
}

function summarizeArgs(args: unknown): Record<string, unknown> | undefined {
  if (!isObject(args)) return undefined
  return Object.fromEntries(
    Object.entries(args)
      .slice(0, 8)
      .map(([key, value]) => [key, summarizeValue(value)]),
  )
}

function extractPartialToolCallState(event: AgentEvent): {
  contentIndex?: number
  toolName?: string
  args?: unknown
  deltaLength?: number
} | null {
  if (event.type !== 'message_update') return null
  const assistantEvent = event.assistantMessageEvent
  if (assistantEvent.type !== 'toolcall_start' && assistantEvent.type !== 'toolcall_delta') {
    return null
  }

  const partial = 'partial' in assistantEvent ? assistantEvent.partial : undefined
  const contentIndex = 'contentIndex' in assistantEvent ? assistantEvent.contentIndex : undefined
  if (!isObject(partial) || typeof contentIndex !== 'number') return null

  const content = 'content' in partial ? partial.content : undefined
  if (!Array.isArray(content)) {
    return { contentIndex, deltaLength: 'delta' in assistantEvent ? assistantEvent.delta.length : 0 }
  }

  const toolCall = content[contentIndex]
  if (!isObject(toolCall)) {
    return { contentIndex, deltaLength: 'delta' in assistantEvent ? assistantEvent.delta.length : 0 }
  }

  const toolName = 'name' in toolCall && typeof toolCall.name === 'string' ? toolCall.name : undefined
  const args = 'arguments' in toolCall ? toolCall.arguments : undefined

  return {
    contentIndex,
    toolName,
    args,
    deltaLength: 'delta' in assistantEvent ? assistantEvent.delta.length : 0,
  }
}

export function logProviderStreamEvent(
  model: Model<'openai-completions'>,
  event: AgentEvent,
): void {
  if (event.type !== 'message_update') return

  const providerFlavor = inferProviderFlavor(model.baseUrl)
  const baseContext = {
    modelId: model.id,
    baseUrl: model.baseUrl,
    providerFlavor,
  }

  switch (event.assistantMessageEvent.type) {
    case 'toolcall_start': {
      const state = extractPartialToolCallState(event)
      logger.info('Provider stream toolcall_start', {
        ...baseContext,
        contentIndex: state?.contentIndex,
        toolName: state?.toolName,
      })
      return
    }
    case 'toolcall_delta': {
      const state = extractPartialToolCallState(event)
      logger.debug('Provider stream toolcall_delta', {
        ...baseContext,
        contentIndex: state?.contentIndex,
        toolName: state?.toolName,
        deltaLength: state?.deltaLength ?? 0,
        argsSummary: summarizeArgs(state?.args),
      })
      return
    }
    case 'toolcall_end': {
      const toolCall = event.assistantMessageEvent.toolCall
      logger.info('Provider stream toolcall_end', {
        ...baseContext,
        contentIndex: event.assistantMessageEvent.contentIndex,
        toolName: toolCall.name,
        argsSummary: summarizeArgs(toolCall.arguments),
      })
      return
    }
    case 'text_delta': {
      const delta = event.assistantMessageEvent.delta
      const anomaly = detectThinkTagAnomaly('text', delta)
      if (anomaly) {
        // 命中字面 <think> / </think>（或其跨 chunk 半截形式）于 text 流
        // —— 说明 SDK 没把这段识别成 thinking，极可能是 qwen 解析漏了或模型输出了字面标签
        logger.warn('Provider stream text_delta contains <think> tag literal', {
          ...baseContext,
          stream: 'text',
          contentIndex: event.assistantMessageEvent.contentIndex,
          hitType: anomaly.hitType,
          match: anomaly.match,
          deltaLength: delta.length,
          delta,
        })
      } else {
        logger.debug('Provider stream text_delta', {
          ...baseContext,
          contentIndex: event.assistantMessageEvent.contentIndex,
          deltaLength: delta.length,
        })
      }
      return
    }
    case 'thinking_delta': {
      const delta = event.assistantMessageEvent.delta
      const anomaly = detectThinkTagAnomaly('thinking', delta)
      if (anomaly) {
        // 命中于 thinking 流：通常意味着模型在“思考内容”里把 <think>/</think>
        // 当正文写了一次（幻觉），SDK 正常识别了外层但内层字面标签被透传
        logger.warn('Provider stream thinking_delta contains <think> tag literal', {
          ...baseContext,
          stream: 'thinking',
          contentIndex: event.assistantMessageEvent.contentIndex,
          hitType: anomaly.hitType,
          match: anomaly.match,
          deltaLength: delta.length,
          delta,
        })
      } else {
        logger.debug('Provider stream thinking_delta', {
          ...baseContext,
          contentIndex: event.assistantMessageEvent.contentIndex,
          deltaLength: delta.length,
        })
      }
      return
    }
    default:
      return
  }
}
