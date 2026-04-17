import clsx from 'clsx'
import { Check, Copy, PencilLine, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useAutoResize } from '../../hooks/useAutoResize'

function formatCompactTimestamp(timestamp: number): string {
  const value = new Date(timestamp)
  const now = new Date()
  const isSameYear = now.getFullYear() === value.getFullYear()
  const isSameDay = isSameYear
    && now.getMonth() === value.getMonth()
    && now.getDate() === value.getDate()

  if (isSameDay) {
    return new Intl.DateTimeFormat('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(timestamp)
  }

  if (isSameYear) {
    return new Intl.DateTimeFormat('zh-CN', {
      month: 'numeric',
      day: 'numeric',
    }).format(timestamp)
  }

  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).format(timestamp)
}

function formatFullTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

interface UserMessageBubbleProps {
  content: string
  timestamp: number
  onResend?: () => void
  onEdit?: (nextContent: string) => void
}

export function UserMessageBubble({
  content,
  timestamp,
  onResend,
  onEdit,
}: UserMessageBubbleProps) {
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [copied, setCopied] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [isOverflowing, setIsOverflowing] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(content)
  const editorRef = useAutoResize(draft, 14)

  const compactTimestamp = useMemo(() => formatCompactTimestamp(timestamp), [timestamp])
  const fullTimestamp = useMemo(() => formatFullTimestamp(timestamp), [timestamp])
  const normalizedContent = content.trim()
  const normalizedDraft = draft.trim()
  const canSaveEdit = normalizedDraft.length > 0 && normalizedDraft !== normalizedContent && typeof onEdit === 'function'

  useEffect(() => {
    setDraft(content)
    setIsExpanded(false)
    setIsEditing(false)
  }, [content])

  useEffect(() => {
    if (!isEditing) return

    const frameId = window.requestAnimationFrame(() => {
      const editor = editorRef.current
      if (!editor) return
      editor.focus()
      const end = editor.value.length
      editor.setSelectionRange(end, end)
    })

    return () => window.cancelAnimationFrame(frameId)
  }, [editorRef, isEditing])

  useEffect(() => {
    if (isEditing || isExpanded) return

    const element = contentRef.current
    if (!element) return

    const measure = () => {
      setIsOverflowing(element.scrollHeight > element.clientHeight + 1)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)

    return () => observer.disconnect()
  }, [content, isEditing, isExpanded])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  const handleCancelEdit = () => {
    setDraft(content)
    setIsEditing(false)
  }

  const handleSaveEdit = () => {
    if (!onEdit || !canSaveEdit) return
    onEdit(normalizedDraft)
  }

  const handleEditorKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      handleCancelEdit()
      return
    }

    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      handleSaveEdit()
    }
  }

  return (
    <div className="flex max-w-full flex-col items-end">
      <div className={clsx(
        'max-w-full rounded-[1.6rem] border border-border/70 bg-user-bubble px-4 py-3 text-text-primary',
        isEditing ? 'w-[min(100%,42rem)]' : 'w-fit',
      )}>
        {isEditing ? (
          <div className="space-y-3">
            <textarea
              ref={editorRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={handleEditorKeyDown}
              rows={1}
              className={clsx(
                'chat-scrollbar min-h-24 w-full resize-none rounded-[1.25rem] border border-[color:var(--color-accent)]/45 bg-surface px-4 py-3',
                'font-serif-mix text-base leading-[1.6] text-text-primary outline-none',
                'shadow-[inset_0_0_0_1px_rgba(59,130,246,0.08)]',
              )}
            />
            <div className="flex items-end justify-between gap-4">
              <p className="text-xs leading-relaxed text-text-secondary">
                编辑后会从这条用户消息重新开始生成后续回复。
              </p>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="inline-flex h-9 items-center justify-center rounded-full border border-border bg-surface px-4 text-sm font-medium text-text-primary transition-colors hover:bg-hover"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={!canSaveEdit}
                  className={clsx(
                    'inline-flex h-9 items-center justify-center rounded-full px-4 text-sm font-medium transition-colors',
                    canSaveEdit
                      ? 'bg-text-primary text-surface hover:opacity-90'
                      : 'cursor-not-allowed bg-text-primary/20 text-text-muted',
                  )}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className="relative">
              <div
                ref={contentRef}
                className={clsx(
                  'whitespace-pre-wrap break-words font-serif-mix text-base leading-[1.6]',
                  !isExpanded && 'overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:8]',
                )}
              >
                {content}
              </div>
              {!isExpanded && isOverflowing && (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-user-bubble via-user-bubble/96 to-transparent" />
              )}
            </div>

            {isOverflowing && (
              <button
                type="button"
                onClick={() => setIsExpanded((prev) => !prev)}
                className="mt-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
              >
                {isExpanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}
      </div>

      {!isEditing && (
        <div className="mt-2 flex items-center justify-end gap-1.5 pr-1 text-[13px] text-text-secondary">
          <time dateTime={new Date(timestamp).toISOString()} title={fullTimestamp}>
            {compactTimestamp}
          </time>
          {onResend && (
            <button
              type="button"
              onClick={onResend}
              className="inline-flex size-8 items-center justify-center rounded-full transition-colors hover:bg-hover hover:text-text-primary"
              aria-label="重新发送问题"
              title="重新发送问题"
            >
              <RotateCcw className="size-4" />
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={() => setIsEditing(true)}
              className="inline-flex size-8 items-center justify-center rounded-full transition-colors hover:bg-hover hover:text-text-primary"
              aria-label="编辑消息"
              title="编辑消息"
            >
              <PencilLine className="size-4" />
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex size-8 items-center justify-center rounded-full transition-colors hover:bg-hover hover:text-text-primary"
            aria-label="复制消息"
            title="复制消息"
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
          </button>
        </div>
      )}
    </div>
  )
}
