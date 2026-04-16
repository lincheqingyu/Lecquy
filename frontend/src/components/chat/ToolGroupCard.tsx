import clsx from 'clsx'
import { ChevronDown } from 'lucide-react'
import type { MessageTextBlock, MessageToolCallBlock } from '../../lib/message-blocks'
import { ToolCallCard, ToolNarration } from './ToolCallCard'

interface ToolGroupCardProps {
  blocks: MessageToolCallBlock[]
  collapsed: boolean
  narration?: MessageTextBlock[]
  onToggleGroup: () => void
  onToggleToolCall: (blockId: string) => void
}

function summarizeGroup(blocks: MessageToolCallBlock[]): string {
  const runningCount = blocks.filter((block) => block.status === 'running').length
  const errorCount = blocks.filter((block) => block.status === 'error').length
  const unknownCount = blocks.filter((block) => block.status === 'unknown').length
  const successCount = blocks.filter((block) => block.status === 'success').length

  if (runningCount > 0) {
    return `${blocks.length} 次工具调用，${runningCount} 个仍在执行`
  }
  if (errorCount > 0) {
    return `${blocks.length} 次工具调用，${errorCount} 个失败`
  }
  // 全是 unknown（历史加载且后端未回填 status）时不报"完成"字样，避免误导
  if (unknownCount === blocks.length) {
    return `${blocks.length} 次工具调用`
  }
  return `${blocks.length} 次工具调用，${successCount + unknownCount} 个已完成`
}

export function ToolGroupCard({
  blocks,
  collapsed,
  narration,
  onToggleGroup,
  onToggleToolCall,
}: ToolGroupCardProps) {
  // unknown 不视作 error —— 历史消息不该把整组标红
  const hasError = blocks.some((block) => block.status === 'error')

  return (
    <div className="my-2 border-l-2 border-border pl-2">
      {narration && narration.length > 0 && <ToolNarration blocks={narration} forceVisible={hasError} />}

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
          {summarizeGroup(blocks)}
        </span>
      </button>

      {!collapsed && (
        <div className="mt-0.5">
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
