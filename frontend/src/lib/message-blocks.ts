import { normalizeSessionAssistantContent } from '@lecquy/shared'

export type ToolCallStatus = 'running' | 'success' | 'error'

export interface MessageTextBlock {
  kind: 'text'
  id: string
  content: string
}

export interface MessageToolCallBlock {
  kind: 'tool_call'
  id: string
  name: string
  args?: unknown
  status: ToolCallStatus
  result?: unknown
  errorMessage?: string
  errorDetail?: string
  startedAt?: number
  endedAt?: number
  manualExpanded?: boolean
}

export type MessageBlock = MessageTextBlock | MessageToolCallBlock

export type RenderGroup =
  | { kind: 'text'; block: MessageTextBlock }
  | { kind: 'tool_single'; block: MessageToolCallBlock }
  | { kind: 'tool_group'; blocks: MessageToolCallBlock[]; key: string }

export const TOOL_GROUP_THRESHOLD = 3

function createBlockId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function createTextBlock(content: string): MessageTextBlock {
  return {
    kind: 'text',
    id: createBlockId('text'),
    content,
  }
}

export function createTextBlocks(content: string): MessageBlock[] {
  return content.length > 0 ? [createTextBlock(content)] : []
}

export function appendTextDelta(blocks: MessageBlock[], delta: string): MessageBlock[] {
  if (!delta) return blocks

  const last = blocks.at(-1)
  if (last?.kind === 'text') {
    return [
      ...blocks.slice(0, -1),
      {
        ...last,
        content: last.content + delta,
      },
    ]
  }

  return [...blocks, createTextBlock(delta)]
}

export function pushToolCallStart(
  blocks: MessageBlock[],
  payload: {
    toolCallId: string
    toolName: string
    args?: unknown
    startedAt?: number
  },
): MessageBlock[] {
  const existingIndex = blocks.findIndex((block) => block.kind === 'tool_call' && block.id === payload.toolCallId)
  const nextBlock: MessageToolCallBlock = {
    kind: 'tool_call',
    id: payload.toolCallId,
    name: payload.toolName,
    args: payload.args,
    status: 'running',
    startedAt: payload.startedAt ?? Date.now(),
  }

  if (existingIndex < 0) {
    return [...blocks, nextBlock]
  }

  return blocks.map((block, index) => {
    if (index !== existingIndex || block.kind !== 'tool_call') return block
    return {
      ...nextBlock,
      ...block,
      name: payload.toolName,
      args: payload.args ?? block.args,
      status: block.status === 'error' || block.status === 'success' ? block.status : 'running',
      startedAt: block.startedAt ?? nextBlock.startedAt,
    }
  })
}

export function patchToolCall(
  blocks: MessageBlock[],
  toolCallId: string,
  patch: Partial<MessageToolCallBlock>,
  fallback?: {
    toolName: string
    status?: ToolCallStatus
    startedAt?: number
  },
): MessageBlock[] {
  let found = false
  const nextBlocks = blocks.map((block) => {
    if (block.kind !== 'tool_call' || block.id !== toolCallId) return block
    found = true
    return {
      ...block,
      ...patch,
    }
  })

  if (found || !fallback) return nextBlocks

  return [
    ...blocks,
    {
      kind: 'tool_call',
      id: toolCallId,
      name: fallback.toolName,
      status: fallback.status ?? 'running',
      startedAt: fallback.startedAt,
      ...patch,
    },
  ]
}

export function blocksToText(blocks: MessageBlock[] | undefined): string {
  return (blocks ?? [])
    .filter((block): block is MessageTextBlock => block.kind === 'text')
    .map((block) => block.content)
    .join('')
}

export function getToolGroupKey(blocks: MessageToolCallBlock[]): string {
  const first = blocks[0]?.id ?? 'group'
  const last = blocks.at(-1)?.id ?? first
  return `${first}:${last}:${blocks.length}`
}

export function groupMessageBlocks(blocks: MessageBlock[]): RenderGroup[] {
  const groups: RenderGroup[] = []
  let currentToolBlocks: MessageToolCallBlock[] = []

  const flushToolBlocks = () => {
    if (currentToolBlocks.length === 0) return
    if (currentToolBlocks.length >= TOOL_GROUP_THRESHOLD) {
      groups.push({
        kind: 'tool_group',
        blocks: currentToolBlocks,
        key: getToolGroupKey(currentToolBlocks),
      })
    } else {
      for (const block of currentToolBlocks) {
        groups.push({ kind: 'tool_single', block })
      }
    }
    currentToolBlocks = []
  }

  for (const block of blocks) {
    if (block.kind === 'tool_call') {
      currentToolBlocks.push(block)
      continue
    }

    flushToolBlocks()
    groups.push({ kind: 'text', block })
  }

  flushToolBlocks()
  return groups
}

export function blocksFromAssistantContent(content: unknown): {
  blocks: MessageBlock[]
  thinkingContent: string
} {
  let blocks: MessageBlock[] = []
  const thinkingParts: string[] = []

  for (const part of normalizeSessionAssistantContent(content)) {
    if (part.type === 'text') {
      blocks = appendTextDelta(blocks, part.text)
      continue
    }

    if (part.type === 'thinking') {
      if (part.thinking.trim()) {
        thinkingParts.push(part.thinking)
      }
      continue
    }

    if (part.type === 'toolCall') {
      blocks = [...blocks, {
        kind: 'tool_call',
        id: part.id,
        name: part.name,
        args: part.arguments,
        status: 'success',
      }]
    }
  }

  return {
    blocks,
    thinkingContent: thinkingParts.join('\n\n'),
  }
}
