import clsx from 'clsx'
import { AlertCircle, ChevronDown, LoaderCircle, Wrench } from 'lucide-react'
import type { MessageTextBlock, MessageToolCallBlock } from '../../lib/message-blocks'

interface ToolCallCardProps {
  block: MessageToolCallBlock
  onToggle: () => void
  compact?: boolean
  narration?: MessageTextBlock[]
}

/**
 * 只有失败且存在错误信息 / 详情的卡片才能展开；否则 tool 卡是纯展示单行，避免误导点击。
 */
export function getEffectiveToolCallExpanded(block: MessageToolCallBlock): boolean {
  if (block.status !== 'error') return false
  if (typeof block.manualExpanded === 'boolean') return block.manualExpanded
  return true
}

function hasExpandableDetail(block: MessageToolCallBlock): boolean {
  return block.status === 'error' && Boolean(block.errorMessage || block.errorDetail)
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`
  return `${(durationMs / 1000).toFixed(1)}s`
}

function formatToolTitle(block: MessageToolCallBlock): string {
  if (block.status === 'running') return `正在调用 ${block.name}`
  if (block.status === 'error') return `${block.name} 执行失败`
  // success / unknown 统一文案，避免"勾选"感
  return `已调用 ${block.name}`
}

function ToolStatusIcon({ block }: { block: MessageToolCallBlock }) {
  if (block.status === 'running') {
    return <LoaderCircle className="size-3.5 shrink-0 animate-spin text-text-muted" />
  }
  if (block.status === 'error') {
    return <AlertCircle className="size-3.5 shrink-0 text-[#b44a4a] dark:text-[#f2b8b8]" />
  }
  // success / unknown 使用同一中性图标（Wrench）
  return <Wrench className="size-3.5 shrink-0 text-text-muted" />
}

/**
 * tool 前置解释性文字（narration）。默认低调灰显，失败 tool 的前置 narration 会提亮以突出因果。
 */
export function ToolNarration({
  blocks,
  forceVisible = false,
}: {
  blocks: MessageTextBlock[]
  forceVisible?: boolean
}) {
  if (!blocks.length) return null
  return (
    <div
      className={clsx(
        'mb-1 space-y-1 text-[12.5px] leading-relaxed',
        forceVisible ? 'text-text-secondary' : 'text-text-muted',
      )}
    >
      {blocks.map((block) => (
        <div key={block.id} className="whitespace-pre-wrap">
          {block.content}
        </div>
      ))}
    </div>
  )
}

export function ToolCallCard({ block, onToggle, compact = false, narration }: ToolCallCardProps) {
  const expanded = getEffectiveToolCallExpanded(block)
  const isError = block.status === 'error'
  const expandable = hasExpandableDetail(block)
  const durationLabel = block.status === 'success'
    && typeof block.startedAt === 'number'
    && typeof block.endedAt === 'number'
    ? formatDuration(Math.max(0, block.endedAt - block.startedAt))
    : null

  return (
    <div
      className={clsx(
        compact ? 'my-0.5' : 'my-1',
        isError
          ? 'border-l-2 border-[#b44a4a] bg-transparent pl-2.5 pr-1 py-1 dark:border-[#f2b8b8]'
          : 'py-1',
      )}
    >
      {narration && narration.length > 0 && <ToolNarration blocks={narration} forceVisible={isError} />}

      <button
        type="button"
        onClick={expandable ? onToggle : undefined}
        disabled={!expandable}
        className={clsx(
          'flex w-full items-center gap-2 text-left text-[13px] text-text-secondary',
          !expandable && 'cursor-default',
        )}
      >
        <ToolStatusIcon block={block} />
        <span className={clsx('truncate', isError && 'font-medium text-[#b44a4a] dark:text-[#f2b8b8]')}>
          {formatToolTitle(block)}
        </span>
        {durationLabel && (
          <span className="ml-auto shrink-0 text-[11px] text-text-muted">{durationLabel}</span>
        )}
        {expandable && (
          <ChevronDown
            className={clsx(
              'ml-auto size-3.5 shrink-0 text-text-muted transition-transform',
              durationLabel && 'ml-2',
              expanded && 'rotate-180',
            )}
          />
        )}
      </button>

      {expandable && expanded && (
        <div className="mt-1 space-y-1 pl-5 text-[12.5px] leading-relaxed">
          {block.errorMessage && (
            <div className="text-[#8e3d3d] dark:text-[#f2b8b8]">{block.errorMessage}</div>
          )}
          {block.errorDetail && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11.5px] text-text-muted">
              {block.errorDetail}
            </pre>
          )}
        </div>
      )}
    </div>
  )
}
