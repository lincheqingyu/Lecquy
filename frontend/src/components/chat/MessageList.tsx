import type { ChatMessage } from '../../hooks/useChat'
import { MessageItem } from './MessageItem'

interface MessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
  isWaiting: boolean
}

export function MessageList({ messages, isStreaming, isWaiting }: MessageListProps) {
  return (
    <div
      className="chat-scroll-mask chat-scrollbar flex h-full w-full flex-col gap-3 overflow-y-auto px-4 pt-6 pb-28 md:px-2"
      style={{
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0, black 20px, black calc(100% - 28px), transparent 100%)',
        maskImage: 'linear-gradient(to bottom, transparent 0, black 20px, black calc(100% - 28px), transparent 100%)',
      }}
    >
      {messages.length === 0 && (
        <div className="text-center text-text-muted">
          发送消息开始对话
        </div>
      )}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        {messages.map((message) => (
          <MessageItem key={message.id} message={message} />
        ))}
      </div>
      {(isStreaming || isWaiting) && (
        <div className="mx-auto w-full max-w-3xl text-xs text-text-muted">
          {isWaiting ? '等待用户补充信息…' : '正在生成…'}
        </div>
      )}
    </div>
  )
}
