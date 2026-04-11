import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { SessionMode, SessionRouteContext } from '@lecquy/shared'
import { getPool } from '../db/client.js'
import { searchEventMemories } from '../db/memory-search-repository.js'
import { formatMemoryRecallBlock } from '../runtime/context/templates/memory-recall.template.js'
import { logger } from '../utils/logger.js'
import { loadMemoryInjectionText } from './store.js'
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

interface BuildMemoryRecallMessagesArgs {
  readonly pgEnabled: boolean
  readonly sessionId: string
  readonly sessionKey?: string
  readonly userQuery: string
  readonly workspaceDir: string
  readonly mode?: SessionMode
  readonly route?: SessionRouteContext
}

export const promptInjectorDeps = {
  getPool,
  searchEventMemories,
  formatMemoryRecallBlock,
  loadMemoryInjectionText,
  logger,
} as const

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

/**
 * @deprecated 使用 buildMemoryRecallMessages 替代。
 */
export async function buildMemoryRecallBlockLegacy(
  args: BuildMemoryRecallBlockArgs,
): Promise<string> {
  if (!args.pgEnabled) {
    return ''
  }

  if (normalizeWhitespace(args.userQuery).length < 2) {
    return ''
  }

  try {
    const recallItems = await promptInjectorDeps.searchEventMemories(promptInjectorDeps.getPool(), buildRecallQuery(args))
    return promptInjectorDeps.formatMemoryRecallBlock(recallItems)
  } catch (error) {
    promptInjectorDeps.logger.warn('memory recall 查询失败，已回退为无注入', {
      sessionId: args.sessionId,
      sessionKey: args.sessionKey,
      error: error instanceof Error ? error.message : String(error),
    })
    return ''
  }
}

function createMemoryRecallMessage(text: string): AgentMessage {
  return {
    role: 'user',
    content: `<LAYER:memory_recall>\n${text}\n</LAYER>`,
    timestamp: 0,
  }
}

export async function buildMemoryRecallMessages(
  args: BuildMemoryRecallMessagesArgs,
): Promise<AgentMessage[]> {
  let recallText = ''

  if (args.pgEnabled && normalizeWhitespace(args.userQuery).length >= 2) {
    try {
      const recallItems = await promptInjectorDeps.searchEventMemories(
        promptInjectorDeps.getPool(),
        {
          sessionId: args.sessionId,
          sessionKey: args.sessionKey ?? args.sessionId,
          userQuery: args.userQuery,
          mode: args.mode ?? 'simple',
          route: args.route?.channel,
          limit: MEMORY_RECALL_TOP_K,
        },
      )
      recallText = promptInjectorDeps.formatMemoryRecallBlock(recallItems)
    } catch (error) {
      promptInjectorDeps.logger.warn('memory recall 查询失败，已回退为文件系统 recall', {
        sessionId: args.sessionId,
        sessionKey: args.sessionKey ?? args.sessionId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  if (!recallText.trim()) {
    recallText = await promptInjectorDeps.loadMemoryInjectionText(args.workspaceDir)
  }

  const normalized = recallText.trim()
  if (!normalized) {
    return []
  }

  return [createMemoryRecallMessage(normalized)]
}
