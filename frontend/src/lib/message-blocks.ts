import { normalizeSessionAssistantContent } from '@lecquy/shared'

export type ToolCallStatus = 'running' | 'success' | 'error' | 'unknown'

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
  | { kind: 'tool_single'; block: MessageToolCallBlock; narration?: MessageTextBlock[] }
  | { kind: 'tool_group'; blocks: MessageToolCallBlock[]; key: string; narration?: MessageTextBlock[] }

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
  let lastToolIndex = -1
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index]?.kind === 'tool_call') {
      lastToolIndex = index
      break
    }
  }

  const groups: RenderGroup[] = []
  let pendingNarration: MessageTextBlock[] = []
  let currentToolBlocks: MessageToolCallBlock[] = []

  const flushToolBlocks = () => {
    if (currentToolBlocks.length === 0) {
      return
    }

    const narration = pendingNarration.length > 0 ? pendingNarration : undefined
    if (currentToolBlocks.length >= TOOL_GROUP_THRESHOLD) {
      groups.push({
        kind: 'tool_group',
        blocks: currentToolBlocks,
        key: getToolGroupKey(currentToolBlocks),
        narration,
      })
    } else if (currentToolBlocks.length === 1) {
      groups.push({
        kind: 'tool_single',
        block: currentToolBlocks[0],
        narration,
      })
    } else {
      currentToolBlocks.forEach((block, index) => {
        groups.push({
          kind: 'tool_single',
          block,
          narration: index === 0 ? narration : undefined,
        })
      })
    }

    currentToolBlocks = []
    pendingNarration = []
  }

  blocks.forEach((block, index) => {
    if (block.kind === 'text' && !block.content.trim()) {
      return
    }

    if (block.kind === 'tool_call') {
      currentToolBlocks.push(block)
      return
    }

    if (lastToolIndex >= 0 && index > lastToolIndex) {
      flushToolBlocks()
      groups.push({ kind: 'text', block })
      return
    }

    if (lastToolIndex < 0) {
      groups.push({ kind: 'text', block })
      return
    }

    if (currentToolBlocks.length > 0) {
      flushToolBlocks()
    }

    pendingNarration.push(block)
  })

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
      blocks = [
        ...blocks,
        {
          kind: 'tool_call',
          id: part.id,
          name: part.name,
          args: part.arguments,
          status: part.status ?? 'unknown',
          errorMessage: part.errorMessage,
          errorDetail: part.errorDetail,
          startedAt: part.startedAt,
          endedAt: part.endedAt,
        },
      ]
    }
  }

  return {
    blocks,
    thinkingContent: thinkingParts.join('\n\n'),
  }
}
