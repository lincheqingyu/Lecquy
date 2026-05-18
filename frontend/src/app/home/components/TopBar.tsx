// 中文：本文件（TopBar.tsx）位于 frontend/src/app/home/components/TopBar.tsx，属于frontend链路中的前端组件代码，连接上游调用方与下游执行逻辑。
// English: This file (TopBar.tsx) belongs to the frontend 前端组件 layer in frontend/src/app/home/components/TopBar.tsx, wiring upstream callers with downstream runtime logic.

interface TopBarProps {
  conversationTitle: string
  sessionMetaText?: string | null
}

export function TopBar({
  conversationTitle,
  sessionMetaText = null,
}: TopBarProps) {
  return (
    <header className="h-12 shrink-0 bg-surface-alt/95 backdrop-blur">
      <div className="flex h-full w-full items-center justify-between px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="line-clamp-1 text-sm font-medium text-text-primary">
            {conversationTitle}
          </h1>
          {sessionMetaText && (
            <div className="shrink-0 text-xs text-text-muted">
              {sessionMetaText}
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
