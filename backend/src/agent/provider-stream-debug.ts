import type { AgentEvent } from '@mariozechner/pi-agent-core'
import type { Model } from '@mariozechner/pi-ai'
import { logger } from '../utils/logger.js'
import { inferProviderFlavor } from './provider-payload.js'

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
    case 'text_delta':
      logger.debug('Provider stream text_delta', {
        ...baseContext,
        contentIndex: event.assistantMessageEvent.contentIndex,
        deltaLength: event.assistantMessageEvent.delta.length,
      })
      return
    case 'thinking_delta':
      logger.debug('Provider stream thinking_delta', {
        ...baseContext,
        contentIndex: event.assistantMessageEvent.contentIndex,
        deltaLength: event.assistantMessageEvent.delta.length,
      })
      return
    default:
      return
  }
}
