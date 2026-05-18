// 中文：本文件（AttachmentFileCard.tsx）位于 frontend/src/components/files/AttachmentFileCard.tsx，属于frontend链路中的前端组件代码，连接上游调用方与下游执行逻辑。
// English: This file (AttachmentFileCard.tsx) belongs to the frontend 前端组件 layer in frontend/src/components/files/AttachmentFileCard.tsx, wiring upstream callers with downstream runtime logic.

import clsx from 'clsx'
import { FileText } from 'lucide-react'
import type { ChatFileAttachment } from '@lecquy/shared'

interface AttachmentFileCardProps {
  attachment: ChatFileAttachment
  active?: boolean
  onOpen?: () => void
}

export const CHAT_ATTACHMENT_CARD_SIZE_CLASS = 'w-[12.5rem] max-w-full shrink-0'
export const CHAT_ATTACHMENT_CARD_PREVIEW_CLASS = 'flex aspect-square w-full items-center justify-center overflow-hidden bg-surface-alt dark:bg-[rgb(31,32,35)]'
export const CHAT_ATTACHMENT_CARD_BODY_CLASS = 'min-h-[4.25rem] border-t border-border/70 px-3 py-2.5'

function formatAttachmentMeta(attachment: ChatFileAttachment): string {
  const sizeLabel = attachment.size ? `${Math.max(1, Math.round(attachment.size / 1024))} KB` : null
  const mime = attachment.mimeType.toLowerCase()
  let typeLabel = '文档'

  if (mime.includes('pdf')) typeLabel = 'PDF'
  else if (mime.includes('wordprocessingml')) typeLabel = 'DOCX'
  else if (mime.includes('spreadsheetml') || mime.includes('ms-excel')) typeLabel = 'Excel'
  else if (mime.includes('markdown')) typeLabel = 'Markdown'
  else if (mime.includes('json')) typeLabel = 'JSON'
  else if (mime.startsWith('text/')) typeLabel = '文本'

  return sizeLabel ? `${typeLabel} · ${sizeLabel}` : typeLabel
}

export function AttachmentFileCard({ attachment, active = false, onOpen }: AttachmentFileCardProps) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={attachment.name}
      className={clsx(
        'group flex flex-col overflow-hidden rounded-[1.25rem] border bg-surface-thought text-left shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition-all',
        'dark:border-[#5a5a55] dark:bg-[rgb(38,38,36)] dark:shadow-[0_12px_28px_rgba(0,0,0,0.24)]',
        CHAT_ATTACHMENT_CARD_SIZE_CLASS,
        onOpen && 'hover:-translate-y-0.5 hover:border-[color:var(--border-strong)] hover:shadow-[0_14px_34px_rgba(15,23,42,0.10)] dark:hover:shadow-[0_16px_34px_rgba(0,0,0,0.34)]',
        active ? 'border-[color:var(--border-strong)] shadow-[0_14px_34px_rgba(15,23,42,0.10)] dark:shadow-[0_16px_34px_rgba(0,0,0,0.34)]' : 'border-border',
      )}
    >
      <div className={CHAT_ATTACHMENT_CARD_PREVIEW_CLASS}>
        <span className="inline-flex size-16 items-center justify-center rounded-[1.5rem] border border-border/70 bg-surface text-text-secondary transition-colors group-hover:text-text-primary dark:border-[#5a5a55] dark:bg-[rgb(38,38,36)] dark:text-[#c9c5bc] dark:group-hover:text-[#f3f1ea]">
          <FileText className="size-7" />
        </span>
      </div>
      <div className={CHAT_ATTACHMENT_CARD_BODY_CLASS}>
        <div className="truncate text-sm font-medium text-text-primary">{attachment.name}</div>
        <div className="mt-0.5 truncate text-xs text-text-secondary">{formatAttachmentMeta(attachment)}</div>
      </div>
    </button>
  )
}
