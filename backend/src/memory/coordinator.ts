// 中文：本文件（coordinator.ts）位于 backend/src/memory/coordinator.ts，属于backend链路中的memory 记忆链路代码，连接上游调用方与下游执行逻辑。
// English: This file (coordinator.ts) belongs to the backend memory 记忆链路 layer in backend/src/memory/coordinator.ts, wiring upstream callers with downstream runtime logic.

import { extractSessionText, type SessionProjection } from '@lecquy/shared'
import { getConfig, type Env } from '../config/index.js'
import { getPool } from '../db/client.js'
import {
  claimNextPendingMemoryJob,
  enqueueEventExtractionJob,
  getLatestTriggerEventSeq,
  insertMemoryItems as insertPgMemoryItems,
  loadEventExtractionInput,
  markMemoryJobDone,
  markMemoryJobFailure,
} from '../db/memory-repository.js'
import type { SessionManager } from '../runtime/pi-session-core/session-manager.js'
import { logger } from '../utils/logger.js'
import { extractEventMemoryItems } from './extraction-runner.js'
import { deriveProjectId } from './project-id.js'
import {
  getLastExtractedSeq,
  insertItemsAndAdvanceWatermark,
} from './sqlite-store.js'
import type { EventExtractionInput, MemoryItemInsert } from './types.js'

const EVENT_EXTRACTION_MESSAGE_THRESHOLD = 4
const EVENT_EXTRACTION_MAX_MESSAGES = 8
const MEMORY_JOB_POLL_INTERVAL_MS = 5_000
const MEMORY_JOB_MAX_RETRY = 3

function isLegacyPgMemoryEnabled(config: Env): boolean {
  return config.PG_ENABLED && process.env.MEMORY_PG_LEGACY === 'true'
}

function countDurableCandidateMessages(manager: SessionManager, fromEventSeq: number): number {
  return manager.getEntries()
    .slice(fromEventSeq)
    .filter((entry) =>
      entry.type === 'message'
      && (entry.message.role === 'user' || entry.message.role === 'assistant')
      && entry.message.content,
    )
    .length
}

interface ExtractAndPersistOptions {
  readonly extractItems?: (input: EventExtractionInput) => Promise<MemoryItemInsert[]>
}

export function buildEventExtractionInput(
  projection: SessionProjection,
  manager: SessionManager,
  fromSeq = 0,
): EventExtractionInput {
  const messages = manager.getEntries()
    .map((entry, index) => ({ entry, seq: index + 1 }))
    .filter(({ seq }) => seq > fromSeq)
    .filter(({ entry }) => {
      if (entry.type !== 'message') return false
      if (entry.message.role !== 'user' && entry.message.role !== 'assistant') return false
      return Boolean(extractSessionText(entry.message.content).trim())
    })
    .slice(-EVENT_EXTRACTION_MAX_MESSAGES)
    .map(({ entry, seq }) => {
      if (entry.type !== 'message') {
        throw new Error('unexpected non-message entry in memory extraction input')
      }

      return {
        seq,
        eventId: entry.id,
        role: entry.message.role === 'assistant' ? 'assistant' as const : 'user' as const,
        text: extractSessionText(entry.message.content).trim(),
        timestamp: entry.timestamp,
      }
    })

  return {
    sessionContext: {
      sessionId: projection.sessionId,
      sessionKey: projection.key,
      title: projection.title,
      mode: projection.workflow?.mode === 'plan' ? 'plan' : 'simple',
    },
    messages,
  }
}

export async function extractAndPersistOnTurnComplete(
  projection: SessionProjection,
  manager: SessionManager,
  cwd: string,
  options: ExtractAndPersistOptions = {},
): Promise<void> {
  const sessionId = projection.sessionId
  const lastSeq = getLastExtractedSeq(sessionId)
  const currentSeq = manager.getEntries().length
  const newMessageCount = countDurableCandidateMessages(manager, lastSeq)
  if (newMessageCount < EVENT_EXTRACTION_MESSAGE_THRESHOLD) return

  const input = buildEventExtractionInput(projection, manager, lastSeq)
  if (input.messages.length < EVENT_EXTRACTION_MESSAGE_THRESHOLD) return

  const projectId = deriveProjectId(cwd)
  const extractItems = options.extractItems ?? extractEventMemoryItems
  const items = (await extractItems(input)).map((item) => ({
    ...item,
    projectId,
  }))

  insertItemsAndAdvanceWatermark(items, sessionId, currentSeq)
  logger.info('SQLite event memory 已落库', {
    sessionKey: projection.key,
    sessionId,
    projectId,
    count: items.length,
    fromSeq: lastSeq,
    toSeq: currentSeq,
  })
}

export class MemoryCoordinator {
  private readonly cfg: Env
  readonly enabled: boolean = false
  private pollTimer: NodeJS.Timeout | null = null
  private inFlightPoll: Promise<void> | null = null

  constructor(config = getConfig()) {
    this.cfg = config
    this.enabled = isLegacyPgMemoryEnabled(config)
  }

  start(): void {
    if (!this.enabled || this.pollTimer) return

    this.pollTimer = setInterval(() => {
      void this.pollOnce()
    }, MEMORY_JOB_POLL_INTERVAL_MS)
    this.pollTimer.unref?.()
    logger.info('MemoryCoordinator 已启动')
  }

  async shutdown(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }

    if (this.inFlightPoll) {
      await this.inFlightPoll.catch((error) => {
        logger.warn('等待 memory poller 停止时出现错误', error)
      })
    }
  }

  async onTurnCompleted(projection: SessionProjection, manager: SessionManager): Promise<void> {
    if (!this.enabled) return

    try {
      const pool = getPool()
      const latestTriggerEventSeq = await getLatestTriggerEventSeq(pool, projection.sessionId, 'extract_event')
      const newMessageCount = countDurableCandidateMessages(manager, latestTriggerEventSeq)

      if (newMessageCount < EVENT_EXTRACTION_MESSAGE_THRESHOLD) {
        return
      }

      const enqueued = await enqueueEventExtractionJob(pool, {
        sessionId: projection.sessionId,
        triggerEventSeq: manager.getEntries().length,
        payload: {
          sessionKey: projection.key,
          fromEventSeq: latestTriggerEventSeq,
          maxMessages: EVENT_EXTRACTION_MAX_MESSAGES,
        },
      })

      if (enqueued) {
        logger.info('已入队 extract_event job', {
          sessionKey: projection.key,
          sessionId: projection.sessionId,
          triggerEventSeq: manager.getEntries().length,
        })
      }
    } catch (error) {
      logger.error('MemoryCoordinator 入队失败', {
        sessionKey: projection.key,
        sessionId: projection.sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private async pollOnce(): Promise<void> {
    if (this.inFlightPoll) return

    this.inFlightPoll = this.processNextJob()
      .catch((error) => {
        logger.error('memory poller 执行失败', error)
      })
      .finally(() => {
        this.inFlightPoll = null
      })

    await this.inFlightPoll
  }

  private async processNextJob(): Promise<void> {
    const pool = getPool()
    const job = await claimNextPendingMemoryJob(pool)
    if (!job) return

    try {
      if (job.jobType === 'extract_event') {
        const input = await loadEventExtractionInput(pool, job)
        const items = await extractEventMemoryItems(input)
        if (items.length > 0) {
          await insertPgMemoryItems(pool, items)
        }
      }

      await markMemoryJobDone(pool, job.id)
    } catch (error) {
      await markMemoryJobFailure(pool, job.id, {
        error: error instanceof Error ? error.message : String(error),
        retryable: job.attemptCount < MEMORY_JOB_MAX_RETRY,
      })
      throw error
    }
  }
}

let memoryCoordinator: MemoryCoordinator | null = null

export async function createMemoryCoordinator(config = getConfig()): Promise<MemoryCoordinator> {
  if (memoryCoordinator) return memoryCoordinator
  memoryCoordinator = new MemoryCoordinator(config)
  memoryCoordinator.start()
  return memoryCoordinator
}

export function getMemoryCoordinator(): MemoryCoordinator | null {
  return memoryCoordinator
}
