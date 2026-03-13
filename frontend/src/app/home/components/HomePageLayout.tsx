import { useEffect, useMemo, useState } from 'react'
import { ConversationArea } from './ConversationArea'
import { ChatsOverview } from './ChatsOverview'
import { SettingsDrawer } from './SettingsDrawer'
import {
  ConversationSidebar,
  type ConversationItem,
} from './ConversationSidebar'
import type { ChatMessage, ModelConfig, SessionResolvedPayload } from '../../../hooks/useChat'
import { fetchSessionHistory, fetchSessions, deleteSession as deleteSessionByKey } from '../../../lib/session-api'
import {
  parsePeerIdFromSessionKey,
  toChatMessages,
  toSessionListItemVm,
  type SessionListItemVm,
} from '../../../lib/session-management'
import { getPeerId, resetPeerId, setPeerId } from '../../../lib/session'

interface SystemPromptItem {
  id: string
  title: string
  prompt: string
}

const STORAGE_KEYS = {
  prompts: 'webclaw.systemPrompts',
  activePromptId: 'webclaw.activePromptId',
  modelConfig: 'webclaw.modelConfig',
  sidebarCollapsed: 'webclaw.sidebarCollapsed',
}

function loadPrompts(): SystemPromptItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.prompts)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function loadActivePromptId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEYS.activePromptId)
  } catch {
    return null
  }
}

function loadModelConfig(): ModelConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.modelConfig)
    if (!raw) {
      return { model: 'glm-4.7', temperature: 0.7, maxTokens: 8192, baseUrl: '', apiKey: '', enableTools: false }
    }
    const parsed = JSON.parse(raw)
    return {
      model: parsed.model ?? 'glm-4.7',
      temperature: Number(parsed.temperature ?? 0.7),
      maxTokens: Number(parsed.maxTokens ?? 8192),
      baseUrl: parsed.baseUrl ?? '',
      apiKey: parsed.apiKey ?? '',
      enableTools: Boolean(parsed.enableTools ?? false),
    }
  } catch {
    return { model: 'glm-4.7', temperature: 0.7, maxTokens: 8192, baseUrl: '', apiKey: '', enableTools: false }
  }
}

function loadSidebarCollapsed(): boolean {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.sidebarCollapsed)
    if (raw === null) return true
    return raw === '1'
  } catch {
    return true
  }
}

function toConversationItem(session: SessionListItemVm): ConversationItem {
  return {
    id: session.id,
    title: session.title,
    preview: session.preview,
    sessionId: session.sessionId,
    updatedAt: session.updatedAt,
  }
}

export function HomePageLayout() {
  const [activeView, setActiveView] = useState<'chat' | 'chats'>('chat')
  const [sessionItems, setSessionItems] = useState<SessionListItemVm[]>([])
  const [selectedSessionKey, setSelectedSessionKey] = useState<string | null>(null)
  const [currentSessionKey, setCurrentSessionKey] = useState<string | null>(null)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [activePeerId, setActivePeerId] = useState<string>(() => getPeerId())
  const [messageSeed, setMessageSeed] = useState<ChatMessage[]>([])
  const [messageVersion, setMessageVersion] = useState(0)
  const [isSessionListLoading, setIsSessionListLoading] = useState(true)
  const [isHistoryLoading, setIsHistoryLoading] = useState(false)
  const [sessionError, setSessionError] = useState<string | null>(null)
  const [chatDisabledReason, setChatDisabledReason] = useState<string | null>(null)

  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isDark, setIsDark] = useState(false)
  const [systemPrompts, setSystemPrompts] = useState<SystemPromptItem[]>(() => loadPrompts())
  const [activePromptId, setActivePromptId] = useState<string | null>(() => loadActivePromptId())
  const [modelConfig, setModelConfig] = useState<ModelConfig>(() => loadModelConfig())
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => loadSidebarCollapsed())

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [isDark])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.prompts, JSON.stringify(systemPrompts))
  }, [systemPrompts])

  useEffect(() => {
    if (activePromptId) {
      localStorage.setItem(STORAGE_KEYS.activePromptId, activePromptId)
    } else {
      localStorage.removeItem(STORAGE_KEYS.activePromptId)
    }
  }, [activePromptId])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.modelConfig, JSON.stringify(modelConfig))
  }, [modelConfig])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, isSidebarCollapsed ? '1' : '0')
  }, [isSidebarCollapsed])

  const activePrompt = useMemo(() => {
    return systemPrompts.find((p) => p.id === activePromptId) ?? null
  }, [systemPrompts, activePromptId])

  const activeSession = useMemo(() => {
    const targetKey = selectedSessionKey ?? currentSessionKey
    return sessionItems.find((item) => item.id === targetKey) ?? null
  }, [currentSessionKey, selectedSessionKey, sessionItems])

  const conversationTitle = activeSession?.title ?? '新会话'
  const canSend = !isHistoryLoading && !chatDisabledReason
  const inputHint = isHistoryLoading ? '正在加载会话历史...' : chatDisabledReason

  const refreshSessions = async () => {
    setIsSessionListLoading(true)
    setSessionError(null)
    try {
      const rows = await fetchSessions()
      setSessionItems(rows.map(toSessionListItemVm))
    } catch {
      setSessionError('会话列表加载失败')
    } finally {
      setIsSessionListLoading(false)
    }
  }

  useEffect(() => {
    void refreshSessions()
  }, [])

  const replaceMessageSeed = (messages: ChatMessage[]) => {
    setMessageSeed(messages)
    setMessageVersion((prev) => prev + 1)
  }

  const handleStartNewConversation = () => {
    const nextPeerId = resetPeerId()
    setActivePeerId(nextPeerId)
    setActiveView('chat')
    setSelectedSessionKey(null)
    setCurrentSessionKey(null)
    setCurrentSessionId(null)
    setChatDisabledReason(null)
    replaceMessageSeed([])
  }

  const handleSelectConversation = async (sessionKey: string) => {
    const target = sessionItems.find((item) => item.id === sessionKey) ?? null
    setActiveView('chat')
    setSelectedSessionKey(sessionKey)
    setCurrentSessionKey(sessionKey)
    setCurrentSessionId(target?.sessionId ?? null)
    setChatDisabledReason(null)
    setIsHistoryLoading(true)
    setSessionError(null)

    try {
      const history = await fetchSessionHistory(sessionKey)
      replaceMessageSeed(toChatMessages(history))

      const peerId = parsePeerIdFromSessionKey(sessionKey)
      if (!peerId) {
        setChatDisabledReason('当前会话无法恢复发送绑定，仅支持查看历史。')
        return
      }

      setPeerId(peerId)
      setActivePeerId(peerId)
    } catch {
      setSessionError('会话历史加载失败')
    } finally {
      setIsHistoryLoading(false)
    }
  }

  const handleDeleteConversation = async (sessionKey: string) => {
    const confirmed = window.confirm('删除后将清空该会话的历史记录，确定继续吗？')
    if (!confirmed) return

    try {
      await deleteSessionByKey(sessionKey)
      setSessionItems((prev) => prev.filter((item) => item.id !== sessionKey))

      if (selectedSessionKey === sessionKey || currentSessionKey === sessionKey) {
        handleStartNewConversation()
      }
    } catch {
      setSessionError('删除会话失败')
    }
  }

  const handleSessionResolved = (payload: SessionResolvedPayload) => {
    setCurrentSessionKey(payload.sessionKey)
    setCurrentSessionId(payload.sessionId)
    setSelectedSessionKey(payload.sessionKey)
    void refreshSessions()
  }

  const handleChatLifecycleEvent = (event: 'done' | 'need_user_input' | 'error') => {
    if (event === 'done' || event === 'need_user_input') {
      void refreshSessions()
    }
  }

  const sidebarItems = useMemo(() => sessionItems.map(toConversationItem), [sessionItems])
  const sessionMetaText = currentSessionId ? `会话 ID: ${currentSessionId}` : null

  return (
    <div
      className={[
        'flex h-screen w-screen overflow-hidden',
        'bg-surface-alt text-text-primary font-sans',
        'transition-colors duration-300',
      ].join(' ')}
    >
      <ConversationSidebar
        conversations={sidebarItems}
        activeConversationId={selectedSessionKey}
        activeView={activeView}
        collapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed((prev) => !prev)}
        onCreateConversation={handleStartNewConversation}
        onOpenChats={() => setActiveView('chats')}
        onSelectConversation={(conversationId) => {
          void handleSelectConversation(conversationId)
        }}
        onDeleteConversation={(conversationId) => {
          void handleDeleteConversation(conversationId)
        }}
        isLoading={isSessionListLoading}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {sessionError && (
          <div className="shrink-0 border-b border-border bg-surface px-4 py-2 text-xs text-text-muted">
            {sessionError}
          </div>
        )}
        {activeView === 'chats' ? (
          <ChatsOverview
            conversations={sidebarItems}
            onCreateConversation={handleStartNewConversation}
            onSelectConversation={(conversationId) => {
              void handleSelectConversation(conversationId)
            }}
          />
        ) : (
          <ConversationArea
            onSettingsToggle={() => setIsSettingsOpen((prev) => !prev)}
            isDark={isDark}
            onThemeToggle={() => setIsDark((prev) => !prev)}
            systemPrompt={activePrompt?.prompt ?? ''}
            modelConfig={modelConfig}
            conversationTitle={conversationTitle}
            sessionMetaText={sessionMetaText}
            peerId={activePeerId}
            externalMessages={messageSeed}
            messageVersion={messageVersion}
            canSend={canSend}
            disabledReason={inputHint}
            onSessionResolved={handleSessionResolved}
            onChatLifecycleEvent={handleChatLifecycleEvent}
          />
        )}
      </div>
      <SettingsDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        systemPrompts={systemPrompts}
        activePromptId={activePromptId}
        onSystemPromptsChange={setSystemPrompts}
        onActivePromptChange={setActivePromptId}
        modelConfig={modelConfig}
        onModelConfigChange={setModelConfig}
      />
    </div>
  )
}
