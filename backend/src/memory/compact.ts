import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { extractSessionText, type SessionEventEntry } from '@lecquy/shared'
import { resolvePromptContextPaths } from '../core/prompts/context-files.js'
import { formatCompactSummary } from '../runtime/context/templates/compact-summary.template.js'
import type { SessionManager } from '../runtime/pi-session-core/session-manager.js'

const COMPACT_TRIGGER_MESSAGE_EVENTS = 50
const COMPACT_RECENT_TAIL = 10

interface CompactSource {
  readonly previousSummary?: string
  readonly compactedMessages: SessionEventEntry[]
  readonly firstKeptEntryId: string
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function extractMessageText(entry: SessionEventEntry): string {
  if (entry.type !== 'message') return ''
  return normalizeWhitespace(extractSessionText(entry.message.content))
}

function getDurableMessageEntries(entries: SessionEventEntry[]): SessionEventEntry[] {
  return entries.filter((entry) =>
    entry.type === 'message'
    && (entry.message.role === 'user' || entry.message.role === 'assistant')
    && extractMessageText(entry).length > 0,
  )
}

function findLatestCompaction(entries: SessionEventEntry[]): SessionEventEntry | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index]
    if (entry.type === 'compaction') {
      return entry
    }
  }
  return null
}

function resolveCompactSource(entries: SessionEventEntry[]): CompactSource | null {
  const messageEntries = getDurableMessageEntries(entries)
  if (messageEntries.length < COMPACT_TRIGGER_MESSAGE_EVENTS) {
    return null
  }

  const latestCompaction = findLatestCompaction(entries)
  let candidateMessages = messageEntries
  let previousSummary: string | undefined

  if (latestCompaction?.type === 'compaction') {
    const startIndex = messageEntries.findIndex((entry) => entry.id === latestCompaction.firstKeptEntryId)
    if (startIndex >= 0) {
      candidateMessages = messageEntries.slice(startIndex)
      previousSummary = latestCompaction.summary
    }
  }

  if (candidateMessages.length < COMPACT_TRIGGER_MESSAGE_EVENTS) {
    return null
  }

  const firstKeptEntry = candidateMessages[candidateMessages.length - COMPACT_RECENT_TAIL]
  if (!firstKeptEntry) {
    return null
  }

  return {
    previousSummary,
    compactedMessages: candidateMessages.slice(0, candidateMessages.length - COMPACT_RECENT_TAIL),
    firstKeptEntryId: firstKeptEntry.id,
  }
}

function buildCompactSummary(source: CompactSource): string {
  return formatCompactSummary({
    previousSummary: source.previousSummary,
    compactedMessages: source.compactedMessages,
    recentTailCount: COMPACT_RECENT_TAIL,
  })
}

function estimateTokensBefore(source: CompactSource): number {
  const previous = source.previousSummary ?? ''
  const messageText = source.compactedMessages
    .map((entry) => extractMessageText(entry))
    .filter(Boolean)
    .join('\n')

  return Math.max(1, Math.ceil((previous.length + messageText.length) / 4))
}

async function writeMemorySummary(workspaceDir: string, summary: string): Promise<void> {
  const summaryPath = resolvePromptContextPaths(workspaceDir).memorySummaryFile
  await fs.mkdir(dirname(summaryPath), { recursive: true })
  await fs.writeFile(summaryPath, summary, 'utf8')
}

export async function applyCompactionIfNeeded(manager: SessionManager): Promise<boolean> {
  const source = resolveCompactSource(manager.getEntries())
  if (!source) {
    return false
  }

  const summary = buildCompactSummary(source)
  manager.appendCompaction(
    summary,
    source.firstKeptEntryId,
    estimateTokensBefore(source),
    {
      trigger: 'message_threshold',
      kept_message_count: COMPACT_RECENT_TAIL,
      compacted_message_count: source.compactedMessages.length,
      compacted_through_entry_id: source.compactedMessages[source.compactedMessages.length - 1]?.id,
    },
  )

  await writeMemorySummary(manager.getCwd(), summary)

  return true
}
