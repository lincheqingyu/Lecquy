// 中文：本文件（ConversationSidebar.tsx）位于 frontend/src/app/home/components/ConversationSidebar.tsx，属于frontend链路中的前端组件代码，连接上游调用方与下游执行逻辑。
// English: This file (ConversationSidebar.tsx) belongs to the frontend 前端组件 layer in frontend/src/app/home/components/ConversationSidebar.tsx, wiring upstream callers with downstream runtime logic.

import { Ellipsis, MessageSquareText, PanelLeftClose, PanelLeftOpen, Pencil, Plus, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

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
  isDark: boolean
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
  isDark,
}: ConversationSidebarProps) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null)
  const [menuPlacement, setMenuPlacement] = useState<'up' | 'down'>('down')
  const menuRef = useRef<HTMLDivElement | null>(null)
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)
  const menuPanelRef = useRef<HTMLDivElement | null>(null)

  const updateMenuPlacement = useCallback(() => {
    const button = menuButtonRef.current
    const panel = menuPanelRef.current
    if (!button || !panel) return

    const buttonRect = button.getBoundingClientRect()
    const panelRect = panel.getBoundingClientRect()
    const gap = 8
    const requiredHeight = panelRect.height + gap
    const spaceAbove = buttonRect.top
    const spaceBelow = window.innerHeight - buttonRect.bottom

    if (spaceBelow >= requiredHeight) {
      setMenuPlacement('down')
      return
    }

    if (spaceAbove >= requiredHeight) {
      setMenuPlacement('up')
      return
    }

    setMenuPlacement(spaceAbove > spaceBelow ? 'up' : 'down')
  }, [])

  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setMenuOpenId(null)
      }
    }

    window.addEventListener('mousedown', handlePointerDown)
    return () => window.removeEventListener('mousedown', handlePointerDown)
  }, [])

  useLayoutEffect(() => {
    if (!menuOpenId) return
    updateMenuPlacement()
  }, [menuOpenId, updateMenuPlacement])

  useEffect(() => {
    if (!menuOpenId) return

    const handleLayoutChange = () => {
      updateMenuPlacement()
    }

    window.addEventListener('resize', handleLayoutChange)
    document.addEventListener('scroll', handleLayoutChange, true)

    return () => {
      window.removeEventListener('resize', handleLayoutChange)
      document.removeEventListener('scroll', handleLayoutChange, true)
    }
  }, [menuOpenId, updateMenuPlacement])

  return (
    <aside
      className={[
        'h-full shrink-0 border-r border-border/60',
        'transition-[width] duration-300 ease-out',
        collapsed ? 'w-12 bg-surface-alt' : 'w-[16.5rem] bg-sidebar-panel',
      ].join(' ')}
      aria-label="会话管理栏"
    >
      <div className="flex h-full flex-col">
        {/* 顶部：折叠态为 Logo（hover 瞬间切换为展开图标）；展开态为纯文字品牌 + 收起按钮 */}
        {collapsed ? (
          <div className="shrink-0 px-2 pb-1.5 pt-3">
            <button
              type="button"
              onClick={onToggleCollapse}
              className="group flex h-11 w-full items-center justify-center rounded-xl text-text-primary transition-colors hover:bg-sidebar-hover"
              aria-label="展开会话栏"
              title="展开会话栏"
            >
              {/* 默认：显示 Logo；hover 时瞬间隐藏 */}
              <img
                src={isDark ? '/logo-dark-mode.png' : '/logo-light-mode.png'}
                alt=""
                aria-hidden="true"
                className="h-7 w-7 shrink-0 object-contain group-hover:hidden"
                loading="eager"
              />
              {/* hover 时：瞬间显示展开图标 */}
              <PanelLeftOpen className="hidden size-[18px] shrink-0 group-hover:block" />
            </button>
          </div>
        ) : (
          <div className="shrink-0 px-3 pb-6 pt-3">
            {/* pl-3：把标题往内推 12px，与下方菜单按钮内部图标起点（12+12=24px）对齐 */}
            <div className="flex h-11 w-full items-center justify-between pl-3">
              {/* 品牌区：衬线纯文字标题（沿用 Claude 做法） */}
              <span className="font-serif-mix whitespace-nowrap text-[2rem] font-normal leading-none text-text-primary">
                Lecquy
              </span>

              {/* 收起按钮：默认主文字色（黑/白），hover 仅加背景 */}
              <button
                type="button"
                onClick={onToggleCollapse}
                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-text-primary transition-colors hover:bg-sidebar-hover"
                aria-label="收起会话栏"
                title="收起会话栏"
              >
                <PanelLeftClose className="size-[18px] shrink-0" />
              </button>
            </div>
          </div>
        )}

        {/* 菜单区：新建会话 / 会话 —— 展开态 flex + px-3 + gap-3；折叠态窄栏圆角收小为 rounded-xl */}
        <div className={collapsed ? 'px-2 pb-3' : 'px-3 pb-3'}>
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={onCreateConversation}
              className={
                collapsed
                  ? 'flex h-11 w-full items-center justify-center rounded-xl text-text-primary transition-colors hover:bg-sidebar-hover'
                  : 'flex h-11 w-full items-center gap-3 rounded-2xl px-3 text-left text-text-primary transition-colors hover:bg-sidebar-hover'
              }
              aria-label="新建会话"
              title="新建会话"
            >
              {/* "+" 图标：展开态带实心圆底色作为视觉焦点；折叠态仅显示图标 */}
              <span
                className={
                  collapsed
                    ? 'inline-flex size-7 shrink-0 items-center justify-center'
                    : 'inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-sidebar-active'
                }
              >
                <Plus className="size-5 shrink-0" />
              </span>
              {!collapsed && <span className="truncate text-sm font-medium">新建会话</span>}
            </button>

            <button
              type="button"
              onClick={onOpenSessions}
              className={
                collapsed
                  ? 'flex h-11 w-full items-center justify-center rounded-xl text-text-primary transition-colors hover:bg-sidebar-hover'
                  : [
                      'flex h-11 w-full items-center gap-3 rounded-2xl px-3 text-left text-text-primary',
                      activeView === 'sessions'
                        ? 'bg-sidebar-active'
                        : 'transition-colors hover:bg-sidebar-hover',
                    ].join(' ')
              }
              aria-label="会话"
              title="会话"
              aria-current={activeView === 'sessions' ? 'page' : undefined}
            >
              {/* 会话图标：仅在"折叠 + 选中"时加圆底色，其余情况均为纯图标 */}
              <span
                className={
                  collapsed && activeView === 'sessions'
                    ? 'inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-sidebar-active'
                    : 'inline-flex size-7 shrink-0 items-center justify-center'
                }
              >
                <MessageSquareText className="size-[18px] shrink-0" />
              </span>
              {!collapsed && <span className="truncate text-sm font-medium">会话</span>}
            </button>
          </div>
        </div>

        {!collapsed && (
          <div className="chat-scrollbar min-h-0 flex-1 overflow-y-auto overflow-x-hidden pl-3 pr-0 pb-3">
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
                            ref={menuOpenId === conversation.id ? menuButtonRef : null}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setMenuPlacement('down')
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
                            <div
                              ref={menuPanelRef}
                              className={[
                                'absolute right-0 z-20 min-w-40 rounded-2xl border border-border/80 bg-surface p-1.5 shadow-[0_18px_48px_rgba(15,23,42,0.12)]',
                                menuPlacement === 'up' ? 'bottom-10' : 'top-10',
                              ].join(' ')}
                            >
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
