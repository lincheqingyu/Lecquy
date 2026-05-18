// 中文：本文件（ai-request-logger.ts）记录发往模型的完整请求快照，帮助调试 system prompt 与最终 payload。
// English: This file (ai-request-logger.ts) records full outbound AI request snapshots for system prompt and payload debugging.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Model } from '@mariozechner/pi-ai'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { RunId } from '@lecquy/shared'
import { resolveWorkspaceRoot } from '../core/runtime-paths.js'
import { logger } from '../utils/logger.js'

type AgentRole = 'simple' | 'manager' | 'worker'

interface AiRequestLoggerOptions {
  readonly role: AgentRole
  readonly model: Model<'openai-completions'>
  readonly systemPrompt: string
  readonly promptMessages: readonly AgentMessage[]
  readonly contextMessages: readonly AgentMessage[]
  readonly sessionKey?: string
  readonly sessionId?: string
  readonly runId?: RunId
  readonly llmSessionId?: string
}

interface AiRequestSnapshot {
  readonly requestId: string
  readonly timestamp: string
  readonly role: AgentRole
  readonly model: {
    readonly id: string
    readonly provider: string
    readonly api: string
    readonly baseUrl: string
  }
  readonly session: {
    readonly sessionKey?: string
    readonly sessionId?: string
    readonly runId?: RunId
    readonly llmSessionId?: string
  }
  readonly systemPrompt: string
  readonly inputMessages: {
    readonly promptMessages: readonly AgentMessage[]
    readonly contextMessages: readonly AgentMessage[]
  }
  readonly payload: unknown
}

function isAiRequestLogEnabled(): boolean {
  return process.env.AI_REQUEST_LOG !== 'false'
}

function createRequestId(role: AgentRole): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  const random = Math.random().toString(36).slice(2, 8)
  return `${role}-${timestamp}-${random}`
}

function snapshotValueReplacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString()
  }
  if (typeof value === 'function') {
    return `[Function ${(value as { name?: string }).name || 'anonymous'}]`
  }
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    }
  }
  return value
}

function stringifyCircularSnapshot(snapshot: AiRequestSnapshot): string {
  const seen = new WeakSet<object>()

  return JSON.stringify(
    snapshot,
    (_key, value: unknown) => {
      const replaced = snapshotValueReplacer(_key, value)
      if (replaced && typeof replaced === 'object') {
        if (seen.has(replaced)) {
          return '[Circular]'
        }
        seen.add(replaced)
      }
      return replaced
    },
    2,
  )
}

function stringifySnapshot(snapshot: AiRequestSnapshot): string {
  try {
    return JSON.stringify(snapshot, snapshotValueReplacer, 2)
  } catch {
    return stringifyCircularSnapshot(snapshot)
  }
}

function writeSnapshotFile(requestId: string, serialized: string): string {
  const logDir = path.join(resolveWorkspaceRoot(), '.lecquy', 'logs', 'ai-requests')
  mkdirSync(logDir, { recursive: true })

  const filePath = path.join(logDir, `${requestId}.json`)
  writeFileSync(filePath, `${serialized}\n`, 'utf8')
  return filePath
}

export function logAiRequestSnapshot(options: AiRequestLoggerOptions, payload: unknown): void {
  if (!isAiRequestLogEnabled()) {
    return
  }

  const requestId = createRequestId(options.role)
  const snapshot: AiRequestSnapshot = {
    requestId,
    timestamp: new Date().toISOString(),
    role: options.role,
    model: {
      id: options.model.id,
      provider: options.model.provider,
      api: options.model.api,
      baseUrl: options.model.baseUrl,
    },
    session: {
      sessionKey: options.sessionKey,
      sessionId: options.sessionId,
      runId: options.runId,
      llmSessionId: options.llmSessionId,
    },
    systemPrompt: options.systemPrompt,
    inputMessages: {
      promptMessages: options.promptMessages,
      contextMessages: options.contextMessages,
    },
    payload,
  }

  try {
    const serialized = stringifySnapshot(snapshot)
    const filePath = writeSnapshotFile(requestId, serialized)

    logger.info(`[AI_REQUEST_LOG] 完整发送给 AI 的请求快照 requestId=${requestId} file=${filePath}`)
    logger.info(`[AI_REQUEST_LOG_FULL:${requestId}]\n${serialized}`)
  } catch (error) {
    logger.warn('[AI_REQUEST_LOG] 写入完整 AI 请求日志失败', error)
  }
}
