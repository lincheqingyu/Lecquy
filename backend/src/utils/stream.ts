/**
 * SSE (Server-Sent Events) 流式响应工具
 */

import type { Response } from 'express'

/**
 * 初始化 SSE 响应头
 * 设置必要的 HTTP 头以支持 Server-Sent Events
 */
export function initSSE(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
}

/**
 * 发送一个 SSE 事件
 */
export function sendSSEEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`)
  res.write(`data: ${JSON.stringify(data)}\n\n`)
}
