import clsx from 'clsx'
import { ChevronDown, Code2, Copy, Eye, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'

export type FilePreviewViewMode = 'preview' | 'source'

export interface FilePreviewActionItem {
  label: string
  onSelect: () => void
  disabled?: boolean
}

interface FilePreviewPanelHeaderProps {
  title: ReactNode
  meta?: string
  viewMode?: FilePreviewViewMode
  onViewModeChange?: (mode: FilePreviewViewMode) => void
  onCopy?: () => void | Promise<void>
  copied?: boolean
  actionItems?: FilePreviewActionItem[]
  onRefresh?: () => void
  refreshDisabled?: boolean
  onClose: () => void
}

export function FilePreviewPanelHeader({
  title,
  meta,
  viewMode,
  onViewModeChange,
  onCopy,
  copied = false,
  actionItems = [],
  onRefresh,
  refreshDisabled = false,
  onClose,
}: FilePreviewPanelHeaderProps) {
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false)
  const actionMenuRef = useRef<HTMLDivElement | null>(null)
  const hasCopyButton = Boolean(onCopy)
  const hasSplitActions = Boolean(onCopy) && actionItems.length > 0

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (actionMenuRef.current?.contains(target)) return
      setIsActionMenuOpen(false)
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [])

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 bg-surface px-4 py-3">
      <div className="min-w-0 flex items-center gap-2">
        {onViewModeChange ? (
          <div className="relative inline-grid h-9 w-16 grid-cols-2 items-center rounded-[1rem] bg-[rgb(248,248,246)] p-1 dark:bg-[#2a2b2f]">
            <span
              aria-hidden="true"
              className={clsx(
                'pointer-events-none absolute left-1 top-1 h-7 w-7 rounded-[0.8rem] bg-surface shadow-[0_1px_3px_rgba(15,23,42,0.12)] transition-transform duration-200 ease-out dark:bg-[#1f2023]',
                viewMode === 'source' && 'translate-x-7',
              )}
            />
            <button
              type="button"
              onClick={() => onViewModeChange('preview')}
              className={clsx(
                'relative z-10 inline-flex size-7 items-center justify-center rounded-[0.8rem] transition-colors',
                viewMode === 'preview'
                  ? 'text-text-primary'
                  : 'text-text-secondary hover:text-text-primary',
              )}
              aria-label="预览模式"
              aria-pressed={viewMode === 'preview'}
            >
              <Eye className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => onViewModeChange('source')}
              className={clsx(
                'relative z-10 inline-flex size-7 items-center justify-center rounded-[0.8rem] transition-colors',
                viewMode === 'source'
                  ? 'text-text-primary'
                  : 'text-text-secondary hover:text-text-primary',
              )}
              aria-label="源码模式"
              aria-pressed={viewMode === 'source'}
            >
              <Code2 className="size-3.5" />
            </button>
          </div>
        ) : null}

        <div className="min-w-0">
          <div className="truncate text-[0.94rem] font-normal leading-tight text-text-primary">
            {title}
          </div>
          {meta ? <div className="mt-0.75 text-[11px] text-text-secondary">{meta}</div> : null}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        {hasSplitActions ? (
          <div ref={actionMenuRef} className="relative">
            <div className="inline-flex h-9 items-stretch overflow-hidden rounded-[1rem] border border-user-bubble bg-surface">
              <button
                type="button"
                onClick={() => void onCopy?.()}
                className="inline-flex items-center justify-center px-3 text-[12.5px] font-normal text-text-primary transition-colors hover:bg-user-bubble disabled:cursor-not-allowed disabled:text-text-muted"
                disabled={!onCopy}
              >
                <Copy className="mr-1.5 size-3.5" />
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={() => setIsActionMenuOpen((value) => !value)}
                className="inline-flex w-9 items-center justify-center border-l border-user-bubble text-text-primary transition-colors hover:bg-user-bubble"
                aria-label={isActionMenuOpen ? '关闭操作菜单' : '打开操作菜单'}
                aria-expanded={isActionMenuOpen}
              >
                <ChevronDown className={clsx('size-3.5 transition-transform', isActionMenuOpen && 'rotate-180')} />
              </button>
            </div>

            {isActionMenuOpen && actionItems.length > 0 ? (
              <div className="absolute right-0 top-[calc(100%+0.5rem)] z-20 w-max rounded-[1rem] border border-user-bubble bg-surface-raised p-1 shadow-[0_12px_32px_rgba(15,23,42,0.12)]">
                {actionItems.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      setIsActionMenuOpen(false)
                      item.onSelect()
                    }}
                    className="flex w-full items-center whitespace-nowrap rounded-[0.65rem] px-3 py-1.5 text-left text-[12.5px] font-normal text-text-primary transition-colors hover:bg-user-bubble disabled:cursor-not-allowed disabled:text-text-muted"
                    disabled={item.disabled}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        ) : hasCopyButton ? (
          <button
            type="button"
            onClick={() => void onCopy?.()}
            className="inline-flex h-9 items-center justify-center overflow-hidden rounded-[1rem] border border-user-bubble bg-surface px-3 text-[12.5px] font-normal text-text-primary transition-colors hover:bg-user-bubble disabled:cursor-not-allowed disabled:text-text-muted"
            disabled={!onCopy}
          >
            <Copy className="mr-1.5 size-3.5" />
            {copied ? 'Copied' : 'Copy'}
          </button>
        ) : null}

        {onRefresh ? (
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex size-9 items-center justify-center rounded-[1rem] text-text-primary transition-colors hover:bg-user-bubble disabled:cursor-not-allowed disabled:text-text-muted"
            aria-label="刷新预览"
            disabled={refreshDisabled}
          >
            <RefreshCw className="size-3.5" />
          </button>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          className="inline-flex size-9 items-center justify-center rounded-[1rem] text-text-secondary transition-colors hover:bg-user-bubble hover:text-text-primary"
          aria-label="关闭"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
