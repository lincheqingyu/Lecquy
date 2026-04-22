import clsx from 'clsx'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type { ReactNode } from 'react'

export interface TimelineEventProps {
  icon: ReactNode
  verb: ReactNode
  target?: ReactNode
  status?: 'pending' | 'streaming' | 'ready' | 'error'
  onTargetClick?: () => void
  expandable?: boolean
  expanded?: boolean
  onToggleExpanded?: () => void
  children?: ReactNode
  actions?: ReactNode
}

function EventIcon({ icon, status = 'ready' }: Pick<TimelineEventProps, 'icon' | 'status'>) {
  return (
    <span
      aria-hidden
      className={clsx(
        'inline-flex size-3.5 shrink-0 items-center justify-center text-text-muted',
        '[&_svg]:size-3.5 [&_svg]:shrink-0',
        status === 'streaming' && '[&_svg]:animate-spin',
        status === 'error' && 'text-[#b44a4a] dark:text-[#f2b8b8]',
      )}
    >
      {icon}
    </span>
  )
}

function EventTarget({
  target,
  onClick,
}: {
  target?: ReactNode
  onClick?: () => void
}) {
  if (!target) return null

  if (!onClick) {
    return <span className="min-w-0 flex-1 truncate text-text-muted">{target}</span>
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className="min-w-0 flex-1 truncate text-left text-text-muted transition-colors hover:text-text-primary hover:underline"
    >
      {target}
    </button>
  )
}

export function TimelineEvent({
  icon,
  verb,
  target,
  status = 'ready',
  onTargetClick,
  expandable = false,
  expanded = false,
  onToggleExpanded,
  children,
  actions,
}: TimelineEventProps) {
  if (!expandable) {
    return (
      <div className="flex h-6 min-w-0 items-center gap-2 text-[13px] leading-[1.55]">
        <EventIcon icon={icon} status={status} />
        <span className="shrink-0 text-text-secondary">{verb}</span>
        <EventTarget target={target} onClick={onTargetClick} />
      </div>
    )
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="flex h-6 w-full min-w-0 items-center gap-2 text-left text-[13px] leading-[1.55] transition-colors hover:text-text-primary"
        aria-expanded={expanded}
      >
        <EventIcon icon={icon} status={status} />
        <span className="shrink-0 text-text-secondary">{verb}</span>
        <EventTarget target={target} />
        <span className="ml-auto inline-flex shrink-0 text-text-muted">
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </span>
      </button>

      {expanded && (
        <div className={clsx('relative pl-[18px] pt-1.5', actions && 'pr-9')}>
          <span
            aria-hidden
            className="absolute left-[7px] top-1.5 bottom-0 w-px bg-border"
          />
          {actions ? (
            <div className="absolute top-1.5 right-0">
              {actions}
            </div>
          ) : null}
          <div className="text-[13px] leading-[1.55] text-text-secondary">
            {children}
          </div>
        </div>
      )}
    </div>
  )
}
