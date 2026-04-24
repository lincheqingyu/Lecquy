import { normalizeSessionAssistantContent, type ToolCallErrorDetail } from '@lecquy/shared'

export type ToolCallStatus = 'running' | 'success' | 'error' | 'unknown'

export interface MessageTextBlock {
  kind: 'text'
  id: string
  content: string
}

export interface MessageThinkingBlock {
  kind: 'thinking'
  id: string
  content: string
  status?: 'running' | 'completed' | 'failed'
  startedAt?: number
  endedAt?: number
  durationMs?: number
}

export interface MessageToolCallBlock {
  kind: 'tool_call'
  id: string
  name: string
  args?: unknown
  status: ToolCallStatus
  result?: unknown
  errorMessage?: string
  errorDetail?: ToolCallErrorDetail
  startedAt?: number
  endedAt?: number
  manualExpanded?: boolean
}

export type MessageBlock = MessageTextBlock | MessageThinkingBlock | MessageToolCallBlock

export type RenderGroup =
  | { kind: 'text'; blocks: MessageTextBlock[]; key: string }
  | { kind: 'thinking'; blocks: MessageThinkingBlock[]; key: string }
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

function createThinkingBlock(
  content: string,
  options?: {
    status?: MessageThinkingBlock['status']
    startedAt?: number
    endedAt?: number
    durationMs?: number
  },
): MessageThinkingBlock {
  return {
    kind: 'thinking',
    id: createBlockId('thinking'),
    content,
    status: options?.status,
    startedAt: options?.startedAt,
    endedAt: options?.endedAt,
    durationMs: options?.durationMs,
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

export function appendThinkingDelta(
  blocks: MessageBlock[],
  delta: string,
  options?: {
    startedAt?: number
  },
): MessageBlock[] {
  if (!delta) return blocks

  const last = blocks.at(-1)
  if (last?.kind === 'thinking' && last.status !== 'completed' && last.status !== 'failed') {
    return [
      ...blocks.slice(0, -1),
      {
        ...last,
        content: last.content + delta,
        startedAt: last.startedAt ?? options?.startedAt,
        status: last.status ?? (typeof options?.startedAt === 'number' ? 'running' : undefined),
      },
    ]
  }

  return [
    ...blocks,
    createThinkingBlock(delta, {
      startedAt: options?.startedAt,
      status: typeof options?.startedAt === 'number' ? 'running' : undefined,
    }),
  ]
}

function finalizeThinkingBlock(
  block: MessageThinkingBlock,
  status: 'completed' | 'failed',
  finishedAt: number,
): MessageThinkingBlock {
  const startedAt = block.startedAt
  return {
    ...block,
    status,
    endedAt: finishedAt,
    durationMs: typeof startedAt === 'number'
      ? Math.max(0, finishedAt - startedAt)
      : block.durationMs,
  }
}

export function closeTrailingThinkingBlock(
  blocks: MessageBlock[],
  status: 'completed' | 'failed' = 'completed',
  finishedAt = Date.now(),
): MessageBlock[] {
  const last = blocks.at(-1)
  if (!last || last.kind !== 'thinking' || last.status === 'completed' || last.status === 'failed') {
    return blocks
  }

  return [
    ...blocks.slice(0, -1),
    finalizeThinkingBlock(last, status, finishedAt),
  ]
}

export function finalizeRunningThinkingBlocks(
  blocks: MessageBlock[],
  status: 'completed' | 'failed',
  finishedAt = Date.now(),
): MessageBlock[] {
  return blocks.map((block) => {
    if (block.kind !== 'thinking' || block.status === 'completed' || block.status === 'failed') {
      return block
    }
    return finalizeThinkingBlock(block, status, finishedAt)
  })
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

export function blocksToThinkingText(blocks: MessageBlock[] | undefined): string {
  return (blocks ?? [])
    .filter((block): block is MessageThinkingBlock => block.kind === 'thinking')
    .map((block) => block.content)
    .join('\n\n')
}

export function getToolGroupKey(blocks: MessageToolCallBlock[]): string {
  const first = blocks[0]?.id ?? 'group'
  const last = blocks.at(-1)?.id ?? first
  return `${first}:${last}:${blocks.length}`
}

function getTextGroupKey(blocks: MessageTextBlock[]): string {
  const first = blocks[0]?.id ?? 'text'
  const last = blocks.at(-1)?.id ?? first
  return `${first}:${last}:${blocks.length}`
}

function getThinkingGroupKey(blocks: MessageThinkingBlock[]): string {
  const first = blocks[0]?.id ?? 'thinking'
  const last = blocks.at(-1)?.id ?? first
  return `${first}:${last}:${blocks.length}`
}

export function groupMessageBlocks(blocks: MessageBlock[]): RenderGroup[] {
  const segments: Array<
    | { kind: 'text'; blocks: MessageTextBlock[] }
    | { kind: 'thinking'; blocks: MessageThinkingBlock[] }
    | { kind: 'tool'; blocks: MessageToolCallBlock[] }
  > = []

  const appendSegmentBlock = (block: MessageBlock) => {
    if ((block.kind === 'text' || block.kind === 'thinking') && !block.content.trim()) {
      return
    }

    const lastSegment = segments.at(-1)
    if (!lastSegment) {
      segments.push({
        kind: block.kind === 'tool_call' ? 'tool' : block.kind,
        blocks: [block] as MessageTextBlock[] & MessageThinkingBlock[] & MessageToolCallBlock[],
      })
      return
    }

    const segmentKind = block.kind === 'tool_call' ? 'tool' : block.kind
    if (lastSegment.kind === segmentKind) {
      ;(lastSegment.blocks as MessageBlock[]).push(block)
      return
    }

    segments.push({
      kind: segmentKind,
      blocks: [block] as MessageTextBlock[] & MessageThinkingBlock[] & MessageToolCallBlock[],
    })
  }

  blocks.forEach(appendSegmentBlock)

  const groups: RenderGroup[] = []
  segments.forEach((segment) => {
    if (segment.kind === 'text') {
      groups.push({
        kind: 'text',
        blocks: segment.blocks,
        key: getTextGroupKey(segment.blocks),
      })
      return
    }

    if (segment.kind === 'thinking') {
      groups.push({
        kind: 'thinking',
        blocks: segment.blocks,
        key: getThinkingGroupKey(segment.blocks),
      })
      return
    }

    if (segment.blocks.length >= TOOL_GROUP_THRESHOLD) {
      groups.push({
        kind: 'tool_group',
        blocks: segment.blocks,
        key: getToolGroupKey(segment.blocks),
      })
      return
    }

    if (segment.blocks.length === 1) {
      groups.push({
        kind: 'tool_single',
        block: segment.blocks[0],
      })
      return
    }

    segment.blocks.forEach((block) => {
      groups.push({
        kind: 'tool_single',
        block,
      })
    })
  })

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
        blocks = appendThinkingDelta(blocks, part.thinking)
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
