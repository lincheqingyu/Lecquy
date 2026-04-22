import {
  groupMessageBlocks,
  type MessageBlock,
  type MessageToolCallBlock,
} from './message-blocks'

const CHAT_STREAM_DEBUG_STORAGE_KEY = 'lecquy.debug.chatStream'

type GroupSummary =
  | { kind: 'text'; preview: string }
  | { kind: 'thinking'; preview: string }
  | { kind: 'tool_single'; toolName: string; status: MessageToolCallBlock['status'] }
  | { kind: 'tool_group'; toolNames: string[]; statuses: MessageToolCallBlock['status'][] }

function getPreview(value: string | undefined, maxLength = 32): string {
  if (!value) return ''
  const normalized = value.replace(/\s+/g, ' ').trim()
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength)}...`
}

export function isChatStreamDebugEnabled(): boolean {
  if (!import.meta.env.DEV) return false

  try {
    const raw = window.localStorage.getItem(CHAT_STREAM_DEBUG_STORAGE_KEY)
    if (raw === null) return true
    return raw === '1' || raw === 'true'
  } catch {
    return true
  }
}

export function summarizeBlocks(blocks: MessageBlock[] | undefined): Array<Record<string, unknown>> {
  return (blocks ?? []).map((block, index) => {
    if (block.kind === 'text' || block.kind === 'thinking') {
      return {
        index,
        kind: block.kind,
        preview: getPreview(block.content),
        length: block.content.length,
      }
    }

    return {
      index,
      kind: block.kind,
      toolName: block.name,
      status: block.status,
      hasArgs: typeof block.args !== 'undefined',
      hasResult: typeof block.result !== 'undefined',
      hasError: Boolean(block.errorMessage || block.errorDetail),
    }
  })
}

export function summarizeGroups(blocks: MessageBlock[] | undefined): GroupSummary[] {
  return groupMessageBlocks(blocks ?? []).map((group) => {
    if (group.kind === 'text') {
      return {
        kind: 'text',
        preview: getPreview(group.blocks.map((block) => block.content).join('')),
      }
    }

    if (group.kind === 'thinking') {
      return {
        kind: 'thinking',
        preview: getPreview(group.blocks.map((block) => block.content).join('\n\n')),
      }
    }

    if (group.kind === 'tool_single') {
      return {
        kind: 'tool_single',
        toolName: group.block.name,
        status: group.block.status,
      }
    }

    return {
      kind: 'tool_group',
      toolNames: group.blocks.map((block) => block.name),
      statuses: group.blocks.map((block) => block.status),
    }
  })
}

export function createBlocksSignature(blocks: MessageBlock[] | undefined): string {
  return JSON.stringify({
    blocks: summarizeBlocks(blocks),
    groups: summarizeGroups(blocks),
  })
}

export function logChatStream(scope: string, payload: Record<string, unknown>): void {
  if (!isChatStreamDebugEnabled()) return
  // eslint-disable-next-line no-console
  console.debug(`[chat-stream] ${scope}`, payload)
}

export function previewStreamContent(content: string | undefined): string {
  return getPreview(content, 48)
}

export function previewUnknown(value: unknown): string {
  if (typeof value === 'string') return previewStreamContent(value)

  try {
    return previewStreamContent(JSON.stringify(value))
  } catch {
    return previewStreamContent(String(value))
  }
}
