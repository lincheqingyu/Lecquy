import { Check, ShieldAlert, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { ServerRequestPayload } from '@lecquy/shared'

interface ApprovalCardProps {
  request: ServerRequestPayload
  onDecision: (decision: 'accept' | 'decline') => boolean
}

function formatPermissionMode(mode: ServerRequestPayload['approval']['mode']): string {
  switch (mode) {
    case 'default':
      return 'default'
    case 'dontAsk':
      return 'dontAsk'
    case 'plan':
      return 'plan'
    case 'acceptEdits':
      return 'acceptEdits'
    case 'bypassPermissions':
      return 'bypassPermissions'
    default:
      return mode
  }
}

export function ApprovalCard({ request, onDecision }: ApprovalCardProps) {
  const [submittingDecision, setSubmittingDecision] = useState<'accept' | 'decline' | null>(null)

  const commandPreview = useMemo(() => (
    request.approval.operation.displayCommand
    ?? request.approval.operation.filePath
    ?? request.description
  ), [request])

  const handleDecision = (decision: 'accept' | 'decline') => {
    setSubmittingDecision(decision)
    const sent = onDecision(decision)
    if (!sent) {
      setSubmittingDecision(null)
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-input-surface px-4 py-4 shadow-[var(--shadow-input)]">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-500/12 text-amber-600 dark:text-amber-300">
          <ShieldAlert className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-text-primary">
            {request.title}
          </div>
          <div className="mt-1 text-xs text-text-muted">
            当前权限模式：{formatPermissionMode(request.approval.mode)}
          </div>
        </div>
      </div>

      <pre className="mt-3 overflow-x-auto rounded-xl border border-border bg-surface px-3 py-3 text-[12px] leading-relaxed text-text-primary">
        {commandPreview}
      </pre>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => handleDecision('accept')}
          disabled={submittingDecision !== null}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-text-primary px-4 text-sm font-medium text-surface transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Check className="size-4" />
          批准此次
        </button>
        <button
          type="button"
          onClick={() => handleDecision('decline')}
          disabled={submittingDecision !== null}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-border px-4 text-sm font-medium text-text-primary transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-60"
        >
          <X className="size-4" />
          拒绝
        </button>
      </div>
    </div>
  )
}
