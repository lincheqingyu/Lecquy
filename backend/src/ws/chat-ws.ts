/**
 * WebSocket chat gateway
 * 统一 run_start / run_resume / run_cancel 生命周期协议
 */

import type http from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { z } from 'zod'
import {
  serverRequestResponseSchema,
  sessionSubscribeSchema,
  type ServerEventPayloadMap,
} from '@lecquy/shared'
import type { SessionRuntimeService } from '../runtime/index.js'
import { logger } from '../utils/logger.js'
import { runCancelSchema, runResumeSchema, runStartSchema } from '../types/api.js'
import { sendEvent } from './event-sender.js'

const HEARTBEAT_INTERVAL = 30_000
const HEARTBEAT_TIMEOUT = 60_000

interface ConnectionMeta {
  sessionKey?: string
  notifier?: (event: keyof ServerEventPayloadMap, payload: ServerEventPayloadMap[keyof ServerEventPayloadMap]) => void
  lastPongAt: number
  heartbeatTimer: ReturnType<typeof setInterval> | null
}

const wsEnvelopeSchema = z.object({
  event: z.string(),
  payload: z.record(z.unknown()).optional(),
})

function startHeartbeat(ws: WebSocket, meta: ConnectionMeta): void {
  meta.heartbeatTimer = setInterval(() => {
    if (Date.now() - meta.lastPongAt > HEARTBEAT_TIMEOUT) {
      stopHeartbeat(meta)
      ws.close(4000, '心跳超时')
      return
    }
    sendEvent(ws, 'ping', { timestamp: Date.now() })
  }, HEARTBEAT_INTERVAL)
}

function stopHeartbeat(meta: ConnectionMeta): void {
  if (meta.heartbeatTimer) {
    clearInterval(meta.heartbeatTimer)
    meta.heartbeatTimer = null
  }
}

function emitBoundSession(ws: WebSocket, bound: { sessionKey: string; sessionId: string; kind: string; channel: string; created: boolean }): void {
  sendEvent(ws, 'session_bound', {
    sessionKey: bound.sessionKey,
    sessionId: bound.sessionId,
    kind: bound.kind,
    channel: bound.channel,
    created: bound.created,
  })
}

function replayPendingServerRequests(ws: WebSocket, runtime: SessionRuntimeService, sessionKey: string): void {
  for (const request of runtime.getPendingServerRequests(sessionKey)) {
    sendEvent(ws, 'server_request', request as unknown as Record<string, unknown>)
  }
}

function bindNotifier(ws: WebSocket, meta: ConnectionMeta, runtime: SessionRuntimeService, sessionKey: string): void {
  if (meta.sessionKey && meta.notifier) {
    runtime.clearNotifier(meta.sessionKey, meta.notifier)
  }

  const notifier = (evt: keyof ServerEventPayloadMap, body: ServerEventPayloadMap[keyof ServerEventPayloadMap]) => {
    sendEvent(ws, evt, body as Record<string, unknown>)
  }
  meta.sessionKey = sessionKey
  meta.notifier = notifier
  runtime.setNotifier(sessionKey, notifier)
}

export function initChatWebSocketServer(server: http.Server, runtime: SessionRuntimeService): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/api/v1/chat/ws' })

  wss.on('connection', (ws) => {
    const meta: ConnectionMeta = {
      sessionKey: undefined,
      notifier: undefined,
      lastPongAt: Date.now(),
      heartbeatTimer: null,
    }
    startHeartbeat(ws, meta)

    ws.on('message', async (data) => {
      try {
        const raw = typeof data === 'string' ? data : data.toString()
        const parsed = wsEnvelopeSchema.safeParse(JSON.parse(raw))
        if (!parsed.success) {
          sendEvent(ws, 'error', { message: 'WS 消息格式错误', code: 'BAD_WS_ENVELOPE' })
          return
        }

        const { event, payload } = parsed.data

        if (event === 'pong') {
          meta.lastPongAt = Date.now()
          return
        }

        if (event === 'run_cancel') {
          const cancelParsed = runCancelSchema.safeParse(payload ?? {})
          if (!cancelParsed.success) {
            sendEvent(ws, 'error', { message: cancelParsed.error.issues.map((issue) => issue.message).join('; '), code: 'BAD_RUN_CANCEL' })
            return
          }
          const cancelled = runtime.cancelRun(cancelParsed.data.sessionKey, cancelParsed.data.runId)
          if (!cancelled) {
            sendEvent(ws, 'error', { message: '当前没有可取消的运行', code: 'RUN_NOT_FOUND' })
          }
          return
        }

        if (event === 'session_subscribe') {
          const subscribeParsed = sessionSubscribeSchema.safeParse(payload ?? {})
          if (!subscribeParsed.success) {
            sendEvent(ws, 'error', { message: subscribeParsed.error.issues.map((issue) => issue.message).join('; '), code: 'BAD_SESSION_SUBSCRIBE' })
            return
          }

          const projection = runtime.getProjection(subscribeParsed.data.sessionKey)
          if (!projection) {
            sendEvent(ws, 'error', { message: `会话不存在: ${subscribeParsed.data.sessionKey}`, code: 'SESSION_NOT_FOUND' })
            return
          }

          bindNotifier(ws, meta, runtime, projection.key)

          emitBoundSession(ws, {
            sessionKey: projection.key,
            sessionId: projection.sessionId,
            kind: projection.kind,
            channel: projection.channel,
            created: false,
          })

          sendEvent(ws, 'session_restored', {
            sessionKey: projection.key,
            sessionId: projection.sessionId,
            status: projection.workflow?.status,
            runId: projection.workflow?.runId,
            messageCount: 0,
          })
          replayPendingServerRequests(ws, runtime, projection.key)
          return
        }

        if (event === 'server_request_response') {
          const responseParsed = serverRequestResponseSchema.safeParse(payload ?? {})
          if (!responseParsed.success) {
            sendEvent(ws, 'error', { message: responseParsed.error.issues.map((issue) => issue.message).join('; '), code: 'BAD_SERVER_REQUEST_RESPONSE' })
            return
          }
          runtime.resolveServerRequest(responseParsed.data)
          return
        }

        if (event === 'run_start') {
          const startParsed = runStartSchema.safeParse(payload ?? {})
          if (!startParsed.success) {
            sendEvent(ws, 'error', { message: startParsed.error.issues.map((issue) => issue.message).join('; '), code: 'BAD_RUN_START' })
            return
          }

          const bound = await runtime.resolveSession(startParsed.data.route, startParsed.data.sessionKey)
          bindNotifier(ws, meta, runtime, bound.projection.key)

          emitBoundSession(ws, {
            sessionKey: bound.projection.key,
            sessionId: bound.projection.sessionId,
            kind: bound.projection.kind,
            channel: bound.projection.channel,
            created: bound.created,
          })

          if (bound.restored) {
            sendEvent(ws, 'session_restored', {
              sessionKey: bound.projection.key,
              sessionId: bound.projection.sessionId,
              status: bound.projection.workflow?.status,
              runId: bound.projection.workflow?.runId,
              messageCount: bound.messageCount,
            })
            replayPendingServerRequests(ws, runtime, bound.projection.key)
          }

          await runtime.startRun(startParsed.data)
          return
        }

        if (event === 'run_resume') {
          const resumeParsed = runResumeSchema.safeParse(payload ?? {})
          if (!resumeParsed.success) {
            sendEvent(ws, 'error', { message: resumeParsed.error.issues.map((issue) => issue.message).join('; '), code: 'BAD_RUN_RESUME' })
            return
          }

          const projection = runtime.getProjection(resumeParsed.data.sessionKey)
          if (!projection) {
            sendEvent(ws, 'error', { message: `会话不存在: ${resumeParsed.data.sessionKey}`, code: 'SESSION_NOT_FOUND' })
            return
          }

          bindNotifier(ws, meta, runtime, projection.key)

          emitBoundSession(ws, {
            sessionKey: projection.key,
            sessionId: projection.sessionId,
            kind: projection.kind,
            channel: projection.channel,
            created: false,
          })

          sendEvent(ws, 'session_restored', {
            sessionKey: projection.key,
            sessionId: projection.sessionId,
            status: projection.workflow?.status,
            runId: projection.workflow?.runId,
            messageCount: 0,
          })
          replayPendingServerRequests(ws, runtime, projection.key)

          await runtime.resumeRun(resumeParsed.data)
          return
        }

        sendEvent(ws, 'error', { message: `未知事件: ${event}`, code: 'UNKNOWN_EVENT' })
      } catch (error) {
        logger.error('WS 处理消息失败:', error)
        sendEvent(ws, 'error', { message: error instanceof Error ? error.message : String(error), code: 'WS_RUNTIME_ERROR' })
      }
    })

    ws.on('close', () => {
      stopHeartbeat(meta)
      if (meta.sessionKey && meta.notifier) {
        runtime.clearNotifier(meta.sessionKey, meta.notifier)
      }
      logger.info(`WS 连接关闭: ${meta.sessionKey ?? 'unknown'}`)
    })
  })

  return wss
}
