import { ChevronLeft, ChevronRight, Ellipsis, MessageSquareText, Plus, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

export interface ConversationItem {
  id: string
  title: string
  preview: string
  sessionId: string
  updatedAt: number
}

interface ConversationSidebarProps {
  conversations: ConversationItem[]
  activeConversationId: string | null
  activeView: 'chat' | 'chats'
  collapsed: boolean
  onToggleCollapse: () => void
  onCreateConversation: () => void
  onOpenChats: () => void
  onSelectConversation: (conversationId: string) => void
  onDeleteConversation: (conversationId: string) => void
  isLoading?: boolean
}

export function ConversationSidebar({
  conversations,
  activeConversationId,
  activeView,
  collapsed,
  onToggleCollapse,
  onCreateConversation,
  onOpenChats,
  onSelectConversation,
  onDeleteConversation,
  isLoading = false,
}: ConversationSidebarProps) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpenId(null)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [])

  return (
    <aside
      className={[
        'h-full shrink-0 border-r border-border/60 bg-surface-alt',
        'transition-[width] duration-300 ease-out',
        collapsed ? 'w-16' : 'w-80',
      ].join(' ')}
      aria-label="会话管理栏"
    >
      <div className="flex h-full flex-col">
        <div
          className={[
            'flex h-14 shrink-0 items-center',
            collapsed ? 'justify-center px-2' : 'justify-between px-4',
          ].join(' ')}
        >
          <button
            type="button"
            onClick={onToggleCollapse}
            className={[
              'inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary',
              'transition-colors hover:bg-hover/65 hover:text-text-primary',
            ].join(' ')}
            aria-label={collapsed ? '展开会话栏' : '收起会话栏'}
            title={collapsed ? '展开会话栏' : '收起会话栏'}
          >
            {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          </button>
        </div>

        {collapsed && (
          <div className="flex flex-col items-center gap-2 px-2 pb-3">
            <button
              type="button"
              onClick={onCreateConversation}
              className={[
                'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl',
                'text-text-secondary transition-colors hover:bg-hover/65 hover:text-text-primary',
              ].join(' ')}
              aria-label="新建会话"
              title="新建会话"
            >
              <Plus className="size-4" />
            </button>
            <button
              type="button"
              onClick={onOpenChats}
              className={[
                'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-text-primary',
                activeView === 'chats' ? 'bg-[#ece9e1]' : 'hover:bg-[#f3f0e8]',
              ].join(' ')}
              aria-label="会话管理"
              title="会话管理"
            >
              <MessageSquareText className="size-4" />
            </button>
          </div>
        )}

        {!collapsed && (
          <div className="px-3 pb-3">
            <button
              type="button"
              onClick={onCreateConversation}
              className={[
                'grid h-11 w-full grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 rounded-2xl px-3 text-left text-sm font-medium',
                'text-text-primary transition-colors hover:bg-hover/65',
              ].join(' ')}
              aria-label="新建会话"
            >
              <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-hover text-text-secondary">
                <Plus className="size-4" />
              </span>
              <span>新建会话</span>
            </button>

            <button
              type="button"
              onClick={onOpenChats}
              className={[
                'mt-1.5 grid h-11 w-full grid-cols-[2rem_minmax(0,1fr)] items-center gap-3 rounded-2xl px-3 text-left text-sm',
                activeView === 'chats'
                  ? 'bg-[#ece9e1] text-text-primary'
                  : 'text-text-primary transition-colors hover:bg-[#f3f0e8]',
              ].join(' ')}
              aria-current={activeView === 'chats' ? 'page' : undefined}
            >
              <span className="inline-flex h-7 w-7 items-center justify-center text-text-primary">
                <MessageSquareText className="size-5" />
              </span>
              <span className="font-medium">会话</span>
            </button>
          </div>
        )}

        <div
          className={[
            'chat-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden',
            collapsed ? 'px-2 pb-3' : 'px-3 pb-3',
          ].join(' ')}
        >
          {collapsed ? null : isLoading ? (
            <div className="px-2 py-4 text-xs text-text-muted">正在加载会话...</div>
          ) : conversations.length === 0 ? (
            <div className="px-2 py-4 text-xs text-text-muted">暂无历史会话</div>
          ) : (
            <ul className="space-y-1">
              {conversations.map((conversation) => {
                const isActive = activeView === 'chat' && conversation.id === activeConversationId

                return (
                  <li key={conversation.id}>
                    <div
                      className={[
                        'group relative flex min-h-11 w-full items-center gap-2 rounded-2xl pl-3 pr-2 transition-colors',
                        isActive ? 'bg-[#ece9e1]' : 'hover:bg-[#f3f0e8]',
                      ].join(' ')}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectConversation(conversation.id)}
                        className={[
                          'min-w-0 flex-1 py-3 text-left text-[15px] leading-5',
                          isActive ? 'font-medium text-text-primary' : 'text-text-primary',
                        ].join(' ')}
                        aria-current={isActive ? 'true' : undefined}
                      >
                        <span className="line-clamp-1 block truncate">{conversation.title}</span>
                      </button>

                      {conversations.length > 1 && (
                        <div ref={menuOpenId === conversation.id ? menuRef : null} className="relative shrink-0">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setMenuOpenId((prev) => (prev === conversation.id ? null : conversation.id))
                            }}
                            className={[
                              'inline-flex h-8 w-8 items-center justify-center rounded-xl text-text-muted',
                              'transition-all hover:bg-surface hover:text-text-primary',
                              menuOpenId === conversation.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                            ].join(' ')}
                            aria-label="更多操作"
                            title="更多操作"
                          >
                            <Ellipsis className="size-4" />
                          </button>
                          {menuOpenId === conversation.id && (
                            <div className="absolute right-0 top-10 z-20 min-w-32 rounded-2xl border border-border/80 bg-surface p-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.12)]">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setMenuOpenId(null)
                                  onDeleteConversation(conversation.id)
                                }}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-red-500 transition-colors hover:bg-[#f3f0e8]"
                              >
                                <Trash2 className="size-4" />
                                <span>删除</span>
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </aside>
  )
}
