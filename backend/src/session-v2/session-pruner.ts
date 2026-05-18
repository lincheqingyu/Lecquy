// 中文：本文件（session-pruner.ts）位于 backend/src/session-v2/session-pruner.ts，属于backend链路中的会话服务代码，连接上游调用方与下游执行逻辑。
// English: This file (session-pruner.ts) belongs to the backend 会话服务 layer in backend/src/session-v2/session-pruner.ts, wiring upstream callers with downstream runtime logic.

import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { SessionPruningConfig } from './types.js'

function estimateChars(message: AgentMessage): number {
  if (typeof message.content === 'string') return message.content.length
  try {
    return JSON.stringify(message.content).length
  } catch {
    return 0
  }
}

function hasImageBlock(message: AgentMessage): boolean {
  if (!Array.isArray(message.content)) return false
  return message.content.some((part) => {
    if (!part || typeof part !== 'object') return false
    const p = part as { type?: string }
    return p.type === 'image' || p.type === 'input_image'
  })
}

function trimText(text: string): string {
  const head = text.slice(0, 1500)
  const tail = text.slice(-1500)
  return `${head}\n...\n${tail}\n[toolResult trimmed, original chars=${text.length}]`
}

function toTextContent(message: AgentMessage): string {
  if (typeof message.content === 'string') return message.content
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          const text = (part as { text?: unknown }).text
          return typeof text === 'string' ? text : ''
        }
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

export function applyContextPruning(
  messages: AgentMessage[],
  config: SessionPruningConfig,
  contextWindowTokens: number,
): { messages: AgentMessage[]; prunedCount: number; prunedChars: number } {
  if (config.mode === 'off') {
    return { messages, prunedCount: 0, prunedChars: 0 }
  }

  const assistantIndexes = messages
    .map((m, idx) => ({ idx, role: m.role }))
    .filter((x) => x.role === 'assistant')
    .map((x) => x.idx)
  if (assistantIndexes.length < config.keepLastAssistants) {
    return { messages, prunedCount: 0, prunedChars: 0 }
  }

  const cutoffAssistant = assistantIndexes[assistantIndexes.length - config.keepLastAssistants]
  const charWindow = contextWindowTokens * 4
  const softThreshold = Math.floor(charWindow * config.softTrimRatio)
  const hardThreshold = Math.floor(charWindow * config.hardClearRatio)

  let prunedCount = 0
  let prunedChars = 0

  const next = messages.map((m, idx) => {
    if (idx >= cutoffAssistant || m.role !== 'toolResult') return m
    if (hasImageBlock(m)) return m

    const chars = estimateChars(m)
    if (chars < config.minPrunableToolChars) return m

    const text = toTextContent(m)
    if (!text) return m

    if (chars >= hardThreshold) {
      prunedCount += 1
      prunedChars += chars
      return {
        ...m,
        content: [{ type: 'text', text: '[Old tool result content cleared]' }],
      } satisfies AgentMessage
    }

    if (chars >= softThreshold) {
      prunedCount += 1
      prunedChars += chars - 4000
      return {
        ...m,
        content: [{ type: 'text', text: trimText(text) }],
      } satisfies AgentMessage
    }

    return m
  })

  return { messages: next, prunedCount, prunedChars }
}
