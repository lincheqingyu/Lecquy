import clsx from 'clsx'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { AutoResizeTextarea } from './AutoResizeTextarea'
import { CategoryTags } from './CategoryTags'
import type { ChatMode } from '../../hooks/useChat'

interface ChatInputProps {
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
  onSend: (message: string) => void
  showSuggestions?: boolean
}

/**
 * 聊天输入框编排组件
 *
 * 管理输入状态，组合 AutoResizeTextarea + InputToolbar + CategoryTags。
 * 容器采用圆角 + 阴影样式，hover/focus-within 时阴影增强。
 */
export function ChatInput({ mode, onModeChange, onSend, showSuggestions = true }: ChatInputProps) {
  const [message, setMessage] = useState('')

  /** 发送消息（暂时为空操作，后续接入） */
  const handleSend = () => {
    if (!message.trim()) return
    onSend(message)
    setMessage('')
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
    onModeChange(mode === 'thinking' ? 'simple' : 'thinking')
  }

  const compact = !showSuggestions

  return (
    <div className="mx-auto w-full max-w-3xl">
      <div
        className={clsx(
          'relative border border-border bg-surface',
          compact ? 'rounded-full' : 'rounded-[20px]',
          'shadow-[var(--shadow-input)]',
          'transition-shadow duration-200',
          'hover:shadow-[var(--shadow-input-hover)]',
          'focus-within:shadow-[var(--shadow-input-hover)]',
        )}
      >
        <div className={clsx('flex items-center gap-2', compact ? 'px-4 py-2' : 'px-3 py-3')}>
          <button
            type="button"
            onClick={handlePlusClick}
            className={clsx(
              'flex shrink-0 items-center justify-center',
              'size-8 rounded-full border border-border',
              'text-text-secondary transition-colors hover:bg-hover hover:text-text-primary',
            )}
            aria-label="添加附件"
          >
            <Plus className="size-4" />
          </button>

          <AutoResizeTextarea
            value={message}
            onChange={setMessage}
            onSend={handleSend}
            onToggleThinking={toggleThinking}
            className={clsx('px-1 py-1', compact ? 'max-h-10 min-h-8' : 'max-h-40 min-h-8')}
          />
        </div>

        {mode === 'thinking' && (
          <button
            type="button"
            onClick={() => onModeChange('simple')}
            className="absolute -top-3 left-4 rounded-full border border-border bg-surface px-2 py-1 text-xs text-text-secondary shadow-sm"
            aria-label="关闭 thinking 模式"
          >
            thinking
          </button>
        )}
      </div>

      {/* 分类标签（输入框下方） */}
      {showSuggestions && <CategoryTags onSelect={handleCategorySelect} />}
    </div>
  )
}
