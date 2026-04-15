import { Ellipsis, MessageSquareText, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Trash2 } from 'lucide-react'
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
  activeView: 'chat' | 'sessions'
  collapsed: boolean
  onToggleCollapse: () => void
  onCreateConversation: () => void
  onOpenSessions: () => void
  onSelectConversation: (conversationId: string) => void
  onRenameConversation: (conversationId: string) => void
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
  onOpenSessions,
  onSelectConversation,
  onRenameConversation,
  onDeleteConversation,
  isLoading = false,
}: ConversationSidebarProps) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const collapsedIconShellClass = 'inline-flex h-9 w-9 items-center justify-center rounded-full'
  const collapsedGlyphClass = 'size-[18px] shrink-0'

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
        'h-full shrink-0 border-r border-border/60',
        'transition-[width] duration-300 ease-out',
        collapsed ? 'w-16 bg-surface-alt' : 'w-[16.5rem] bg-sidebar-panel',
      ].join(' ')}
      aria-label="会话管理栏"
    >
      <div className="flex h-full flex-col">
        {collapsed ? (
          <div className="shrink-0 px-3 pb-1.5 pt-3">
            <button
              type="button"
              onClick={onToggleCollapse}
              className={[
                'flex h-11 w-full items-center justify-center rounded-2xl text-text-primary',
                'transition-colors hover:bg-sidebar-hover',
              ].join(' ')}
              aria-label="展开会话栏"
              title="展开会话栏"
            >
              <span className={collapsedIconShellClass}>
                <PanelLeftOpen className={[collapsedGlyphClass, 'translate-x-px'].join(' ')} />
              </span>
            </button>
          </div>
        ) : (
          <div className="shrink-0 px-3 pb-2 pt-3">
            <div className="grid h-11 w-full grid-cols-[2.25rem_minmax(0,1fr)_2.25rem] items-center gap-3 rounded-2xl">
              <div className="inline-flex h-9 w-9 items-center justify-center justify-self-center overflow-visible">
                <img
                  src="/lecquy-mark-nobg.png"
                  alt="Lecquy"
                  className="block h-7.5 w-7.5 shrink-0 translate-y-[3px] scale-[1.24] object-contain"
                  loading="eager"
                />
              </div>

              <div className="flex min-w-0 items-center">
                <div className="overflow-visible whitespace-nowrap pb-[3px] text-[1.5rem] font-semibold leading-[1.08] tracking-[-0.045em] text-text-primary">
                  Lecquy
                </div>
              </div>

              <button
                type="button"
                onClick={onToggleCollapse}
                className={[
                  'inline-flex h-9 w-9 shrink-0 items-center justify-center justify-self-end rounded-xl text-text-secondary',
                  'transition-colors hover:bg-sidebar-hover hover:text-text-primary',
                ].join(' ')}
                aria-label="收起会话栏"
                title="收起会话栏"
              >
                <PanelLeftClose className="size-[18px] shrink-0" />
              </button>
            </div>
          </div>
        )}

        <div className="px-3 pb-3">
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={onCreateConversation}
              className={[
                collapsed
                  ? 'flex h-11 w-full items-center justify-center rounded-2xl text-text-primary transition-colors hover:bg-sidebar-hover'
                  : 'grid h-11 w-full grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 rounded-2xl text-left transition-colors hover:bg-sidebar-hover',
              ].join(' ')}
              aria-label="新建会话"
              title="新建会话"
            >
              {/* "+" 按钮：展开态圈圈收紧到 h-7 w-7，Plus 放大到 size-5；折叠态无圈仅放大图标 */}
              <span
                className={[
                  'inline-flex shrink-0 items-center justify-center rounded-full text-text-primary',
                  collapsed ? 'h-9 w-9' : 'h-7 w-7 bg-sidebar-active',
                ].join(' ')}
              >
                <Plus className="size-5 shrink-0 translate-y-px" />
              </span>
              {!collapsed && (
                <span className="overflow-hidden whitespace-nowrap text-sm font-medium text-text-primary transition-[opacity,width] duration-200">
                  新建会话
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={onOpenSessions}
              className={[
                collapsed
                  ? [
                      'flex h-11 w-full items-center justify-center rounded-2xl transition-colors',
                      activeView === 'sessions'
                        ? 'text-text-primary'
                        : 'text-text-primary hover:bg-sidebar-hover',
                    ].join(' ')
                  : [
                      'grid h-11 w-full grid-cols-[2.25rem_minmax(0,1fr)] items-center gap-3 rounded-2xl text-left',
                      activeView === 'sessions'
                        ? 'bg-sidebar-active text-text-primary'
                        : 'text-text-primary transition-colors hover:bg-sidebar-hover',
                    ].join(' '),
              ].join(' ')}
              aria-label="会话"
              title="会话"
              aria-current={activeView === 'sessions' ? 'page' : undefined}
            >
              <span
                className={[
                  collapsedIconShellClass,
                  'text-text-primary',
                  collapsed && activeView === 'sessions' ? 'rounded-full bg-sidebar-active' : '',
                ].join(' ')}
              >
                <MessageSquareText className={[collapsedGlyphClass, 'translate-y-px'].join(' ')} />
              </span>
              {!collapsed && (
                <span className="overflow-hidden whitespace-nowrap text-sm font-medium transition-[opacity,width] duration-200">
                  会话
                </span>
              )}
            </button>
          </div>
        </div>

        {!collapsed && (
          <div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3">
            {isLoading ? (
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
                          // 收紧：min-h-10 / rounded-lg(8px) / padding 收、gap 收，趋近长方形
                          'group relative flex min-h-10 w-full items-center gap-1.5 rounded-lg pl-2.5 pr-1.5 transition-colors',
                          isActive ? 'bg-sidebar-active' : 'hover:bg-sidebar-hover',
                        ].join(' ')}
                      >
                        <button
                          type="button"
                          onClick={() => onSelectConversation(conversation.id)}
                          className={[
                            'min-w-0 flex-1 py-2.5 text-left text-[15px] leading-5 text-text-primary',
                            isActive ? 'font-medium' : '',
                          ].join(' ')}
                          aria-current={isActive ? 'true' : undefined}
                        >
                          <span className="line-clamp-1 block truncate">{conversation.title}</span>
                        </button>

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
                            <div className="absolute right-0 top-10 z-20 min-w-40 rounded-2xl border border-border/80 bg-surface p-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.12)]">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setMenuOpenId(null)
                                  onRenameConversation(conversation.id)
                                }}
                                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-text-primary transition-colors hover:bg-sidebar-hover"
                              >
                                <Pencil className="size-4" />
                                <span>重命名</span>
                              </button>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setMenuOpenId(null)
                                  onDeleteConversation(conversation.id)
                                }}
                                className="mt-1 flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-red-500 transition-colors hover:bg-sidebar-hover"
                              >
                                <Trash2 className="size-4" />
                                <span>删除</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}
