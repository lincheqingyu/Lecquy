// 中文：本文件（event-sender.ts）位于 backend/src/ws/event-sender.ts，属于backend链路中的WebSocket 通信代码，连接上游调用方与下游执行逻辑。
// English: This file (event-sender.ts) belongs to the backend websocket 通信 layer in backend/src/ws/event-sender.ts, wiring upstream callers with downstream runtime logic.

/**
 * WS 事件发送与 AgentEvent 映射
 */

import type { WebSocket } from 'ws'
import type { AgentEvent } from '@mariozechner/pi-agent-core'

function summarizeToolResult(result: unknown): string {
  if (!result || typeof result !== 'object') return String(result ?? '')
  const r = result as { content?: unknown }
  if (!Array.isArray(r.content)) return JSON.stringify(result).slice(0, 200)
  const texts = r.content
    .filter((c: unknown) => c && typeof c === 'object' && (c as { type?: string }).type === 'text')
    .map((c: unknown) => ((c as { text?: string }).text ?? ''))
    .join('\n')
  return texts.slice(0, 200) || JSON.stringify(result).slice(0, 200)
}

export function sendEvent(ws: WebSocket, event: string, payload: Record<string, unknown> = {}): void {
  if (ws.readyState !== ws.OPEN) return
  ws.send(JSON.stringify({ event, payload }))
}

export function forwardAgentEvent(
  ws: WebSocket,
  event: AgentEvent,
  options: { deltaEvent: 'message_delta' | 'worker_delta'; sendMessageEnd: boolean },
): void {
  if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
    const delta = event.assistantMessageEvent.delta
    if (delta) {
      sendEvent(ws, options.deltaEvent, { content: delta })
    }
    return
  }

  if (event.type === 'tool_execution_start') {
    sendEvent(ws, 'tool_start', { toolName: event.toolName, args: event.args })
    return
  }

  if (event.type === 'tool_execution_end') {
    const summary = summarizeToolResult(event.result)
    sendEvent(ws, 'tool_end', {
      toolName: event.toolName,
      isError: event.isError,
      summary,
    })
    return
  }

  if (event.type === 'message_end' && options.sendMessageEnd) {
    sendEvent(ws, 'message_end')
  }
}
