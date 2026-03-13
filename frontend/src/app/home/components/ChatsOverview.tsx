import { Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ConversationItem } from './ConversationSidebar'

interface ChatsOverviewProps {
  conversations: ConversationItem[]
  onCreateConversation: () => void
  onSelectConversation: (conversationId: string) => void
}

function formatRelativeTime(timestamp: number): string {
  const deltaMinutes = Math.max(1, Math.floor((Date.now() - timestamp) / 60000))

  if (deltaMinutes < 60) return `${deltaMinutes} 分钟前`
  if (deltaMinutes < 1440) return `${Math.floor(deltaMinutes / 60)} 小时前`
  return `${Math.floor(deltaMinutes / 1440)} 天前`
}

export function ChatsOverview({
  conversations,
  onCreateConversation,
  onSelectConversation,
}: ChatsOverviewProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (!trimmed) return conversations
    return conversations.filter((item) => item.title.toLowerCase().includes(trimmed))
  }, [conversations, query])

  return (
    <div className="flex h-full min-w-0 flex-col bg-surface-alt">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-8 pb-10 pt-10">
        <div className="flex items-start justify-between gap-6">
          <div>
            <h1 className="text-[3rem] leading-none tracking-[-0.03em] text-text-primary">Chats</h1>
          </div>
          <button
            type="button"
            onClick={onCreateConversation}
            className="inline-flex h-12 items-center rounded-2xl bg-[#171717] px-5 text-base font-medium text-white transition-transform hover:-translate-y-0.5"
          >
            + New chat
          </button>
        </div>

        <div className="mt-8 relative">
          <Search className="pointer-events-none absolute left-5 top-1/2 size-5 -translate-y-1/2 text-text-secondary" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search your chats..."
            className="h-15 w-full rounded-2xl border border-border/80 bg-surface px-14 text-xl text-text-primary outline-none transition-colors placeholder:text-text-secondary focus:border-[#d6d0c4]"
          />
        </div>

        <div className="mt-8 flex items-center gap-4 text-[15px] text-text-secondary">
          <span>Your chats with Claude</span>
          <button type="button" className="text-[#2d72d2] transition-opacity hover:opacity-80">
            Select
          </button>
        </div>

        <div className="mt-5 border-t border-border/70">
          {filtered.map((conversation) => (
            <button
              key={conversation.id}
              type="button"
              onClick={() => onSelectConversation(conversation.id)}
              className="flex w-full items-start justify-between gap-4 border-b border-border/70 py-6 text-left transition-colors hover:bg-[#f7f4ed]"
            >
              <div className="min-w-0">
                <div className="truncate text-[18px] leading-7 text-text-primary">{conversation.title}</div>
                <div className="mt-1 text-[15px] text-text-secondary">
                  Last message {formatRelativeTime(conversation.updatedAt)}
                </div>
              </div>
            </button>
          ))}

          {filtered.length === 0 && (
            <div className="py-12 text-[15px] text-text-secondary">没有找到匹配的会话</div>
          )}
        </div>
      </div>
    </div>
  )
}
