import clsx from 'clsx'
import { ArrowUp, Plus } from 'lucide-react'

interface InputToolbarProps {
  /** 输入框是否有内容（控制发送按钮状态） */
  hasContent: boolean
  /** 点击附件/加号按钮 */
  onPlusClick: () => void
  /** 点击发送按钮 */
  onSend: () => void
}

/**
 * 输入框底部工具栏
 *
 * 左侧：圆形加号按钮（附件入口）
 * 右侧：发送按钮（有内容时高亮，无内容时禁用态）
 */
export function InputToolbar({ hasContent, onPlusClick, onSend }: InputToolbarProps) {
  return (
    <div className="flex items-center justify-between px-3 pb-3">
      {/* 左侧：加号按钮 */}
      <button
        type="button"
        onClick={onPlusClick}
        className={clsx(
          'flex items-center justify-center',
          'size-8 rounded-full',
          'border border-border',
          'text-text-secondary',
          'transition-colors hover:bg-hover hover:text-text-primary',
        )}
        aria-label="添加附件"
      >
        <Plus className="size-4" />
      </button>

      {/* 右侧：发送按钮 */}
      <button
        type="button"
        onClick={onSend}
        disabled={!hasContent}
        className={clsx(
          'flex items-center justify-center',
          'size-8 rounded-full',
          'transition-colors',
          hasContent
            ? 'bg-accent text-white hover:opacity-90'
            : 'bg-hover text-text-muted cursor-not-allowed',
        )}
        aria-label="发送消息"
      >
        <ArrowUp className="size-4" />
      </button>
    </div>
  )
}
