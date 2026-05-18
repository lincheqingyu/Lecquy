// 中文：本文件（flush.ts）位于 backend/src/memory/flush.ts，属于backend链路中的memory 记忆链路代码，连接上游调用方与下游执行逻辑。
// English: This file (flush.ts) belongs to the backend memory 记忆链路 layer in backend/src/memory/flush.ts, wiring upstream callers with downstream runtime logic.

import type { AgentMessage } from '@mariozechner/pi-agent-core'
import { extractSessionText } from '@lecquy/shared'
import { getMemoryConfig } from '../core/memory/index.js'
import { appendDailyMemoryEntry } from './store.js'
import { logger } from '../utils/logger.js'
import type { TurnState } from '../agent/agent-runner.js'

let turnCounter = 0

// 记忆写入模板约束：固定结构，便于后续检索和人工审阅。
const MEMORY_ENTRY_TEMPLATE = {
  reason: 'flushTurns threshold reached',
  sections: ['User Summary', 'Assistant Summary', 'Candidate Durable Facts'],
}

function extractText(msg: AgentMessage | undefined): string {
  if (!msg) return ''
  return extractSessionText(msg.content)
}

function buildFlushEntry(messages: AgentMessage[]): string {
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')

  const userText = extractText(lastUser).trim()
  const assistantText = extractText(lastAssistant).trim()

  if (!userText && !assistantText) return ''

  return [
    `- Reason: ${MEMORY_ENTRY_TEMPLATE.reason}`,
    '',
    `### ${MEMORY_ENTRY_TEMPLATE.sections[0]}`,
    userText || '(empty)',
    '',
    `### ${MEMORY_ENTRY_TEMPLATE.sections[1]}`,
    assistantText || '(empty)',
    '',
    `### ${MEMORY_ENTRY_TEMPLATE.sections[2]}`,
    '- (由后续检索/总结流程提炼长期事实)',
  ].join('\n')
}

export async function recordMemoryTurnAndMaybeFlush(
  messages: AgentMessage[],
  turnState?: TurnState,
): Promise<void> {
  // 优先使用会话级计数器，无则回退到模块级（兼容旧调用方）
  if (turnState) {
    turnState.counter += 1
  } else {
    turnCounter += 1
  }
  const currentCount = turnState ? turnState.counter : turnCounter
  const cfg = await getMemoryConfig()
  if (currentCount < cfg.flushTurns) {
    return
  }

  if (turnState) {
    turnState.counter = 0
  } else {
    turnCounter = 0
  }
  const entry = buildFlushEntry(messages)
  if (!entry) return

  await appendDailyMemoryEntry(entry)
  logger.info('memory flush 已执行（按轮次阈值）')
}

export function resetMemoryTurnCounter(): void {
  turnCounter = 0
}
