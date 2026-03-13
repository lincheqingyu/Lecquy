import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../hooks/useChat'
import { MessageItem } from './MessageItem'

interface MessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
  isWaiting: boolean
  onResendUser?: (message: string) => void
  scrollRequestVersion?: number
}

const BOTTOM_THRESHOLD_PX = 48

export function MessageList({
  messages,
  isStreaming,
  isWaiting,
  onResendUser,
  scrollRequestVersion = 0,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null)
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true)

  const syncPinnedState = () => {
    const el = containerRef.current
    if (!el) return
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setIsPinnedToBottom(distanceToBottom <= BOTTOM_THRESHOLD_PX)
  }

  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    bottomAnchorRef.current?.scrollIntoView({ block: 'end', behavior })
  }

  useEffect(() => {
    if (messages.length === 0) {
      setIsPinnedToBottom(true)
      return
    }
    scrollToBottom('auto')
  }, [messages.length])

  useEffect(() => {
    if (messages.length === 0) return
    scrollToBottom('smooth')
    setIsPinnedToBottom(true)
  }, [messages.length, scrollRequestVersion])

  useEffect(() => {
    if (messages.length === 0 || !(isStreaming || isWaiting) || !isPinnedToBottom) return
    scrollToBottom('auto')
  }, [isPinnedToBottom, isStreaming, isWaiting, messages])

  return (
    <div
      ref={containerRef}
      onScroll={syncPinnedState}
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
          <MessageItem key={message.id} message={message} onResendUser={onResendUser} />
        ))}
      </div>
      {(isStreaming || isWaiting) && (
        <div className="mx-auto w-full max-w-3xl text-xs text-text-muted">
          {isWaiting ? '等待用户补充信息…' : '正在生成…'}
        </div>
      )}
      <div ref={bottomAnchorRef} aria-hidden="true" className="h-px w-full shrink-0" />
    </div>
  )
}
