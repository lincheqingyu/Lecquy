import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'
import type { MessageToolCallBlock } from '../../lib/message-blocks'
import { ToolCallCard } from './ToolCallCard'

interface ToolGroupCardProps {
  blocks: MessageToolCallBlock[]
  collapsed: boolean
  onToggleGroup: () => void
  onToggleToolCall: (blockId: string) => void
}

function summarizeGroup(blocks: MessageToolCallBlock[]): string {
  const runningCount = blocks.filter((block) => block.status === 'running').length
  const errorCount = blocks.filter((block) => block.status === 'error').length
  const successCount = blocks.filter((block) => block.status === 'success').length

  if (runningCount > 0) {
    return `${blocks.length} 次工具调用，${runningCount} 个仍在执行`
  }
  if (errorCount > 0) {
    return `${blocks.length} 次工具调用，${errorCount} 个失败`
  }
  return `${blocks.length} 次工具调用，${successCount} 个已完成`
}

export function ToolGroupCard({
  blocks,
  collapsed,
  onToggleGroup,
  onToggleToolCall,
}: ToolGroupCardProps) {
  const hasError = blocks.some((block) => block.status === 'error')

  return (
    <div className="my-2 overflow-hidden rounded-2xl border border-border bg-surface-raised/40">
      <button
        type="button"
        onClick={onToggleGroup}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-text-secondary transition-colors hover:bg-surface-raised/60"
      >
        <ChevronDown
          className={clsx(
            'size-3.5 shrink-0 transition-transform',
            !collapsed && 'rotate-180',
          )}
        />
        <span className={clsx('truncate', hasError && 'font-medium text-[#b44a4a] dark:text-[#f2b8b8]')}>
          {summarizeGroup(blocks)}
        </span>
      </button>

      {!collapsed && (
        <div className="border-t border-border px-2 py-2">
          {blocks.map((block) => (
            <ToolCallCard
              key={block.id}
              block={block}
              compact
              onToggle={() => onToggleToolCall(block.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
