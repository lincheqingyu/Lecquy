import clsx from 'clsx'
import { Check, ChevronDown, ChevronUp, Copy, ListTodo, Sparkles } from 'lucide-react'
import { useEffect, useRef, useState, type FocusEvent, type ReactNode } from 'react'
import { StreamdownMarkdown } from './StreamdownMarkdown'
import { UserMessageBubble } from './UserMessageBubble'
import type { ChatMessage } from '../../hooks/useChat'
import { buildAttachmentPreviewUrl } from '../../lib/chat-attachments'
import {
  createBlocksSignature,
  logChatStream,
  previewStreamContent,
  summarizeBlocks,
  summarizeGroups,
} from '../../lib/chat-stream-debug'
import {
  blocksToText,
  blocksToThinkingText,
  groupMessageBlocks,
  TOOL_GROUP_THRESHOLD,
  type MessageToolCallBlock,
  type MessageThinkingBlock,
} from '../../lib/message-blocks'
import type { ChatAttachment } from '@lecquy/shared'
import {
  ArtifactOperationCard,
  buildFileOperationEntries,
  type ArtifactOperationEntry,
} from '../artifacts/ArtifactTrace'
import {
  AttachmentFileCard,
  CHAT_ATTACHMENT_CARD_BODY_CLASS,
  CHAT_ATTACHMENT_CARD_PREVIEW_CLASS,
  CHAT_ATTACHMENT_CARD_SIZE_CLASS,
} from '../files/AttachmentFileCard'
import { findLatestArtifact, type ChatArtifact } from '../../lib/artifacts'
import { shouldRenderToolCallCard, ToolCallCard } from './ToolCallCard'
import { ToolGroupCard } from './ToolGroupCard'
import { TimelineEvent } from './TimelineEvent'

interface MessageItemProps {
  message: ChatMessage
  isLastAssistant?: boolean
  onResendUser?: (messageId: string) => void
  onEditUser?: (messageId: string, nextContent: string) => void
  onToggleThinking?: (messageId: string, groupKey?: string) => void
  onToggleTodo?: (messageId: string) => void
  onTogglePlanTask?: (messageId: string, todoIndex: number) => void
  onToggleToolCall?: (messageId: string, blockId: string) => void
  onToggleToolGroup?: (messageId: string, groupKey: string) => void
  onOpenAttachment?: (messageId: string, attachmentIndex: number, attachment: ChatAttachment) => void
  onOpenArtifact?: (messageId: string, artifactIndex: number, artifact: ChatArtifact) => void
  activeAttachmentKey?: string | null
}

const THOUGHT_TIMER_INTERVAL_MS = 100

function formatAttachmentMeta(attachment: ChatAttachment): string {
  const sizeLabel = attachment.size ? `${Math.max(1, Math.round(attachment.size / 1024))} KB` : null

  if (attachment.kind === 'image') {
    return sizeLabel ? `图片 · ${sizeLabel}` : '图片'
  }

  const mime = attachment.mimeType.toLowerCase()
  let typeLabel = '文档'
  if (mime.includes('pdf')) typeLabel = 'PDF'
  else if (mime.includes('wordprocessingml')) typeLabel = 'DOCX'
  else if (mime.includes('spreadsheetml') || mime.includes('ms-excel')) typeLabel = 'Excel'
  else if (mime.includes('markdown')) typeLabel = 'Markdown'
  else if (mime.includes('json')) typeLabel = 'JSON'
  else if (mime.startsWith('text/')) typeLabel = '文本'

  return sizeLabel ? `${typeLabel} · ${sizeLabel}` : typeLabel
}

function isPlainThoughtText(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return true

  return !(
    /```/.test(normalized)
    || /(^|\n)\s*#{1,6}\s+/m.test(normalized)
    || /(^|\n)\s*>\s+/m.test(normalized)
    || /(^|\n)\s*[-*]\s+/m.test(normalized)
    || /(^|\n)\s*\d+\.\s+/m.test(normalized)
    || /(^|\n)\s*\|.+\|\s*$/m.test(normalized)
    || /\[[^\]]+\]\([^)]+\)/.test(normalized)
    || /`[^`]+`/.test(normalized)
    || /\*\*[^*]+\*\*/.test(normalized)
    || /~~[^~]+~~/.test(normalized)
    || /!\[[^\]]*\]\([^)]+\)/.test(normalized)
  )
}

function summarizeTodo(items: NonNullable<ChatMessage['todoItems']>) {
  const completed = items.filter((item) => item.status === 'completed').length
  const inProgress = items.filter((item) => item.status === 'in_progress').length
  const total = items.length
  return {
    label: `已完成 ${completed}/${total} 步`,
    detail: inProgress > 0 ? `进行中 ${inProgress} 项` : total === completed ? '全部已完成' : '等待执行',
  }
}

function currentTodoFocus(items: NonNullable<ChatMessage['todoItems']>) {
  const active = items.find((item) => item.status === 'in_progress') ?? items.find((item) => item.status === 'pending')
  return active?.content ?? null
}

function getEventLabel(eventType?: string) {
  if (!eventType) return null

  switch (eventType) {
    case 'pause':
      return '需要你补充信息'
    case 'tool_error':
      return '执行异常'
    case 'session_tool_result':
      return '会话操作'
    default:
      return null
  }
}

function formatThoughtDuration(durationMs: number): string {
  const safeDuration = Math.max(0, durationMs)
  const hours = Math.floor(safeDuration / 3_600_000)
  const minutes = Math.floor((safeDuration % 3_600_000) / 60_000)
  const seconds = (safeDuration % 60_000) / 1000

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${seconds.toFixed(1).padStart(4, '0')}s`
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds.toFixed(1).padStart(4, '0')}s`
  }

  return `${seconds.toFixed(1)}s`
}

function resolveThinkingDurationMs(
  blocks: MessageThinkingBlock[],
  currentTimeMs: number,
  fallback?: ChatMessage['thoughtTiming'],
): number | undefined {
  const startedAt = blocks.find((block) => typeof block.startedAt === 'number')?.startedAt
  const runningBlock = blocks.find((block) => block.status === 'running')
  if (runningBlock && typeof runningBlock.startedAt === 'number') {
    return Math.max(0, currentTimeMs - runningBlock.startedAt)
  }

  const explicitDuration = [...blocks].reverse().find((block) => typeof block.durationMs === 'number')?.durationMs
  if (typeof explicitDuration === 'number') return explicitDuration

  const endedAt = [...blocks].reverse().find((block) => typeof block.endedAt === 'number')?.endedAt
  if (typeof startedAt === 'number' && typeof endedAt === 'number') {
    return Math.max(0, endedAt - startedAt)
  }

  if (!fallback || typeof startedAt === 'number') return undefined
  if (fallback.status === 'running') {
    return Math.max(0, currentTimeMs - fallback.startedAt)
  }
  if (typeof fallback.durationMs === 'number') return fallback.durationMs
  if (typeof fallback.finishedAt === 'number') {
    return Math.max(0, fallback.finishedAt - fallback.startedAt)
  }
  return undefined
}

function formatThinkingDurationLabel(
  blocks: MessageThinkingBlock[],
  currentTimeMs: number,
  fallback?: ChatMessage['thoughtTiming'],
): string | undefined {
  const durationMs = resolveThinkingDurationMs(blocks, currentTimeMs, fallback)
  return typeof durationMs === 'number' ? formatThoughtDuration(durationMs) : undefined
}

function basename(value: string | null | undefined): string | null {
  if (!value) return null
  const normalized = value.replace(/\\/g, '/').replace(/\/+$/, '')
  const segments = normalized.split('/')
  return segments.at(-1) || normalized
}

function extractResultOutputPath(block: MessageToolCallBlock): string | null {
  if (!block.result || typeof block.result !== 'object' || !('details' in block.result)) return null
  const details = (block.result as { details?: unknown }).details
  if (!details || typeof details !== 'object' || !('outputPath' in details)) return null
  const outputPath = (details as { outputPath?: unknown }).outputPath
  return typeof outputPath === 'string' ? outputPath : null
}

function extractArgFilePath(block: MessageToolCallBlock): string | null {
  if (!block.args || typeof block.args !== 'object' || !('file_path' in block.args)) return null
  const filePath = (block.args as { file_path?: unknown }).file_path
  return typeof filePath === 'string' ? filePath : null
}

function matchArtifactEntryToToolBlock(
  block: MessageToolCallBlock,
  entries: ArtifactOperationEntry[],
  usedEntryKeys: Set<string>,
): ArtifactOperationEntry | null {
  if (block.name !== 'write_file' || block.status !== 'success') return null

  const availableEntries = entries.filter((entry) => {
    if (usedEntryKeys.has(entry.key)) return false
    if (entry.trace) return entry.trace.toolName === 'write_file'
    return Boolean(entry.artifact)
  })
  if (availableEntries.length === 0) return null

  const candidateNames = new Set<string>()
  const argFileName = basename(extractArgFilePath(block))
  const outputFileName = basename(extractResultOutputPath(block))
  if (argFileName) candidateNames.add(argFileName)
  if (outputFileName) candidateNames.add(outputFileName)

  if (candidateNames.size === 0) {
    return availableEntries[0] ?? null
  }

  return availableEntries.find((entry) => {
    const traceDetail = basename(entry.trace?.detail)
    const artifactName = basename(entry.artifact?.name)
    const artifactPath = basename(entry.artifact?.filePath)
    return (
      (traceDetail && candidateNames.has(traceDetail))
      || (artifactName && candidateNames.has(artifactName))
      || (artifactPath && candidateNames.has(artifactPath))
    )
  }) ?? availableEntries[0] ?? null
}

export function MessageItem({
  message,
  isLastAssistant: _isLastAssistant = false,
  onResendUser,
  onEditUser,
  onToggleThinking,
  onToggleTodo,
  onTogglePlanTask,
  onToggleToolCall,
  onToggleToolGroup,
  onOpenAttachment,
  onOpenArtifact,
  activeAttachmentKey = null,
}: MessageItemProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isEvent = message.role === 'event'
  const groupedBlocks = groupMessageBlocks(message.blocks ?? [])
  const primaryTextContent = blocksToText(message.blocks).trim() || message.content.trim()
  const hasToolBlocks = groupedBlocks.some((group) => (
    group.kind === 'tool_single'
      ? shouldRenderToolCallCard(group.block)
      : group.kind === 'tool_group'
        ? group.blocks.some(shouldRenderToolCallCard)
        : false
  ))
  const hasThinkingBlocks = (message.blocks ?? []).some((block) => block.kind === 'thinking')
  const hasPrimaryContent = primaryTextContent.length > 0
  const thinkingContent = blocksToThinkingText(message.blocks).trim() || message.thinkingContent?.trim() || ''
  const hasThinkingContent = thinkingContent.length > 0
  const showThoughtsCard = Boolean((isAssistant || isEvent) && hasThinkingContent && !hasThinkingBlocks)
  const hasRunningThinkingBlocks = (message.blocks ?? []).some((block) => block.kind === 'thinking' && block.status === 'running')
  const canCopyMessage = primaryTextContent.length > 0
  const todoItems = message.todoItems ?? []
  const planDetails = message.planDetails ?? {}
  const isPlanPanel = isEvent && (message.eventType === 'plan' || message.eventType === 'todo')
  const eventLabel = getEventLabel(message.eventType)
  const [copied, setCopied] = useState(false)
  const [thoughtCopied, setThoughtCopied] = useState(false)
  const [isActionBarHovered, setIsActionBarHovered] = useState(false)
  const [isActionBarFocused, setIsActionBarFocused] = useState(false)
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now())
  const renderDebugSignatureRef = useRef<string>('')
  const isActionBarVisible = isActionBarHovered || isActionBarFocused
  const attachments = message.attachments ?? []
  const artifacts = message.artifacts ?? []
  const artifactTraceItems = message.artifactTraceItems ?? []
  const fileOperationEntries = buildFileOperationEntries(artifactTraceItems, artifacts)
  const thoughtTiming = message.thoughtTiming
  const hasArtifactOperations = fileOperationEntries.length > 0
  const hasArtifactContent = hasArtifactOperations
  const isMarkdownStreaming = message.stepStatus === 'started' || hasRunningThinkingBlocks || thoughtTiming?.status === 'running'

  const renderMarkdownContent = (content: string, className?: string) => (
    <StreamdownMarkdown
      content={content}
      isAnimating={isMarkdownStreaming}
      className={className}
    />
  )

  useEffect(() => {
    if (!hasRunningThinkingBlocks) return

    setCurrentTimeMs(Date.now())
    const timerId = window.setInterval(() => {
      setCurrentTimeMs(Date.now())
    }, THOUGHT_TIMER_INTERVAL_MS)

    return () => window.clearInterval(timerId)
  }, [hasRunningThinkingBlocks])

  useEffect(() => {
    if (!isAssistant || (message.blocks?.length ?? 0) === 0) return

    const signature = createBlocksSignature(message.blocks)
    if (renderDebugSignatureRef.current === signature) return
    renderDebugSignatureRef.current = signature

    logChatStream('render:assistant-message', {
      messageId: message.id,
      stepId: message.stepId,
      stepStatus: message.stepStatus,
      contentPreview: previewStreamContent(message.content),
      thinkingPreview: previewStreamContent(message.thinkingContent),
      blocks: summarizeBlocks(message.blocks),
      groups: summarizeGroups(message.blocks),
    })
  }, [isAssistant, message.blocks, message.content, message.id, message.stepId, message.stepStatus, message.thinkingContent])

  if (isAssistant && !hasPrimaryContent && !hasToolBlocks && !hasThinkingBlocks && !showThoughtsCard && !hasArtifactContent) {
    return null
  }

  if (isPlanPanel) {
    const summary = summarizeTodo(todoItems)
    const focus = currentTodoFocus(todoItems)
    const completed = todoItems.filter((item) => item.status === 'completed').length
    const total = todoItems.length
    const headerStatus = total === 0 ? '正在生成计划' : `${completed}/${total}`
    const headerDetail =
      total === 0
        ? '正在拆解任务...'
        : focus
          ? `当前：${focus}`
          : summary.detail

    return (
      <div className="flex w-full justify-start">
        <div className="w-full overflow-hidden rounded-[1.35rem] border border-border bg-surface-thought">
          <button
            type="button"
            onClick={() => onToggleTodo?.(message.id)}
            className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-hover/60"
            aria-expanded={message.isTodoExpanded}
            aria-label={message.isTodoExpanded ? '收起计划步骤' : '展开计划步骤'}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex size-6 items-center justify-center rounded-full bg-surface-alt text-accent-text">
                <ListTodo className="size-3.5" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-primary">Plan</div>
                <div className="mt-0.5 text-xs text-text-secondary">{headerDetail}</div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-sm text-text-secondary">
              <span>{headerStatus}</span>
              {message.isTodoExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </div>
          </button>

          {message.isTodoExpanded && (
            <div className="border-t border-border bg-surface-alt px-4 py-4">
              {todoItems.length === 0 ? (
                <div className="text-sm text-text-secondary">正在生成任务列表...</div>
              ) : (
                <div className="space-y-4">
                  {todoItems.map((item, index) => {
                    const detail = planDetails[index]
                    const taskSummary = detail?.content?.trim() || item.result?.trim() || ''
                    const hasTaskSummary = Boolean(taskSummary)
                    const isTaskExpanded = message.expandedPlanTaskIndexes?.includes(index) ?? false

                    return (
                      <div key={`${item.content}_${index}`} className="overflow-hidden rounded-[1.1rem] border border-border/80 bg-surface-thought">
                        <button
                          type="button"
                          onClick={() => onTogglePlanTask?.(message.id, index)}
                          className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-hover/35"
                          aria-expanded={isTaskExpanded}
                          aria-label={isTaskExpanded ? '收起任务详情' : '展开任务详情'}
                        >
                          <span className={clsx(
                            'mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                            item.status === 'completed' && 'border-border bg-surface-thought text-text-primary',
                            item.status === 'in_progress' && 'border-accent text-accent-text',
                            item.status === 'pending' && 'border-border text-text-muted',
                          )}>
                            {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '>' : ''}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className={clsx(
                              'text-sm leading-relaxed',
                              item.status === 'completed' ? 'text-text-primary' : item.status === 'in_progress' ? 'font-medium text-text-primary' : 'text-text-secondary',
                            )}>
                              {item.content}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 pt-0.5 text-sm text-text-secondary">
                            {isTaskExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                          </div>
                        </button>

                        {isTaskExpanded && (
                          <div className="border-t border-border/80 px-4 py-3">
                            {hasTaskSummary ? (
                                <div className="space-y-3">
                                  <div className="px-1 text-text-primary">
                                    {renderMarkdownContent(taskSummary)}
                                  </div>
                                </div>
                            ) : (
                              <div className="text-sm text-text-secondary">
                                {item.status === 'pending' ? '等待执行' : item.status === 'in_progress' ? '正在执行...' : '已完成'}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(primaryTextContent)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  const handleCopyThoughts = async (content: string) => {
    if (!content.trim()) return

    try {
      await navigator.clipboard.writeText(content)
      setThoughtCopied(true)
      window.setTimeout(() => setThoughtCopied(false), 1200)
    } catch {
      setThoughtCopied(false)
    }
  }

  const handleActionAreaBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextFocusTarget = event.relatedTarget
    if (nextFocusTarget instanceof Node && event.currentTarget.contains(nextFocusTarget)) {
      return
    }
    setIsActionBarFocused(false)
  }

  const handleOpenTraceArtifact = (artifact: ChatArtifact) => {
    const latest = findLatestArtifact(artifacts, artifact)
    if (!latest) return
    onOpenArtifact?.(message.id, latest.artifactIndex, latest.artifact)
  }

  const renderAttachments = () => {
    if (attachments.length === 0) return null

    return (
      <div className={clsx('mb-2.5 flex flex-col gap-2', isUser ? 'items-end' : 'items-start')}>
        {attachments.map((attachment, index) => (
          attachment.kind === 'image' ? (
            <button
              key={`${attachment.name}_${index}`}
              type="button"
              onClick={() => onOpenAttachment?.(message.id, index, attachment)}
              title={attachment.name}
              className={clsx(
                'group flex flex-col overflow-hidden rounded-[1.25rem] border bg-surface-thought text-left shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition-all',
                'dark:border-[#5a5a55] dark:bg-[rgb(38,38,36)] dark:shadow-[0_12px_28px_rgba(0,0,0,0.24)]',
                CHAT_ATTACHMENT_CARD_SIZE_CLASS,
                'hover:-translate-y-0.5 hover:border-[color:var(--border-strong)] hover:shadow-[0_14px_34px_rgba(15,23,42,0.10)] dark:hover:shadow-[0_16px_34px_rgba(0,0,0,0.34)]',
                activeAttachmentKey === `${message.id}:${index}`
                  ? 'border-[color:var(--border-strong)] shadow-[0_14px_34px_rgba(15,23,42,0.10)] dark:shadow-[0_16px_34px_rgba(0,0,0,0.34)]'
                  : 'border-border',
              )}
            >
              <div className={CHAT_ATTACHMENT_CARD_PREVIEW_CLASS}>
                <img
                  src={buildAttachmentPreviewUrl(attachment) ?? ''}
                  alt={attachment.name}
                  className="block h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.02]"
                />
              </div>
              <div className={CHAT_ATTACHMENT_CARD_BODY_CLASS}>
                <div className="truncate text-sm font-medium text-text-primary">{attachment.name}</div>
                <div className="mt-0.5 text-xs text-text-secondary">{formatAttachmentMeta(attachment)}</div>
              </div>
            </button>
          ) : (
            <AttachmentFileCard
              key={`${attachment.name}_${index}`}
              attachment={attachment}
              active={activeAttachmentKey === `${message.id}:${index}`}
              onOpen={() => onOpenAttachment?.(message.id, index, attachment)}
            />
          )
        ))}
      </div>
    )
  }

  const renderInlineArtifactOperation = (entry: ArtifactOperationEntry, key: string) => (
    <div key={key}>
      <ArtifactOperationCard
        entry={entry}
        onOpenArtifact={handleOpenTraceArtifact}
      />
    </div>
  )

  const renderPendingToolBlocks = (
    pendingBlocks: MessageToolCallBlock[],
    keyPrefix: string,
    startIndex: number,
  ): ReactNode[] => {
    if (pendingBlocks.length === 0) return []

    if (pendingBlocks.length >= TOOL_GROUP_THRESHOLD) {
      const groupKey = `${keyPrefix}:tool-group:${startIndex}:${pendingBlocks.length}`
      const collapsed = message.collapsedToolGroupKeys?.includes(groupKey) ?? false
      return [
        <ToolGroupCard
          key={groupKey}
          blocks={pendingBlocks}
          collapsed={collapsed}
          onToggleGroup={() => onToggleToolGroup?.(message.id, groupKey)}
          onToggleToolCall={(blockId) => onToggleToolCall?.(message.id, blockId)}
        />,
      ]
    }

    return pendingBlocks.map((block) => (
      <ToolCallCard
        key={`${keyPrefix}:${block.id}`}
        block={block}
        onToggle={() => onToggleToolCall?.(message.id, block.id)}
      />
    ))
  }

  const renderToolTimelineEntries = (
    blocks: MessageToolCallBlock[],
    keyPrefix: string,
    usedEntryKeys: Set<string>,
  ): ReactNode[] => {
    const nodes: ReactNode[] = []
    let pendingVisibleBlocks: MessageToolCallBlock[] = []
    let pendingStartIndex = 0

    const flushPending = () => {
      if (pendingVisibleBlocks.length === 0) return
      nodes.push(...renderPendingToolBlocks(pendingVisibleBlocks, keyPrefix, pendingStartIndex))
      pendingVisibleBlocks = []
    }

    blocks.forEach((block, index) => {
      const matchedEntry = matchArtifactEntryToToolBlock(block, fileOperationEntries, usedEntryKeys)
      if (matchedEntry) {
        flushPending()
        usedEntryKeys.add(matchedEntry.key)
        nodes.push(renderInlineArtifactOperation(matchedEntry, `${keyPrefix}:artifact:${matchedEntry.key}`))
        pendingStartIndex = index + 1
        return
      }

      if (shouldRenderToolCallCard(block)) {
        if (pendingVisibleBlocks.length === 0) {
          pendingStartIndex = index
        }
        pendingVisibleBlocks.push(block)
      }
    })

    flushPending()
    return nodes
  }

  const renderThinkingGroup = (
    content: string,
    durationLabel: string | undefined,
    options?: { showCopyButton?: boolean; groupKey?: string; expanded?: boolean },
  ) => {
    const expanded = options?.expanded ?? message.isThinkingExpanded
    const copyAction = options?.showCopyButton && expanded ? (
      <button
        type="button"
        onClick={() => handleCopyThoughts(content)}
        className="inline-flex size-6 items-center justify-center rounded-md text-text-muted opacity-0 transition-opacity hover:text-text-primary focus-visible:opacity-100 group-hover/thoughts:opacity-100"
        aria-label="复制思考内容"
        title="复制思考内容"
      >
        {thoughtCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
    ) : null

    return (
      <div className="group/thoughts transition-all">
        <TimelineEvent
          icon={<Sparkles />}
          verb={durationLabel ? '思考了' : '思考'}
          target={durationLabel}
          expandable
          expanded={expanded}
          onToggleExpanded={() => onToggleThinking?.(message.id, options?.groupKey)}
          actions={copyAction}
        >
          <div className="select-text">
            {isPlainThoughtText(content) ? (
              <span className="whitespace-pre-wrap break-words select-text">
                {content}
              </span>
            ) : (
              <div className="[&_p]:text-text-secondary [&_li]:text-text-secondary [&_blockquote]:text-text-secondary [&_td]:text-text-secondary [&_code]:text-text-primary">
                {renderMarkdownContent(content)}
              </div>
            )}
          </div>
        </TimelineEvent>
      </div>
    )
  }

  const renderAssistantBlocks = () => {
    if (!isAssistant) return null
    if ((message.blocks?.length ?? 0) === 0 && fileOperationEntries.length === 0) return null

    const usedEntryKeys = new Set<string>()
    return (
      <div className="space-y-1">
        {groupedBlocks.map((group) => {
          if (group.kind === 'text') {
            const content = group.blocks.map((block) => block.content).join('')
            return <div key={group.key}>{renderMarkdownContent(content)}</div>
          }

          if (group.kind === 'thinking') {
            const content = group.blocks.map((block) => block.content).join('\n\n')
            const expanded = !(message.collapsedThinkingGroupKeys?.includes(group.key) ?? false)
            const durationLabel = formatThinkingDurationLabel(group.blocks, currentTimeMs)

            return (
              <div key={group.key}>
                {renderThinkingGroup(
                  content,
                  durationLabel,
                  {
                    showCopyButton: true,
                    groupKey: group.key,
                    expanded,
                  },
                )}
              </div>
            )
          }

          if (group.kind === 'tool_single') {
            const nodes = renderToolTimelineEntries([group.block], `tool-single:${group.block.id}`, usedEntryKeys)
            return nodes.length > 0 ? <div key={group.block.id} className="space-y-1">{nodes}</div> : null
          }

          const nodes = renderToolTimelineEntries(group.blocks, group.key, usedEntryKeys)
          return nodes.length > 0 ? <div key={group.key} className="space-y-1">{nodes}</div> : null
        })}

        {fileOperationEntries
          .filter((entry) => !usedEntryKeys.has(entry.key))
          .map((entry) => renderInlineArtifactOperation(entry, `artifact-fallback:${entry.key}`))}
      </div>
    )
  }

  return (
    <div
      className={clsx(
        'relative flex w-full',
        isAssistant && isActionBarVisible && 'z-10',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      <div
        className={clsx(
          'inline-flex flex-col',
          isUser ? 'max-w-[88%] items-end' : 'w-full max-w-4xl items-start',
        )}
        onPointerEnter={() => setIsActionBarHovered(true)}
        onPointerLeave={() => setIsActionBarHovered(false)}
        onFocusCapture={() => setIsActionBarFocused(true)}
        onBlur={handleActionAreaBlur}
      >
        {attachments.length > 0 && renderAttachments()}

        {(showThoughtsCard || hasPrimaryContent || hasToolBlocks || hasThinkingBlocks || isEvent || hasArtifactContent) && (
          <div
            className={clsx(
              'text-base leading-[1.55]',
              isUser && 'w-fit max-w-full px-0 py-0',
              isAssistant && 'w-full rounded-2xl bg-transparent border-transparent shadow-none px-1 py-1 text-text-primary font-serif-mix',
              isEvent && 'rounded-2xl bg-surface px-4 py-2 text-text-secondary border border-border/80',
              message.role === 'system' && 'rounded-2xl bg-hover text-text-secondary border border-border px-4 py-2',
            )}
          >
            {isEvent && eventLabel && (
              <div className="mb-1 text-xs uppercase tracking-wide text-text-muted">
                {eventLabel}
              </div>
            )}

            {showThoughtsCard && renderThinkingGroup(
              thinkingContent,
              formatThinkingDurationLabel([], currentTimeMs, thoughtTiming),
              { showCopyButton: true, expanded: message.isThinkingExpanded },
            )}

            {isUser ? (
              hasPrimaryContent ? (
                <UserMessageBubble
                  content={primaryTextContent}
                  timestamp={message.timestamp}
                  onResend={onResendUser ? () => onResendUser(message.id) : undefined}
                  onEdit={onEditUser ? (nextContent) => onEditUser(message.id, nextContent) : undefined}
                />
              ) : null
            ) : isAssistant ? (
              (message.blocks?.length || hasArtifactOperations) ? (
                <div className="space-y-1">
                  {!message.blocks?.length && hasPrimaryContent ? renderMarkdownContent(primaryTextContent) : null}
                  {renderAssistantBlocks()}
                </div>
              ) : hasPrimaryContent ? renderMarkdownContent(primaryTextContent) : null
            ) : (
              hasPrimaryContent ? (
                <div className="whitespace-pre-wrap break-words leading-relaxed">{primaryTextContent}</div>
              ) : null
            )}
          </div>
        )}
        {isAssistant && canCopyMessage && (
          <div
            className={clsx(
              'relative mt-0.5 flex h-7 items-center',
              'justify-start pl-1',
            )}
          >
            <div
              className={clsx(
                'relative z-10 flex items-center gap-1 transition-opacity duration-150',
                isActionBarVisible
                  ? 'visible opacity-100 pointer-events-auto'
                  : 'invisible opacity-0 pointer-events-none',
              )}
            >
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-surface-alt text-text-primary transition-colors hover:bg-surface dark:text-white"
                aria-label="复制消息"
                title="复制消息"
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </button>
            </div>
          </div>
        )}

        {/* TODO: 品牌标识暂时禁用，后续重新设计再启用 */}
        {/* {isLastAssistant && (
          <div className="group/brand mt-2 flex items-center gap-2 pl-1">
            <img
              src="/lecquy-mark-nobg.png"
              alt="Lecquy"
              className="size-7 object-contain opacity-30 transition-opacity duration-200 group-hover/brand:opacity-70"
            />
            <span className="text-xs text-text-muted opacity-0 transition-opacity duration-200 group-hover/brand:opacity-100">
              由 Lecquy 驱动的 AI 助手
            </span>
          </div>
        )} */}
      </div>
    </div>
  )
}
