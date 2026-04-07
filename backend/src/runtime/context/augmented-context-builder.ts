import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { SessionManager } from '../pi-session-core/session-manager.js'

export interface BuildAugmentedContextInput {
  readonly sessionManager: SessionManager
  readonly memoryRecallBlock?: string
}

export interface BuildAugmentedContextResult {
  readonly contextMessages: AgentMessage[]
}

function createSyntheticUserContextMessage(block: string): AgentMessage {
  return {
    role: 'user',
    content: [{
      type: 'text',
      text: block,
    }],
    timestamp: 0,
  }
}

function normalizeOptionalBlock(block?: string): string | undefined {
  const trimmed = block?.trim()
  return trimmed ? trimmed : undefined
}

export function buildAugmentedContext(input: BuildAugmentedContextInput): BuildAugmentedContextResult {
  const sessionContext = input.sessionManager.buildSessionContext()
  const sessionContextMessages = sessionContext.messages
  const memoryRecallBlock = normalizeOptionalBlock(input.memoryRecallBlock)

  const contextMessages: AgentMessage[] = []
  let compactSummaryMessage: AgentMessage | null = null
  let recentTailMessages: AgentMessage[] = []

  if (
    sessionContext.compaction
    && sessionContext.compaction.summaryMessageIndex === 0
    && sessionContextMessages[0]
  ) {
    compactSummaryMessage = sessionContextMessages[0]
    recentTailMessages = sessionContextMessages.slice(1)
  } else {
    contextMessages.push(...sessionContextMessages)
  }

  if (memoryRecallBlock) {
    contextMessages.push(createSyntheticUserContextMessage(memoryRecallBlock))
  }

  if (compactSummaryMessage) {
    contextMessages.push(compactSummaryMessage)
  }

  contextMessages.push(...recentTailMessages)

  return { contextMessages }
}
