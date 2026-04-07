import type { SessionMode, SessionRouteContext } from '@webclaw/shared'
import { getPool } from '../db/client.js'
import { searchEventMemories } from '../db/memory-search-repository.js'
import { formatMemoryRecallBlock } from '../runtime/context/templates/memory-recall.template.js'
import { logger } from '../utils/logger.js'
import type { MemoryRecallQuery } from './types.js'

const MEMORY_RECALL_TOP_K = 5

interface BuildMemoryRecallBlockArgs {
  readonly pgEnabled: boolean
  readonly sessionId: string
  readonly sessionKey: string
  readonly userQuery: string
  readonly mode: SessionMode
  readonly route?: SessionRouteContext
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function buildRecallQuery(args: BuildMemoryRecallBlockArgs): MemoryRecallQuery {
  return {
    sessionId: args.sessionId,
    sessionKey: args.sessionKey,
    userQuery: args.userQuery,
    mode: args.mode,
    route: args.route?.channel,
    limit: MEMORY_RECALL_TOP_K,
  }
}

export async function buildMemoryRecallBlock(
  args: BuildMemoryRecallBlockArgs,
): Promise<string> {
  if (!args.pgEnabled) {
    return ''
  }

  if (normalizeWhitespace(args.userQuery).length < 2) {
    return ''
  }

  try {
    const recallItems = await searchEventMemories(getPool(), buildRecallQuery(args))
    return formatMemoryRecallBlock(recallItems)
  } catch (error) {
    logger.warn('memory recall 查询失败，已回退为无注入', {
      sessionId: args.sessionId,
      sessionKey: args.sessionKey,
      error: error instanceof Error ? error.message : String(error),
    })
    return ''
  }
}
