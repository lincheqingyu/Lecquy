// 中文：本文件（FileCardShell.tsx）位于 frontend/src/components/files/FileCardShell.tsx，属于frontend链路中的前端组件代码，连接上游调用方与下游执行逻辑。
// English: This file (FileCardShell.tsx) belongs to the frontend 前端组件 layer in frontend/src/components/files/FileCardShell.tsx, wiring upstream callers with downstream runtime logic.

import clsx from 'clsx'
import type { ReactNode } from 'react'

interface FileCardShellProps {
  title: ReactNode
  meta: ReactNode
  icon: ReactNode
  action?: ReactNode
  active?: boolean
  onClick?: () => void
  className?: string
}

export function FileCardShell({
  title,
  meta,
  icon,
  action,
  active = false,
  onClick,
  className,
}: FileCardShellProps) {
  const sharedClassName = clsx(
    'group flex w-full items-center gap-3 rounded-[1.35rem] border bg-surface px-4 py-3 text-left transition-all',
    'shadow-[0_10px_24px_rgba(15,23,42,0.05)] dark:border-[#5a5a55] dark:bg-[rgb(38,38,36)] dark:shadow-[0_12px_28px_rgba(0,0,0,0.24)]',
    onClick && 'hover:-translate-y-0.5 hover:border-[color:var(--border-strong)] hover:shadow-[0_14px_34px_rgba(15,23,42,0.08)] dark:hover:shadow-[0_16px_34px_rgba(0,0,0,0.34)]',
    active ? 'border-[color:var(--border-strong)] shadow-[0_14px_34px_rgba(15,23,42,0.08)] dark:shadow-[0_16px_34px_rgba(0,0,0,0.34)]' : 'border-border/80',
    className,
  )
  const body = (
    <>
      <span className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-surface-alt text-text-secondary transition-colors group-hover:text-text-primary dark:bg-[rgb(31,32,35)] dark:text-[#c9c5bc] dark:group-hover:text-[#f3f1ea]">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-text-primary">{title}</div>
        <div className="mt-1 truncate text-xs text-text-secondary">{meta}</div>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={sharedClassName}>
        {body}
      </button>
    )
  }

  return (
    <div className={sharedClassName}>
      {body}
    </div>
  )
}
