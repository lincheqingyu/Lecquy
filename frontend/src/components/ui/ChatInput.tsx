import clsx from 'clsx'
import { Plus } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { AutoResizeTextarea } from './AutoResizeTextarea'
import { CategoryTags } from './CategoryTags'
import type { ChatMode } from '../../hooks/useChat'

interface ChatInputProps {
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
  onSend: (message: string) => void
  showSuggestions?: boolean
  disabled?: boolean
  disabledReason?: string | null
  rightSlot?: ReactNode
}

/**
 * 聊天输入框编排组件
 *
 * 管理输入状态，组合 AutoResizeTextarea + InputToolbar + CategoryTags。
 * 容器采用圆角 + 阴影样式，hover/focus-within 时阴影增强。
 */
export function ChatInput({
  mode,
  onModeChange,
  onSend,
  showSuggestions = true,
  disabled = false,
  disabledReason = null,
  rightSlot,
}: ChatInputProps) {
  const [message, setMessage] = useState('')
  const [isMultiline, setIsMultiline] = useState(false)

  /** 发送消息（暂时为空操作，后续接入） */
  const handleSend = () => {
    if (disabled || !message.trim()) return
    onSend(message)
    setMessage('')
    setIsMultiline(false)
  }

  /** 点击加号按钮（暂时为空操作，后续接入） */
  const handlePlusClick = () => {
    // TODO: 接入附件/功能菜单
  }

  /** 点击分类标签（暂时填入输入框，后续接入） */
  const handleCategorySelect = (label: string) => {
    // TODO: 接入分类逻辑
    setMessage(label)
  }

  const toggleThinking = () => {
    onModeChange(mode === 'plan' ? 'simple' : 'plan')
  }

  const compact = !showSuggestions

  useEffect(() => {
    if (!message) {
      setIsMultiline(false)
    }
  }, [message])

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div
        className={clsx(
          'relative border border-border bg-surface',
          isMultiline ? 'rounded-[20px]' : compact ? 'rounded-full' : 'rounded-[20px]',
          'shadow-[var(--shadow-input)]',
          'transition-shadow duration-200',
          disabled ? 'opacity-60' : 'hover:shadow-[var(--shadow-input-hover)]',
          !disabled && 'focus-within:shadow-[var(--shadow-input-hover)]',
        )}
      >
        {!isMultiline ? (
          <div className={clsx('flex items-center gap-2', compact ? 'px-4 py-2' : 'px-3 py-3')}>
            <button
              type="button"
              onClick={handlePlusClick}
              className={clsx(
                'flex shrink-0 items-center justify-center',
                'size-8 rounded-full',
                'text-text-secondary transition-colors hover:bg-hover hover:text-text-primary',
              )}
              aria-label="添加附件"
              disabled={disabled}
            >
              <Plus className="size-4" />
            </button>

            <AutoResizeTextarea
              value={message}
              onChange={setMessage}
              onSend={handleSend}
              onToggleThinking={toggleThinking}
              maxRows={10}
              onLayoutChange={({ multiline }) => setIsMultiline(multiline)}
              className={clsx('px-1 py-1', 'max-h-[15rem] min-h-8')}
              disabled={disabled}
            />
            {rightSlot && <div className="shrink-0">{rightSlot}</div>}
          </div>
        ) : (
          <div className={clsx('px-3 pt-3 pb-2')}>
            <AutoResizeTextarea
              value={message}
              onChange={setMessage}
              onSend={handleSend}
              onToggleThinking={toggleThinking}
              maxRows={10}
              onLayoutChange={({ multiline }) => setIsMultiline(multiline)}
              className={clsx('px-1 py-0', 'max-h-[15rem] min-h-8')}
              disabled={disabled}
            />
            <div className="mt-1 flex h-8 items-center justify-between px-1">
              <button
                type="button"
                onClick={handlePlusClick}
                className={clsx(
                  'flex shrink-0 items-center justify-center',
                  'size-7 rounded-md',
                  'text-text-secondary transition-colors hover:bg-hover hover:text-text-primary',
                )}
                aria-label="添加附件"
                disabled={disabled}
              >
                <Plus className="size-4" />
              </button>
              {rightSlot && <div className="shrink-0">{rightSlot}</div>}
            </div>
          </div>
        )}

        {mode === 'plan' && (
          <button
            type="button"
            onClick={() => onModeChange('simple')}
            className="absolute -top-3 left-4 rounded-full border border-border bg-surface px-2 py-1 text-xs text-text-secondary shadow-sm"
            aria-label="关闭 plan 模式"
          >
            plan
          </button>
        )}
      </div>

      {disabledReason && (
        <div className="mt-2 text-center text-xs text-text-muted">
          {disabledReason}
        </div>
      )}

      {/* 分类标签（输入框下方） */}
      {showSuggestions && <CategoryTags onSelect={handleCategorySelect} />}
    </div>
  )
}
