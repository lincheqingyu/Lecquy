import { useEffect, useState } from 'react'
import { Moon, Settings, Square, Sun } from 'lucide-react'
import { ChatInput } from '../../../components/ui/ChatInput'
import { MessageList } from '../../../components/chat/MessageList'
import {
  useChat,
  type ChatMessage,
  type ModelConfig,
  type SessionResolvedPayload,
} from '../../../hooks/useChat'
import { USE_PI_WEB_UI_PARTIAL } from '../../../config/api'
import { PiMessageListAdapter } from '../../../adapters/pi-web-ui/PiMessageListAdapter'
import { PiChatInputAdapter } from '../../../adapters/pi-web-ui/PiChatInputAdapter'

interface ConversationAreaProps {
  onSettingsToggle: () => void
  isDark: boolean
  onThemeToggle: () => void
  systemPrompt: string
  modelConfig: ModelConfig
  conversationTitle: string
  sessionMetaText?: string | null
  peerId: string
  externalMessages: ChatMessage[]
  messageVersion: number
  canSend: boolean
  disabledReason?: string | null
  onSessionResolved: (payload: SessionResolvedPayload) => void
  onChatLifecycleEvent: (event: 'done' | 'need_user_input' | 'error') => void
}

export function ConversationArea({
  onSettingsToggle,
  isDark,
  onThemeToggle,
  systemPrompt,
  modelConfig,
  conversationTitle,
  sessionMetaText = null,
  peerId,
  externalMessages,
  messageVersion,
  canSend,
  disabledReason = null,
  onSessionResolved,
  onChatLifecycleEvent,
}: ConversationAreaProps) {
  const [scrollRequestVersion, setScrollRequestVersion] = useState(0)
  const {
    mode,
    setMode,
    messages,
    send,
    stop,
    isStreaming,
    isWaiting,
    replaceMessages,
  } = useChat({
    systemPrompt,
    modelConfig,
    peerId,
    onWsEvent: (event, payload) => {
      if (event === 'session_key_resolved') {
        onSessionResolved(payload as SessionResolvedPayload)
        return
      }

      if (event === 'done' || event === 'need_user_input' || event === 'error') {
        onChatLifecycleEvent(event)
      }
    },
  })

  useEffect(() => {
    replaceMessages(externalMessages)
    setScrollRequestVersion((prev) => prev + 1)
  }, [externalMessages, messageVersion, replaceMessages])

  const hasSent = messages.length > 0
  const showStopButton = isStreaming || isWaiting
  const canContinuePlan = isWaiting && mode === 'plan'
  const effectiveCanSend = canSend && !isStreaming && (!isWaiting || canContinuePlan)
  const effectiveDisabledReason =
    disabledReason
      ?? (isStreaming
        ? '当前回答尚未完成'
        : isWaiting && !canContinuePlan
          ? '当前计划正在等待补充信息，请切换到 plan 模式继续'
          : null)

  const MessageListComp = USE_PI_WEB_UI_PARTIAL ? PiMessageListAdapter : MessageList
  const ChatInputComp = USE_PI_WEB_UI_PARTIAL ? PiChatInputAdapter : ChatInput
  const stopButton = showStopButton ? (
    <button
      type="button"
      onClick={stop}
      className={[
        'inline-flex size-10 items-center justify-center rounded-full border border-border',
        'bg-[radial-gradient(circle_at_30%_30%,rgba(255,255,255,0.24),transparent_55%),var(--color-surface)]',
        'text-text-secondary shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-all duration-200',
        'hover:-translate-y-0.5 hover:bg-hover hover:text-text-primary',
      ].join(' ')}
      aria-label="暂停回答"
      title="暂停回答"
    >
      <span className="flex size-4 items-center justify-center rounded-[0.35rem] bg-current" aria-hidden="true">
        <Square className="size-2.5 fill-surface text-surface" />
      </span>
    </button>
  ) : null

  const handleSend = (text: string) => {
    if (!effectiveCanSend) return
    const sent = send(text)
    if (sent) {
      setScrollRequestVersion((prev) => prev + 1)
    }
  }

  const handleResendUser = (text: string) => {
    if (!text.trim() || !effectiveCanSend) return
    const sent = send(text)
    if (sent) {
      setScrollRequestVersion((prev) => prev + 1)
    }
  }

  return (
    <div
      className={[
        'relative flex-1 min-h-0',
        'border-r border-border bg-surface-alt',
      ].join(' ')}
    >
      <div className="flex h-full flex-col">
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

        <div className="flex-1 min-h-0">
          {!hasSent ? (
            <div className="flex h-full flex-col items-center justify-center">
              <div className="mb-8 text-center">
                <div className="text-2xl font-semibold text-text-primary">有什么我可以帮你的？</div>
                <div className="mt-2 text-sm text-text-muted">支持 simple 与 plan 两种模式</div>
              </div>
              <ChatInputComp
                mode={mode}
                onModeChange={setMode}
                onSend={handleSend}
                showSuggestions
                disabled={!effectiveCanSend}
                disabledReason={effectiveDisabledReason}
              />
            </div>
          ) : (
            <div className="flex size-full flex-col">
              <div className="flex-1 min-h-0">
                <MessageListComp
                  messages={messages}
                  isStreaming={isStreaming}
                  isWaiting={isWaiting}
                  onResendUser={handleResendUser}
                  scrollRequestVersion={scrollRequestVersion}
                />
              </div>
              <div className="sticky bottom-0 z-10 w-full bg-gradient-to-t from-surface-alt via-surface-alt/95 to-transparent pt-4 pb-5">
                <div className="mx-auto w-full max-w-3xl px-4 md:px-2">
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
          )}
        </div>
      </div>
    </div>
  )
}
