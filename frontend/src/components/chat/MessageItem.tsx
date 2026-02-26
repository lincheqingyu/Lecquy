import clsx from 'clsx'
import type { ChatMessage } from '../../hooks/useChat'

interface MessageItemProps {
  message: ChatMessage
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isEvent = message.role === 'event'

  return (
    <div
      className={clsx(
        'flex w-full',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      <div
        className={clsx(
          'max-w-[85%] rounded-2xl px-4 py-2 text-sm leading-relaxed',
          // 用户消息改为低饱和背景 + 深色文字，降低视觉权重
          isUser && 'bg-hover text-text-primary border border-border/70',
          // AI 消息去掉卡片外观，与页面背景融合
          isAssistant && 'bg-transparent border-transparent shadow-none text-text-primary px-1 py-1',
          isEvent && 'bg-hover text-text-secondary border border-border',
          message.role === 'system' && 'bg-hover text-text-secondary border border-border',
        )}
      >
        {isEvent && message.eventType && (
          <div className="mb-1 text-xs uppercase tracking-wide text-text-muted">
            {message.eventType}
          </div>
        )}
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
    </div>
  )
}
