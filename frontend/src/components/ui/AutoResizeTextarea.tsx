import { type ClipboardEvent, type KeyboardEvent } from 'react'
import { useAutoResize } from '../../hooks/useAutoResize'

interface AutoResizeTextareaProps {
  /** 当前输入内容 */
  value: string
  /** 内容变化回调 */
  onChange: (value: string) => void
  /** 发送回调（按 Enter 时触发） */
  onSend: () => void
  /** 切换 plan 模式 */
  onToggleThinking: () => void
  /** 占位文字 */
  placeholder?: string
  /** 最大可见行数 */
  maxRows?: number
  /** 额外样式 */
  className?: string
  /** 布局变化（是否多行 / 是否超出最大行） */
  onLayoutChange?: (state: { multiline: boolean; overflowing: boolean }) => void
  /** 是否禁用输入 */
  disabled?: boolean
  /** 粘贴事件 */
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void
}

/**
 * 自动伸展文本输入区域
 *
 * - 使用 useAutoResize 自动调整高度
 * - Enter 触发发送，Shift+Enter 换行
 * - 去除默认浏览器样式，完全由外部容器控制外观
 */
export function AutoResizeTextarea({
  value,
  onChange,
  onSend,
  onToggleThinking,
  placeholder = '有什么我可以帮你的？',
  maxRows = 10,
  className,
  onLayoutChange,
  disabled = false,
  onPaste,
}: AutoResizeTextareaProps) {
  const textareaRef = useAutoResize(value, maxRows, onLayoutChange)

  /** 键盘事件：Enter 发送，Shift+Enter 换行，Shift+Tab 切换模式 */
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Tab' && e.shiftKey) {
      e.preventDefault()
      if (!disabled) onToggleThinking()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey) {
      e.preventDefault()
      // 禁用态（流式输出中）仅阻止发送，不阻止打字
      if (!disabled) onSend()
      return
    }
  }

  return (
    <textarea
      ref={textareaRef}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={handleKeyDown}
      onPaste={onPaste}
      placeholder={placeholder}
      rows={1}
      className={[
        'chat-scrollbar w-full resize-none border-0 outline-none bg-transparent',
        'text-text-primary placeholder:text-text-muted',
        'leading-6 text-base',
        className ?? 'px-4 py-3',
      ].join(' ')}
    />
  )
}
