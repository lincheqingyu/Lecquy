import { useEffect, useRef, useState } from 'react'
import type { ChatAttachment } from '@lecquy/shared'
import type { ChatMessage } from '../../hooks/useChat'
import { MessageItem } from './MessageItem'
import type { ChatArtifact } from '../../lib/artifacts'

interface MessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
  isWaiting: boolean
  onResendUser?: (message: string) => void
  onToggleThinking?: (messageId: string) => void
  onToggleTodo?: (messageId: string) => void
  onTogglePlanTask?: (messageId: string, todoIndex: number) => void
  onToggleToolCall?: (messageId: string, blockId: string) => void
  onToggleToolGroup?: (messageId: string, groupKey: string) => void
  onOpenAttachment?: (messageId: string, attachmentIndex: number, attachment: ChatAttachment) => void
  onOpenArtifact?: (messageId: string, artifactIndex: number, artifact: ChatArtifact) => void
  onDownloadArtifact?: (artifact: ChatArtifact) => void
  activeAttachmentKey?: string | null
  scrollRequestVersion?: number
  wideLayout?: boolean
}

const BOTTOM_THRESHOLD_PX = 96
const USER_SCROLL_COOLDOWN_MS = 600

export function MessageList({
  messages,
  isStreaming,
  isWaiting,
  onResendUser,
  onToggleThinking,
  onToggleTodo,
  onTogglePlanTask,
  onToggleToolCall,
  onToggleToolGroup,
  onOpenAttachment,
  onOpenArtifact,
  onDownloadArtifact,
  activeAttachmentKey = null,
  scrollRequestVersion = 0,
  wideLayout = false,
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
    const near = isNearBottom()
    setIsPinnedToBottom(near)
    // 用户自行滚回底部 —— 立刻清掉冷却并恢复自动贴底，避免流式被压 600ms
    if (near && userInteractingRef.current) {
      userInteractingRef.current = false
      if (userScrollCooldownRef.current) {
        window.clearTimeout(userScrollCooldownRef.current)
        userScrollCooldownRef.current = null
      }
    }
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

  // Effect 1: 初始化 / 空态重置 / 显式滚动请求（新会话切换、用户主动跳底）
  // 仅在 scrollRequestVersion 递增时强制重置 pinned 并跳到底部
  useEffect(() => {
    if (messages.length === 0) {
      setIsPinnedToBottom(true)
      return
    }
    scrollToBottom('auto')
    setIsPinnedToBottom(true)
  }, [scrollRequestVersion])

  // Effect 2: 流式 / 消息增长 / 思考区展开折叠时自动贴底
  // messages 引用每次 updateMessage 都会变，能覆盖所有内容变化；
  // 用 rAF 吸收同一帧内的多次 state 更新，让 scroll 发生在 DOM 重排之后
  useEffect(() => {
    if (messages.length === 0) return
    if (!isPinnedToBottom) return
    if (userInteractingRef.current) return
    const raf = window.requestAnimationFrame(() => {
      scrollToBottom('auto')
    })
    return () => window.cancelAnimationFrame(raf)
  }, [messages, isStreaming, isWaiting, isPinnedToBottom])

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
      className={wideLayout
        ? 'chat-scroll-mask chat-scrollbar flex h-full w-full flex-col gap-3 overflow-y-auto px-4 pt-6 pb-28 md:px-6'
        : 'chat-scroll-mask chat-scrollbar flex h-full w-full flex-col gap-3 overflow-y-auto px-4 pt-6 pb-28 md:px-2'}
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
      <div
        ref={contentRef}
        className={wideLayout
          ? 'mr-auto flex w-full max-w-[min(100%,56rem)] flex-col gap-3'
          : 'mx-auto flex w-full max-w-3xl flex-col gap-3'}
      >
        {messages.map((message) => (
          <MessageItem
            key={message.id}
            message={message}
            onResendUser={onResendUser}
            onToggleThinking={onToggleThinking}
            onToggleTodo={onToggleTodo}
            onTogglePlanTask={onTogglePlanTask}
            onToggleToolCall={onToggleToolCall}
            onToggleToolGroup={onToggleToolGroup}
            onOpenAttachment={onOpenAttachment}
            onOpenArtifact={onOpenArtifact}
            onDownloadArtifact={onDownloadArtifact}
            activeAttachmentKey={activeAttachmentKey}
          />
        ))}
      </div>
      <div ref={bottomAnchorRef} aria-hidden="true" className="h-px w-full shrink-0" />
    </div>
  )
}
