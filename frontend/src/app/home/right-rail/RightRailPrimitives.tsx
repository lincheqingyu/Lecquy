// 中文：本文件（RightRailPrimitives.tsx）位于 frontend/src/app/home/right-rail/RightRailPrimitives.tsx，属于frontend链路中的frontend 模块实现代码，连接上游调用方与下游执行逻辑。
// English: This file (RightRailPrimitives.tsx) belongs to the frontend frontend 模块实现 layer in frontend/src/app/home/right-rail/RightRailPrimitives.tsx, wiring upstream callers with downstream runtime logic.

import { ChevronDown, ChevronRight, X } from 'lucide-react'
import { clsx } from 'clsx'
import { useState, type ReactNode } from 'react'

interface RightRailShellProps {
  isOpen: boolean
  width?: string
  ariaLabel: string
  children: ReactNode
}

export function RightRailShell({
  isOpen,
  width = '20rem',
  ariaLabel,
  children,
}: RightRailShellProps) {
  return (
    <aside
      className="order-last ml-auto shrink-0 overflow-hidden bg-surface-alt transition-[width] duration-200 ease-out"
      style={{ width: isOpen ? width : '0' }}
      role="complementary"
      aria-label={ariaLabel}
      aria-hidden={!isOpen}
      inert={!isOpen}
    >
      <div className="flex h-full flex-col bg-surface-alt px-2.5 pb-3" style={{ width }}>
        {children}
      </div>
    </aside>
  )
}

interface RightRailHeaderProps {
  eyebrow?: string
  title: string
  subtitle?: string
  onClose: () => void
}

export function RightRailHeader({
  eyebrow,
  title,
  subtitle,
  onClose,
}: RightRailHeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && (
          <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-text-muted">
            {eyebrow}
          </div>
        )}
        <div className="truncate text-sm font-semibold text-text-primary">{title}</div>
        {subtitle && <div className="truncate text-xs text-text-muted">{subtitle}</div>}
      </div>
      <button
        type="button"
        onClick={onClose}
        className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
        aria-label="关闭右侧工作区"
      >
        <X className="size-4" />
      </button>
    </header>
  )
}

interface RightRailCardProps {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
  collapsible?: boolean
  defaultExpanded?: boolean
}

export function RightRailCard({
  title,
  description,
  action,
  children,
  className,
  collapsible = true,
  defaultExpanded = true,
}: RightRailCardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded)
  const showBody = !collapsible || isExpanded

  return (
    <section
      className={clsx(
        'rounded-xl border border-border/60 bg-surface px-3.5 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.035)]',
        'dark:border-white/[0.06] dark:shadow-none',
        className,
      )}
      aria-label={title}
    >
      <div className={clsx('flex items-start justify-between gap-3', showBody && 'mb-2.5')}>
        <button
          type="button"
          onClick={() => collapsible && setIsExpanded((current) => !current)}
          className={clsx(
            'flex min-w-0 flex-1 items-start justify-between gap-3 text-left outline-none',
            collapsible && 'cursor-pointer',
            !collapsible && 'cursor-default',
          )}
          aria-expanded={collapsible ? isExpanded : undefined}
        >
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-text-primary">{title}</span>
            {description && showBody && (
              <span className="mt-0.5 block text-xs leading-5 text-text-muted">{description}</span>
            )}
          </span>
          {collapsible && (
            <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center text-text-muted">
              {isExpanded ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            </span>
          )}
        </button>
        <div className="flex shrink-0 items-center gap-1.5">{action}</div>
      </div>
      {showBody && children}
    </section>
  )
}

interface RightRailListItemProps {
  label: string
  description?: string
  muted?: boolean
  className?: string
  children: ReactNode
}

export function RightRailListItem({
  label,
  description,
  muted = false,
  className,
  children,
}: RightRailListItemProps) {
  return (
    <div className={clsx('py-1.5', muted && 'pointer-events-none opacity-50', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm leading-6 text-text-primary">{label}</div>
          {description && (
            <div className="mt-0.5 text-xs leading-5 text-text-muted">{description}</div>
          )}
        </div>
        <div className="min-w-0 shrink-0">{children}</div>
      </div>
    </div>
  )
}

interface RightRailEmptyStateProps {
  title: string
  description: string
}

export function RightRailEmptyState({ title, description }: RightRailEmptyStateProps) {
  return (
    <RightRailCard title={title}>
      <p className="text-sm leading-6 text-text-secondary">{description}</p>
    </RightRailCard>
  )
}
