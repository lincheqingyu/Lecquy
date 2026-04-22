import { useEffect, useMemo, useState } from 'react'
import { Moon, Settings, Square, Sun } from 'lucide-react'
import type { ChatAttachment } from '@lecquy/shared'
import { ChatInput, type ChatInputSubmitPayload } from '../../../components/ui/ChatInput'
import { MessageList } from '../../../components/chat/MessageList'
import {
  useChat,
  type ChatMessage,
  type ModelConfig,
  type SessionResolvedPayload,
  type SessionTitleUpdatedPayload,
} from '../../../hooks/useChat'
import { USE_PI_WEB_UI_PARTIAL } from '../../../config/api'
import { PiMessageListAdapter } from '../../../adapters/pi-web-ui/PiMessageListAdapter'
import { PiChatInputAdapter } from '../../../adapters/pi-web-ui/PiChatInputAdapter'
import {
  extractArtifactLocations,
  type ArtifactWithLocation,
  type ChatArtifact,
} from '../../../lib/artifacts'

interface ConversationAreaProps {
  onSettingsToggle: () => void
  isDark: boolean
  onThemeToggle: () => void
  modelConfig: ModelConfig
  conversationTitle: string
  sessionMetaText?: string | null
  peerId: string
  currentSessionKey?: string | null
  externalMessages: ChatMessage[]
  messageVersion: number
  canSend: boolean
  disabledReason?: string | null
  onSessionResolved: (payload: SessionResolvedPayload) => void
  onSessionTitleUpdated: (payload: SessionTitleUpdatedPayload) => void
  onChatLifecycleEvent: (event: 'run_completed' | 'run_paused' | 'run_failed') => void
  onOpenAttachment: (messageId: string, attachmentIndex: number, attachment: ChatAttachment) => void
  onOpenArtifact: (messageId: string, artifactIndex: number, artifact: ChatArtifact) => void
  /** 上抛当前会话的扁平化 artifacts，用于右侧面板订阅 draft 流式更新与弱自动打开 */
  onArtifactsChange?: (artifacts: ArtifactWithLocation[]) => void
  activeAttachmentKey?: string | null
  showHeader?: boolean
  workspaceMode?: 'default' | 'split'
}

export function ConversationArea({
  onSettingsToggle,
  isDark,
  onThemeToggle,
  modelConfig,
  conversationTitle,
  sessionMetaText = null,
  peerId,
  currentSessionKey = null,
  externalMessages,
  messageVersion,
  canSend,
  disabledReason = null,
  onSessionResolved,
  onSessionTitleUpdated,
  onChatLifecycleEvent,
  onOpenAttachment,
  onOpenArtifact,
  onArtifactsChange,
  activeAttachmentKey = null,
  showHeader = true,
  workspaceMode = 'default',
}: ConversationAreaProps) {
  const [scrollRequestVersion, setScrollRequestVersion] = useState(0)
  const {
    mode,
    setMode,
    messages,
    send,
    stop,
    toggleThinking,
    toggleTodo,
    togglePlanTask,
    toggleToolCall,
    toggleToolGroup,
    isStreaming,
    isWaiting,
    replaceMessages,
  } = useChat({
    modelConfig,
    peerId,
    currentSessionKey,
    onWsEvent: (event, payload) => {
      if (event === 'session_bound') {
        onSessionResolved(payload as SessionResolvedPayload)
        return
      }

      if (event === 'session_title_updated') {
        onSessionTitleUpdated(payload as SessionTitleUpdatedPayload)
        return
      }

      if (event === 'pause_requested') {
        onChatLifecycleEvent('run_paused')
        return
      }

      if (event === 'run_state') {
        const state = payload as { status: string }
        if (state.status === 'completed') {
          onChatLifecycleEvent('run_completed')
        } else if (state.status === 'failed' || state.status === 'cancelled') {
          onChatLifecycleEvent('run_failed')
        }
      }
    },
  })

  useEffect(() => {
    replaceMessages(externalMessages)
    setScrollRequestVersion((prev) => prev + 1)
  }, [externalMessages, messageVersion, replaceMessages])

  // 从消息派生扁平化 artifacts，按 messages 变化 memoize
  const artifactLocations = useMemo(() => extractArtifactLocations(messages), [messages])

  // 上抛给 HomePageLayout，驱动 openDocument.artifact 同步与 draft 弱自动打开
  useEffect(() => {
    onArtifactsChange?.(artifactLocations)
  }, [artifactLocations, onArtifactsChange])

  const hasSent = messages.length > 0
  const showStopButton = isStreaming
  const canContinuePlan = isWaiting && mode === 'plan'
  const effectiveCanSend = canSend && !isStreaming && (!isWaiting || canContinuePlan)
  const effectiveDisabledReason =
    disabledReason
      ?? (isWaiting && !canContinuePlan ? '当前计划正在等待补充信息，请切换到 plan 模式继续' : null)

  const MessageListComp = USE_PI_WEB_UI_PARTIAL ? PiMessageListAdapter : MessageList
  const ChatInputComp = USE_PI_WEB_UI_PARTIAL ? PiChatInputAdapter : ChatInput
  const isSplitWorkspace = workspaceMode === 'split'
  const stopButton = showStopButton ? (
    <button
      type="button"
      onClick={stop}
      className={[
        'inline-flex size-9 items-center justify-center rounded-full border border-border/80',
        'bg-[linear-gradient(180deg,var(--color-surface-thought),var(--color-surface))]',
        'text-text-primary shadow-[0_10px_20px_rgba(15,23,42,0.05)] transition-all duration-200',
        'hover:border-[color:var(--border-strong)] hover:bg-[linear-gradient(180deg,var(--color-surface),var(--color-surface-thought))]',
      ].join(' ')}
      aria-label="中断回答"
      title="中断回答"
    >
      <Square className="size-3 fill-current" />
    </button>
  ) : null

  const handleSend = ({ message, attachments }: ChatInputSubmitPayload) => {
    if (!effectiveCanSend) return
    const sent = send({ text: message, attachments })
    if (sent) {
      setScrollRequestVersion((prev) => prev + 1)
    }
  }

  const handleResendUser = (messageId: string) => {
    if (!effectiveCanSend) return
    // 找到被重发的用户消息，提取内容和附件
    const index = messages.findIndex((m) => m.id === messageId)
    if (index < 0) return
    const target = messages[index]
    if (target.role !== 'user') return
    const text = target.content
    const attachments = target.attachments
    if (!text.trim() && (!attachments || attachments.length === 0)) return

    // 截断：移除被重发的用户消息及其之后的所有消息（AI 回复等）
    replaceMessages(messages.slice(0, index))

    const sent = send({ text, attachments })
    if (sent) {
      setScrollRequestVersion((prev) => prev + 1)
    }
  }

  const handleEditUser = (messageId: string, nextContent: string) => {
    if (!effectiveCanSend) return

    const index = messages.findIndex((candidate) => candidate.id === messageId)
    if (index < 0) return

    const target = messages[index]
    if (target.role !== 'user') return

    const text = nextContent.trim()
    const attachments = target.attachments
    if (!text && (!attachments || attachments.length === 0)) return

    replaceMessages(messages.slice(0, index))

    const sent = send({ text, attachments })
    if (sent) {
      setScrollRequestVersion((prev) => prev + 1)
    }
  }

  return (
    <div
      className={[
        'relative flex min-h-0 flex-1 flex-col overflow-hidden',
        isSplitWorkspace ? 'bg-surface-alt' : 'border-r border-border bg-surface-alt',
      ].join(' ')}
    >
      {showHeader && (
        <header className="h-12 shrink-0 bg-surface-alt/95 backdrop-blur">
          <div className="flex h-full w-full items-center justify-between px-4 md:px-6">
            <div className="min-w-0 flex items-center gap-3">
              <h1 className="line-clamp-1 text-sm font-medium text-text-primary">{conversationTitle}</h1>
              {sessionMetaText && (
                <div className="shrink-0 text-xs text-text-muted">
                  {sessionMetaText}
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onThemeToggle}
                className={[
                  'flex items-center justify-center',
                  'size-9 rounded-lg',
                  'text-text-secondary',
                  'transition-colors hover:bg-hover hover:text-text-primary',
                ].join(' ')}
                aria-label={isDark ? '切换到亮色模式' : '切换到暗色模式'}
              >
                {isDark ? <Sun className="size-5" /> : <Moon className="size-5" />}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onSettingsToggle()
                }}
                className={[
                  'flex items-center justify-center',
                  'size-9 rounded-lg',
                  'text-text-secondary',
                  'transition-colors hover:bg-hover hover:text-text-primary',
                ].join(' ')}
                aria-label="打开设置"
              >
                <Settings className="size-5" />
              </button>
            </div>
          </div>
        </header>
      )}

      <div className="flex-1 min-h-0">
        {!hasSent ? (
          <div className="flex h-full flex-col items-center justify-center">
            <div className="mb-8 text-center">
              <div className="flex items-center justify-center gap-3">
                <img
                  src="/logo2-no-bg-svg.svg"
                  alt="Lecquy"
                  className="h-10 w-10 object-contain"
                />
                <div className="text-2xl font-semibold text-text-primary">有什么我可以帮你的？</div>
              </div>
              <div className="mt-2 text-sm text-text-muted">支持 simple 与 plan 两种模式</div>
            </div>
            <ChatInputComp
              mode={mode}
              onModeChange={setMode}
              onSend={handleSend}
              showSuggestions
              disabled={!effectiveCanSend}
              disabledReason={effectiveDisabledReason}
              rightSlot={stopButton}
            />
          </div>
        ) : (
          <div className="flex h-full min-h-0 flex-col overflow-hidden">
            <div className="min-h-0 flex-1 overflow-hidden">
              <MessageListComp
                messages={messages}
                isStreaming={isStreaming}
                isWaiting={isWaiting}
                onResendUser={effectiveCanSend ? handleResendUser : undefined}
                onEditUser={effectiveCanSend ? handleEditUser : undefined}
                onToggleThinking={toggleThinking}
                onToggleTodo={toggleTodo}
                onTogglePlanTask={togglePlanTask}
                onToggleToolCall={toggleToolCall}
                onToggleToolGroup={toggleToolGroup}
                onOpenAttachment={onOpenAttachment}
                onOpenArtifact={onOpenArtifact}
                activeAttachmentKey={activeAttachmentKey}
                scrollRequestVersion={scrollRequestVersion}
                wideLayout={isSplitWorkspace}
              />
            </div>
            <div className="shrink-0 bg-gradient-to-t from-surface-alt via-surface-alt/95 to-transparent pt-4 pb-5">
              <div className={isSplitWorkspace ? 'w-full px-4 md:px-6' : 'mx-auto w-full max-w-3xl px-4 md:px-2'}>
                <div className={isSplitWorkspace ? 'mr-auto max-w-[min(100%,56rem)]' : ''}>
                  <ChatInputComp
                    mode={mode}
                    onModeChange={setMode}
                    onSend={handleSend}
                    showSuggestions={false}
                    disabled={!effectiveCanSend}
                    disabledReason={effectiveDisabledReason}
                    rightSlot={stopButton}
                  />
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
