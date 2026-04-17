import clsx from 'clsx'
import { Check, ChevronDown, ChevronUp, Copy, ListTodo, RotateCcw, Sparkles } from 'lucide-react'
import { useEffect, useState, type FocusEvent } from 'react'
import { StreamdownMarkdown } from './StreamdownMarkdown'
import type { ChatMessage } from '../../hooks/useChat'
import { buildAttachmentPreviewUrl } from '../../lib/chat-attachments'
import { blocksToText, groupMessageBlocks } from '../../lib/message-blocks'
import type { ChatAttachment } from '@lecquy/shared'
import { ArtifactCard } from '../artifacts/ArtifactCard'
import { ArtifactTrace } from '../artifacts/ArtifactTrace'
import {
  AttachmentFileCard,
  CHAT_ATTACHMENT_CARD_BODY_CLASS,
  CHAT_ATTACHMENT_CARD_PREVIEW_CLASS,
  CHAT_ATTACHMENT_CARD_SIZE_CLASS,
} from '../files/AttachmentFileCard'
import type { ChatArtifact } from '../../lib/artifacts'
import { ToolCallCard } from './ToolCallCard'
import { ToolGroupCard } from './ToolGroupCard'

interface MessageItemProps {
  message: ChatMessage
  isLastAssistant?: boolean
  onResendUser?: (messageId: string) => void
  onToggleThinking?: (messageId: string) => void
  onToggleTodo?: (messageId: string) => void
  onTogglePlanTask?: (messageId: string, todoIndex: number) => void
  onToggleToolCall?: (messageId: string, blockId: string) => void
  onToggleToolGroup?: (messageId: string, groupKey: string) => void
  onOpenAttachment?: (messageId: string, attachmentIndex: number, attachment: ChatAttachment) => void
  onOpenArtifact?: (messageId: string, artifactIndex: number, artifact: ChatArtifact) => void
  onDownloadArtifact?: (artifact: ChatArtifact) => void
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

export function MessageItem({
  message,
  isLastAssistant: _isLastAssistant = false,
  onResendUser,
  onToggleThinking,
  onToggleTodo,
  onTogglePlanTask,
  onToggleToolCall,
  onToggleToolGroup,
  onOpenAttachment,
  onOpenArtifact,
  onDownloadArtifact,
  activeAttachmentKey = null,
}: MessageItemProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isEvent = message.role === 'event'
  const primaryTextContent = blocksToText(message.blocks).trim() || message.content.trim()
  const hasToolBlocks = (message.blocks ?? []).some((block) => block.kind === 'tool_call')
  const hasPrimaryContent = primaryTextContent.length > 0
  const hasThinkingContent = Boolean(message.hasThinking && message.thinkingContent?.trim())
  const showThoughtsCard = Boolean((isAssistant || isEvent) && hasThinkingContent)
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
  const isActionBarVisible = isActionBarHovered || isActionBarFocused
  const attachments = message.attachments ?? []
  const artifacts = message.artifacts ?? []
  const artifactTraceItems = message.artifactTraceItems ?? []
  const thoughtTiming = message.thoughtTiming
  const readyArtifacts = artifacts
    .map((artifact, index) => ({ artifact, index }))
    .filter(({ artifact }) => artifact.status !== 'draft')
  const hasArtifactOperations = artifactTraceItems.length > 0 || artifacts.some((artifact) => artifact.status === 'draft' || Boolean(artifact.content))
  const canRenderReadyArtifacts = readyArtifacts.length > 0 && message.stepStatus !== 'started'
  const hasArtifactContent = hasArtifactOperations || canRenderReadyArtifacts
  const thinkingContent = message.thinkingContent ?? ''
  const isPlainThoughtContent = isPlainThoughtText(thinkingContent)
  const isMarkdownStreaming = message.stepStatus === 'started' || thoughtTiming?.status === 'running'

  const renderMarkdownContent = (content: string, className?: string) => (
    <StreamdownMarkdown
      content={content}
      isAnimating={isMarkdownStreaming}
      className={className}
    />
  )

  useEffect(() => {
    if (thoughtTiming?.status !== 'running') return

    setCurrentTimeMs(Date.now())
    const timerId = window.setInterval(() => {
      setCurrentTimeMs(Date.now())
    }, THOUGHT_TIMER_INTERVAL_MS)

    return () => window.clearInterval(timerId)
  }, [thoughtTiming?.startedAt, thoughtTiming?.status])

  const thoughtDurationMs = thoughtTiming
    ? thoughtTiming.status === 'running'
      ? Math.max(0, currentTimeMs - thoughtTiming.startedAt)
      : thoughtTiming.durationMs ?? (
        typeof thoughtTiming.finishedAt === 'number'
          ? Math.max(0, thoughtTiming.finishedAt - thoughtTiming.startedAt)
          : undefined
      )
    : undefined
  const thoughtDurationLabel = typeof thoughtDurationMs === 'number'
    ? formatThoughtDuration(thoughtDurationMs)
    : null

  if (isAssistant && !hasPrimaryContent && !hasToolBlocks && !showThoughtsCard && !hasArtifactContent) {
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

  const handleCopyThoughts = async () => {
    if (!thinkingContent.trim()) return

    try {
      await navigator.clipboard.writeText(thinkingContent)
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
    const artifactIndex = artifacts.findIndex((candidate) =>
      candidate.artifactId === artifact.artifactId
      || (
        candidate.status !== 'draft'
        && artifact.status !== 'draft'
        && candidate.filePath === artifact.filePath
      ),
    )
    if (artifactIndex < 0) return
    onOpenArtifact?.(message.id, artifactIndex, artifact)
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

  const renderArtifactOperations = () => {
    if (!hasArtifactOperations) return null

    return (
      <div className="mt-3 mb-4">
        <ArtifactTrace
          items={artifactTraceItems}
          artifacts={artifacts}
          onOpenArtifact={handleOpenTraceArtifact}
        />
      </div>
    )
  }

  const renderReadyArtifactCards = () => {
    if (!canRenderReadyArtifacts) return null

    return (
      <div className="mt-3 flex flex-col gap-3">
        {readyArtifacts.map(({ artifact, index }) => (
          <ArtifactCard
            key={artifact.artifactId}
            artifact={artifact}
            active={activeAttachmentKey === `${message.id}:artifact:${index}`}
            onOpen={() => onOpenArtifact?.(message.id, index, artifact)}
            onDownload={() => onDownloadArtifact?.(artifact)}
          />
        ))}
      </div>
    )
  }

  const renderAssistantBlocks = () => {
    if (!isAssistant || (message.blocks?.length ?? 0) === 0) return null

    return (
      <div className="space-y-2">
        {groupMessageBlocks(message.blocks ?? []).map((group) => {
          if (group.kind === 'text') {
            return <div key={group.block.id}>{renderMarkdownContent(group.block.content)}</div>
          }

          if (group.kind === 'tool_single') {
            return (
              <ToolCallCard
                key={group.block.id}
                block={group.block}
                narration={group.narration}
                onToggle={() => onToggleToolCall?.(message.id, group.block.id)}
              />
            )
          }

          const collapsed = message.collapsedToolGroupKeys?.includes(group.key) ?? false
          return (
            <ToolGroupCard
              key={group.key}
              blocks={group.blocks}
              narration={group.narration}
              collapsed={collapsed}
              onToggleGroup={() => onToggleToolGroup?.(message.id, group.key)}
              onToggleToolCall={(blockId) => onToggleToolCall?.(message.id, blockId)}
            />
          )
        })}
      </div>
    )
  }

  return (
    <div
      className={clsx(
        'flex w-full',
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

        {(showThoughtsCard || hasPrimaryContent || hasToolBlocks || isEvent || hasArtifactContent) && (
          <div
            className={clsx(
              // 对话区放大字号 + 收紧行距：text-base(16) / leading-[1.55]
              'rounded-2xl px-4 py-2 text-base leading-[1.55]',
              // 用户/AI 正文与思考统一挂衬线字族；事件/系统保持无衬线
              isUser && hasPrimaryContent && 'w-fit bg-user-bubble text-text-primary border border-border/70 font-serif-mix',
              isAssistant && 'w-full bg-transparent border-transparent shadow-none text-text-primary px-1 py-1 font-serif-mix',
              isEvent && 'bg-surface text-text-secondary border border-border/80',
              message.role === 'system' && 'bg-hover text-text-secondary border border-border',
            )}
          >
            {isEvent && eventLabel && (
              <div className="mb-1 text-xs uppercase tracking-wide text-text-muted">
                {eventLabel}
              </div>
            )}

            {showThoughtsCard && (
              <div className="group/thoughts mb-3 transition-all">
                {/* 折叠/展开头：一行低调 section header */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onToggleThinking?.(message.id)}
                    className="inline-flex items-center gap-1.5 rounded-md py-1 text-[13px] text-text-secondary transition-colors hover:text-text-primary"
                    aria-expanded={message.isThinkingExpanded}
                    aria-label={message.isThinkingExpanded ? '隐藏思考内容' : '展开查看模型思考'}
                  >
                    <Sparkles className="size-3.5" />
                    <span>
                      {thoughtDurationLabel ? `思考了 ${thoughtDurationLabel}` : '思考中…'}
                    </span>
                    {message.isThinkingExpanded ? (
                      <ChevronUp className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                  </button>

                  {/* 复制按钮：仅在展开且悬停时显示，不占折叠态空间 */}
                  {message.isThinkingExpanded && (
                    <button
                      type="button"
                      onClick={handleCopyThoughts}
                      className="ml-0.5 inline-flex size-6 items-center justify-center rounded-md text-text-muted opacity-0 transition-opacity hover:text-text-primary group-hover/thoughts:opacity-100"
                      aria-label="复制思考内容"
                      title="复制思考内容"
                    >
                      {thoughtCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
                    </button>
                  )}
                </div>

                {/* 展开内容区：左侧引导线而非外框 */}
                {message.isThinkingExpanded && (
                  <div className="mt-1.5 border-l-2 border-border pl-3 text-[14px] leading-[1.55] text-text-secondary select-text">
                    {isPlainThoughtContent ? (
                      <span className="whitespace-pre-wrap break-words select-text">
                        {thinkingContent}
                      </span>
                    ) : (
                      <div className="[&_p]:text-text-secondary [&_li]:text-text-secondary [&_blockquote]:text-text-secondary [&_td]:text-text-secondary [&_code]:text-text-primary">
                        {renderMarkdownContent(thinkingContent)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {isAssistant && renderArtifactOperations()}

            {isAssistant ? (
              message.blocks?.length ? renderAssistantBlocks() : hasPrimaryContent ? renderMarkdownContent(primaryTextContent) : null
            ) : (
              hasPrimaryContent ? (
                <div className="whitespace-pre-wrap break-words leading-relaxed">{primaryTextContent}</div>
              ) : null
            )}

            {isAssistant && renderReadyArtifactCards()}
          </div>
        )}
        {(isUser || isAssistant) && canCopyMessage && (
          <div
            className={clsx(
              'mt-0.5 flex h-7 items-center',
              isUser ? 'justify-end pr-0.5' : 'justify-start pl-1',
            )}
          >
            <div
              className={clsx(
                'flex items-center gap-1 transition-opacity duration-150',
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
              {isUser && onResendUser && (
                <button
                  type="button"
                  onClick={() => onResendUser(message.id)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-surface-alt text-text-primary transition-colors hover:bg-surface dark:text-white"
                  aria-label="重新发送问题"
                  title="重新发送问题"
                >
                  <RotateCcw className="size-3.5" />
                </button>
              )}
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
