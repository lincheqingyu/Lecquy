import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatAttachment } from '@lecquy/shared'
import type { ChatMessage } from '../../hooks/useChat'
import { MessageItem } from './MessageItem'
import type { ChatArtifact } from '../../lib/artifacts'

interface MessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
  isWaiting: boolean
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

const BOTTOM_THRESHOLD_PX = 96
// 用户交互期间判定"已回到底部"的严格阈值：必须真正贴到底才视为回底，
// 否则只要用户向上滚几像素就会被 96px 的宽松阈值视作仍在底部，
// 从而被 ResizeObserver 立刻拉回最底部
const STRICT_BOTTOM_THRESHOLD_PX = 4
const USER_SCROLL_COOLDOWN_MS = 600

export function MessageList({
  messages,
  isStreaming,
  isWaiting,
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
  const bottomAnchorRef = useRef<HTMLDivElement | null>(null)
  const userInteractingRef = useRef(false)
  const userScrollCooldownRef = useRef<number | null>(null)
  const [isPinnedToBottom, setIsPinnedToBottom] = useState(true)
  // 用 ref 持有最新的 pinned 状态，供 ResizeObserver 回调读取，
  // 避免把 isPinnedToBottom 塞进 observer 的 effect 依赖导致频繁重建
  const isPinnedRef = useRef(true)

  const isNearBottom = () => {
    const el = containerRef.current
    if (!el) return true
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    return distanceToBottom <= BOTTOM_THRESHOLD_PX
  }

  const syncPinnedState = () => {
    const el = containerRef.current
    if (!el) return
    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight

    if (userInteractingRef.current) {
      // 用户交互期间，只有严格贴底（<= 4px）才视为"回到底部"。
      // 避免 96px 宽松阈值导致滚一点点就被判定仍在底部，ResizeObserver 立刻把用户拉回去。
      if (distanceToBottom <= STRICT_BOTTOM_THRESHOLD_PX) {
        userInteractingRef.current = false
        if (userScrollCooldownRef.current) {
          window.clearTimeout(userScrollCooldownRef.current)
          userScrollCooldownRef.current = null
        }
        setIsPinnedToBottom(true)
        isPinnedRef.current = true
      }
      // 交互中且不在严格底部 → 保持 unpinned（由 markUserInteraction 设置）
      return
    }

    // 非交互期间（程序化滚动 / 页面初始加载），宽松阈值
    const near = distanceToBottom <= BOTTOM_THRESHOLD_PX
    setIsPinnedToBottom(near)
    isPinnedRef.current = near
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
        isPinnedRef.current = true
      }
    }, USER_SCROLL_COOLDOWN_MS)
  }

  const markUserInteraction = () => {
    userInteractingRef.current = true
    // 用户一动就立刻退出贴底模式，让 ResizeObserver 不会把用户拉回底部
    if (isPinnedRef.current) {
      isPinnedRef.current = false
      setIsPinnedToBottom(false)
    }
    scheduleUserInteractionRelease()
  }

  // 直接改 scrollTop 比 scrollIntoView 更稳：
  // 1. 不受 anchor 像素精度与 block:'end' 判定"已在末尾"的干扰；
  // 2. 不受容器 padding / mask 遮罩影响，总能贴到真实底部。
  const scrollToBottom = (behavior: ScrollBehavior = 'auto') => {
    const el = containerRef.current
    if (!el) return
    if (behavior === 'auto') {
      el.scrollTop = el.scrollHeight
    } else {
      el.scrollTo({ top: el.scrollHeight, behavior })
    }
  }

  // 同步 pinned state 到 ref
  useEffect(() => {
    isPinnedRef.current = isPinnedToBottom
  }, [isPinnedToBottom])

  // Effect 1: 初始化 / 空态重置 / 显式滚动请求（新会话切换、用户主动跳底）
  // 仅在 scrollRequestVersion 递增时强制重置 pinned 并跳到底部
  useEffect(() => {
    if (messages.length === 0) {
      setIsPinnedToBottom(true)
      isPinnedRef.current = true
      return
    }
    scrollToBottom('auto')
    setIsPinnedToBottom(true)
    isPinnedRef.current = true
  }, [scrollRequestVersion])

  // Effect 2: 监听内容容器尺寸变化，流式追加 / Markdown 异步渲染 / 思考区展开折叠
  // 都会改变 scrollHeight，用 ResizeObserver 比依赖 messages 引用更可靠，
  // 也不会像 rAF 那样被下一次 effect 的 cleanup 取消（高频 token 场景）。
  useEffect(() => {
    const content = contentRef.current
    const container = containerRef.current
    if (!content || !container) return

    const maybeStickToBottom = () => {
      if (!isPinnedRef.current) return
      if (userInteractingRef.current) return
      scrollToBottom('auto')
    }

    // 尺寸变化时立即贴底（此刻 DOM 已经完成布局）
    const observer = new ResizeObserver(() => {
      maybeStickToBottom()
    })
    observer.observe(content)

    return () => observer.disconnect()
  }, [])

  // Effect 3: 兜底 —— 消息数组引用变化时也贴底一次，
  // 覆盖"尺寸没变但应该贴底"的极端情况（例如仅替换了等高的占位符）。
  useEffect(() => {
    if (messages.length === 0) return
    if (!isPinnedToBottom) return
    if (userInteractingRef.current) return
    scrollToBottom('auto')
  }, [messages, isStreaming, isWaiting, isPinnedToBottom])

  useEffect(() => {
    return () => {
      if (userScrollCooldownRef.current) {
        window.clearTimeout(userScrollCooldownRef.current)
      }
    }
  }, [])

  // 找到最后一条 assistant 消息的 id，用于展示品牌标识
  const lastAssistantId = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id
    }
    return null
  }, [messages])

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
            isLastAssistant={message.id === lastAssistantId}
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
      <div ref={bottomAnchorRef} aria-hidden="true" className="h-px w-full shrink-0" />
    </div>
  )
}
