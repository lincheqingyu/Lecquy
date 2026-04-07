import type { SessionProjection } from '@webclaw/shared'
import { getConfig, type Env } from '../config/index.js'
import { getPool } from '../db/client.js'
import {
  claimNextPendingMemoryJob,
  enqueueEventExtractionJob,
  getLatestTriggerEventSeq,
  insertMemoryItems,
  loadEventExtractionInput,
  markMemoryJobDone,
  markMemoryJobFailure,
} from '../db/memory-repository.js'
import type { SessionManager } from '../runtime/pi-session-core/session-manager.js'
import { logger } from '../utils/logger.js'
import { extractEventMemoryItems } from './extraction-runner.js'

const EVENT_EXTRACTION_MESSAGE_THRESHOLD = 4
const EVENT_EXTRACTION_MAX_MESSAGES = 8
const MEMORY_JOB_POLL_INTERVAL_MS = 5_000
const MEMORY_JOB_MAX_RETRY = 3

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

export class MemoryCoordinator {
  private readonly cfg: Env
  private pollTimer: NodeJS.Timeout | null = null
  private inFlightPoll: Promise<void> | null = null

  constructor(config = getConfig()) {
    this.cfg = config
  }

  start(): void {
    if (!this.cfg.PG_ENABLED || this.pollTimer) return

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
    if (!this.cfg.PG_ENABLED) return

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
          await insertMemoryItems(pool, items)
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
