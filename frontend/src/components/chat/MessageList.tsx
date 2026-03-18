import { useEffect, useRef, useState } from 'react'
import type { ChatMessage } from '../../hooks/useChat'
import { MessageItem } from './MessageItem'

interface MessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
  isWaiting: boolean
  onResendUser?: (message: string) => void
  onToggleThinking?: (messageId: string) => void
  scrollRequestVersion?: number
}

const BOTTOM_THRESHOLD_PX = 48
const USER_SCROLL_COOLDOWN_MS = 180

export function MessageList({
  messages,
  isStreaming,
  isWaiting,
  onResendUser,
  onToggleThinking,
  scrollRequestVersion = 0,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null)
  const userInteractingRef = useRef(false)
  const userScrollCooldownRef = useRef<number | null>(null)
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true)

  const isNearBottom = () => {
    const el = containerRef.current
    if (!el) return true
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    return distanceToBottom <= BOTTOM_THRESHOLD_PX
  }

  const syncPinnedState = () => {
    setIsPinnedToBottom(isNearBottom())
  }

  const scheduleUserInteractionRelease = () => {
    if (userScrollCooldownRef.current) {
      window.clearTimeout(userScrollCooldownRef.current)
    }

    userScrollCooldownRef.current = window.setTimeout(() => {
      userInteractingRef.current = false
      userScrollCooldownRef.current = null
      if (isNearBottom()) {
        setIsPinnedToBottom(true)
      }
    }, USER_SCROLL_COOLDOWN_MS)
  }

  const markUserInteraction = () => {
    userInteractingRef.current = true
    scheduleUserInteractionRelease()
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
    if (userInteractingRef.current) return
    scrollToBottom('auto')
  }, [isPinnedToBottom, isStreaming, isWaiting, messages])

  useEffect(() => {
    if (!(isStreaming || isWaiting)) return

    const observed = contentRef.current
    if (!observed || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      if (!isPinnedToBottom) return
      if (userInteractingRef.current) return
      window.requestAnimationFrame(() => {
        scrollToBottom('auto')
      })
    })

    observer.observe(observed)
    return () => observer.disconnect()
  }, [isPinnedToBottom, isStreaming, isWaiting])

  useEffect(() => {
    if (!(isStreaming || isWaiting) || !isPinnedToBottom) return
    if (userInteractingRef.current) return
    scrollToBottom('auto')
  }, [isPinnedToBottom, isStreaming, isWaiting])

  useEffect(() => {
    return () => {
      if (userScrollCooldownRef.current) {
        window.clearTimeout(userScrollCooldownRef.current)
      }
    }
  }, [])

  return (
    <div
      ref={containerRef}
      onScroll={syncPinnedState}
      onWheel={markUserInteraction}
      onTouchMove={markUserInteraction}
      onPointerDown={markUserInteraction}
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
      <div ref={contentRef} className="mx-auto flex w-full max-w-3xl flex-col gap-3">
        {messages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            onResendUser={onResendUser}
            onToggleThinking={onToggleThinking}
          />
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
