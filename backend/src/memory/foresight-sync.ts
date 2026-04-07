import type { RunId, SerializedTodoItem, SessionProjection } from '@webclaw/shared'
import { getPool } from '../db/client.js'
import { upsertMemoryItems } from '../db/memory-repository.js'
import { logger } from '../utils/logger.js'
import type { MemoryItemInsert, MemoryStatus } from './types.js'

interface SyncTodosToForesightArgs {
  readonly pgEnabled: boolean
  readonly projection: SessionProjection
  readonly runId: RunId
  readonly items: readonly SerializedTodoItem[]
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function extractKeywordTags(input: string): string[] {
  const tokens = normalizeWhitespace(input)
    .replace(/[^\p{L}\p{N}_\- ]+/gu, ' ')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 24)

  return [...new Set(tokens)].slice(0, 5)
}

function buildForesightId(sessionId: string, runId: RunId, todoIndex: number): string {
  return `mem_foresight_${sessionId}_${runId}_${todoIndex}`
}

function mapProgress(item: SerializedTodoItem): 'pending' | 'in_progress' | 'done' | 'cancelled' {
  if (item.status === 'pending') return 'pending'
  if (item.status === 'in_progress') return 'in_progress'
  if (item.errorMessage?.trim()) return 'cancelled'
  return 'done'
}

function mapMemoryStatus(progress: ReturnType<typeof mapProgress>): MemoryStatus {
  return progress === 'pending' || progress === 'in_progress'
    ? 'active'
    : 'superseded'
}

function mapImportance(progress: ReturnType<typeof mapProgress>): number {
  switch (progress) {
    case 'in_progress':
      return 8
    case 'pending':
      return 7
    case 'done':
      return 5
    case 'cancelled':
      return 4
  }
}

export function buildForesightMemoryItems(
  projection: SessionProjection,
  runId: RunId,
  items: readonly SerializedTodoItem[],
): MemoryItemInsert[] {
  const now = new Date().toISOString()

  return items.map((item, todoIndex) => {
    const progress = mapProgress(item)
    const content = normalizeWhitespace(item.activeForm || item.content)
    const tags = extractKeywordTags(`${item.content} ${item.activeForm ?? ''}`)

    return {
      id: buildForesightId(projection.sessionId, runId, todoIndex),
      kind: 'foresight',
      sessionId: projection.sessionId,
      sessionKey: projection.key,
      summary: normalizeWhitespace(item.content),
      content,
      payloadJson: {
        foresight_type: 'todo',
        progress,
        run_id: runId,
        todo_index: todoIndex,
        content: item.content,
        active_form: item.activeForm,
        result: item.result,
        error: item.errorMessage,
        updated_at: now,
      },
      tags,
      importance: mapImportance(progress),
      confidence: 0.95,
      status: mapMemoryStatus(progress),
      sourceEventIds: [],
      sourceSessionId: projection.sessionId,
      createdAt: now,
      updatedAt: now,
    }
  })
}

export async function syncTodosToForesight(args: SyncTodosToForesightArgs): Promise<void> {
  if (!args.pgEnabled || args.items.length === 0) {
    return
  }

  try {
    await upsertMemoryItems(
      getPool(),
      buildForesightMemoryItems(args.projection, args.runId, args.items),
    )
  } catch (error) {
    logger.error('foresight 同步失败，已保留 runtime 主链路', {
      sessionKey: args.projection.key,
      sessionId: args.projection.sessionId,
      runId: args.runId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
