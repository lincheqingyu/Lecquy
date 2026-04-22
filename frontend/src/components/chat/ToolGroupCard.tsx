import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'
import type { MessageToolCallBlock } from '../../lib/message-blocks'
import { shouldRenderToolCallCard, ToolCallCard } from './ToolCallCard'

interface ToolGroupCardProps {
  blocks: MessageToolCallBlock[]
  collapsed: boolean
  onToggleGroup: () => void
  onToggleToolCall: (blockId: string) => void
}

function summarizeGroup(blocks: MessageToolCallBlock[]): string {
  const runningCount = blocks.filter((block) => block.status === 'running').length
  const errorCount = blocks.filter((block) => block.status === 'error').length
  const unknownCount = blocks.filter((block) => block.status === 'unknown').length
  const successCount = blocks.filter((block) => block.status === 'success').length

  if (runningCount > 0) {
    return `${blocks.length} 个操作，${runningCount} 个仍在执行`
  }
  if (errorCount > 0) {
    return `${blocks.length} 个操作，${errorCount} 个失败`
  }
  // 全是 unknown（历史加载且后端未回填 status）时不报"完成"字样，避免误导
  if (unknownCount === blocks.length) {
    return `${blocks.length} 个操作`
  }
  return `${blocks.length} 个操作，${successCount + unknownCount} 个已完成`
}

export function ToolGroupCard({
  blocks,
  collapsed,
  onToggleGroup,
  onToggleToolCall,
}: ToolGroupCardProps) {
  const visibleBlocks = blocks.filter(shouldRenderToolCallCard)
  if (visibleBlocks.length === 0) return null

  // unknown 不视作 error —— 历史消息不该把整组标红
  const hasError = visibleBlocks.some((block) => block.status === 'error')

  return (
    <div className="my-2 border-l-2 border-border pl-2">
      <button
        type="button"
        onClick={onToggleGroup}
        className="flex w-full items-center gap-2 py-1 text-left text-[13px] text-text-secondary"
      >
        <ChevronDown
          className={clsx(
            'size-3.5 shrink-0 transition-transform',
            !collapsed && 'rotate-180',
          )}
        />
        <span className={clsx('truncate', hasError && 'font-medium text-[#b44a4a] dark:text-[#f2b8b8]')}>
          {summarizeGroup(visibleBlocks)}
        </span>
      </button>

      {!collapsed && (
        <div className="mt-0.5">
          {visibleBlocks.map((block) => (
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
