import clsx from 'clsx'
import { AlertCircle, CheckCircle2, ChevronDown, LoaderCircle, Wrench } from 'lucide-react'
import type { MessageToolCallBlock } from '../../lib/message-blocks'

interface ToolCallCardProps {
  block: MessageToolCallBlock
  onToggle: () => void
  compact?: boolean
}

export function getEffectiveToolCallExpanded(block: MessageToolCallBlock): boolean {
  if (typeof block.manualExpanded === 'boolean') return block.manualExpanded
  return block.status === 'error'
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs}ms`
  return `${(durationMs / 1000).toFixed(1)}s`
}

function formatToolTitle(block: MessageToolCallBlock): string {
  if (block.status === 'running') return `正在执行 ${block.name}…`
  if (block.status === 'error') return `${block.name} 执行失败`
  return block.name
}

function ToolStatusIcon({ block }: { block: MessageToolCallBlock }) {
  if (block.status === 'running') {
    return <LoaderCircle className="size-3.5 shrink-0 animate-spin text-text-secondary" />
  }
  if (block.status === 'error') {
    return <AlertCircle className="size-3.5 shrink-0 text-[#b44a4a]" />
  }
  if (block.name === 'write_file' || block.name === 'edit_file') {
    return <Wrench className="size-3.5 shrink-0 text-text-secondary" />
  }
  return <CheckCircle2 className="size-3.5 shrink-0 text-text-secondary" />
}

function ToolCallBody({ block }: { block: MessageToolCallBlock }) {
  return (
    <div className="space-y-2 py-1">
      {block.status === 'error' && block.errorMessage && (
        <div className="text-[12.5px] text-[#b44a4a]">{block.errorMessage}</div>
      )}

      {block.args !== undefined && (
        <details>
          <summary className="cursor-pointer text-[11.5px] text-text-muted select-none">参数</summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded-lg bg-surface-raised px-2 py-1.5 text-[11.5px] leading-relaxed text-text-secondary">
            {safeStringify(block.args)}
          </pre>
        </details>
      )}

      {block.status === 'success' && block.result !== undefined && (
        <details>
          <summary className="cursor-pointer text-[11.5px] text-text-muted select-none">返回</summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-surface-raised px-2 py-1.5 text-[11.5px] leading-relaxed text-text-secondary">
            {safeStringify(block.result)}
          </pre>
        </details>
      )}

      {block.errorDetail && (
        <details>
          <summary className="cursor-pointer text-[11.5px] text-text-muted select-none">详情</summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded-lg bg-[#fff5f5] px-2 py-1.5 text-[11.5px] leading-relaxed text-[#8e3d3d] dark:bg-[#332727] dark:text-[#f2b8b8]">
            {block.errorDetail}
          </pre>
        </details>
      )}
    </div>
  )
}

export function ToolCallCard({ block, onToggle, compact = false }: ToolCallCardProps) {
  const expanded = getEffectiveToolCallExpanded(block)
  const isError = block.status === 'error'
  const durationLabel = typeof block.startedAt === 'number' && typeof block.endedAt === 'number'
    ? formatDuration(Math.max(0, block.endedAt - block.startedAt))
    : null

  return (
    <div
      className={clsx(
        'overflow-hidden transition-colors',
        compact ? 'my-0.5' : 'my-1',
        isError
          ? 'rounded-xl border border-[#e8c1c1] bg-[#fff7f7] px-2.5 py-1.5 dark:border-[#5f3b3b] dark:bg-[#2d2323]'
          : 'rounded-xl px-2.5 py-1 hover:bg-surface-raised/60',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 text-left text-[13px] text-text-secondary"
      >
        <ToolStatusIcon block={block} />
        <span className={clsx('truncate', isError && 'font-medium text-[#b44a4a] dark:text-[#f2b8b8]')}>
          {formatToolTitle(block)}
        </span>
        {durationLabel && (
          <span className="ml-auto shrink-0 text-[11px] text-text-muted">{durationLabel}</span>
        )}
        <ChevronDown
          className={clsx(
            'size-3.5 shrink-0 text-text-muted transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>

      {expanded && (
        <div className="mt-1.5 border-l-2 border-border pl-2.5">
          <ToolCallBody block={block} />
        </div>
      )}
    </div>
  )
}
