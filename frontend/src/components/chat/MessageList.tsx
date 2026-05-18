// 中文：本文件（MessageList.tsx）位于 frontend/src/components/chat/MessageList.tsx，属于frontend链路中的前端组件代码，连接上游调用方与下游执行逻辑。
// English: This file (MessageList.tsx) belongs to the frontend 前端组件 layer in frontend/src/components/chat/MessageList.tsx, wiring upstream callers with downstream runtime logic.

import { useEffect, useRef } from 'react'
import type { ChatAttachment } from '@lecquy/shared'
import type { ChatMessage } from '../../hooks/useChat'
import { MessageItem } from './MessageItem'
import type { ChatArtifact } from '../../lib/artifacts'

interface MessageListProps {
  messages: ChatMessage[]
  onResendUser?: (messageId: string) => void
  onEditUser?: (messageId: string, nextContent: string) => void
  onToggleThinking?: (messageId: string, groupKey?: string) => void
  onToggleTodo?: (messageId: string) => void
  onTogglePlanTask?: (messageId: string, todoIndex: number) => void
  onToggleToolCall?: (messageId: string, blockId: string) => void
  onToggleToolGroup?: (messageId: string, groupKey: string) => void
  onOpenAttachment?: (messageId: string, attachmentIndex: number, attachment: ChatAttachment) => void
  onOpenArtifact?: (messageId: string, artifactIndex: number, artifact: ChatArtifact) => void
  activeAttachmentKey?: string | null
  scrollRequestVersion?: number
  wideLayout?: boolean
}

export function MessageList({
  messages,
  onResendUser,
  onEditUser,
  onToggleThinking,
  onToggleTodo,
  onTogglePlanTask,
  onToggleToolCall,
  onToggleToolGroup,
  onOpenAttachment,
  onOpenArtifact,
  activeAttachmentKey = null,
  scrollRequestVersion = 0,
  wideLayout = false,
}: MessageListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (messages.length === 0 || !containerRef.current) return
    const el = containerRef.current
    el.scrollTop = el.scrollHeight
  }, [scrollRequestVersion])

  return (
    <div
      ref={containerRef}
      className="chat-scroll-mask chat-scrollbar flex h-full w-full flex-col gap-3 overflow-y-auto pt-6 pb-28"
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
            onEditUser={onEditUser}
            onToggleThinking={onToggleThinking}
            onToggleTodo={onToggleTodo}
            onTogglePlanTask={onTogglePlanTask}
            onToggleToolCall={onToggleToolCall}
            onToggleToolGroup={onToggleToolGroup}
            onOpenAttachment={onOpenAttachment}
            onOpenArtifact={onOpenArtifact}
            activeAttachmentKey={activeAttachmentKey}
          />
        ))}
      </div>
      <div className="chat-scroll-anchor" aria-hidden="true" />
    </div>
  )
}
