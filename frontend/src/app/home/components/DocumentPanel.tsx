import clsx from 'clsx'
import { ArrowLeft, Image as ImageIcon, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ChatAttachment } from '@lecquy/shared'
import { buildAttachmentPreviewUrl } from '../../../lib/chat-attachments'
import { renderMarkdown } from '../../../components/chat/MessageItem'

interface OpenDocument {
  key: string
  attachment: ChatAttachment
}

interface DocumentPanelProps {
  document: OpenDocument
  width: number
  onClose: () => void
}

interface SectionBlock {
  id: string
  label: string
  content: string
}

function formatBytes(size?: number): string {
  if (!size) return 'Unknown size'
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size >= 10 * 1024 ? 0 : 1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

function inferAttachmentExtension(name: string): string {
  const parts = name.toLowerCase().split('.')
  return parts.length > 1 ? parts.at(-1) ?? '' : ''
}

function inferDocumentType(attachment: ChatAttachment): 'image' | 'pdf' | 'docx' | 'excel' | 'markdown' | 'text' {
  if (attachment.kind === 'image') return 'image'

  const mime = attachment.mimeType.toLowerCase()
  const extension = inferAttachmentExtension(attachment.name)

  if (mime.includes('markdown') || extension === 'md' || extension === 'markdown') return 'markdown'
  if (mime.includes('pdf')) return 'pdf'
  if (mime.includes('wordprocessingml') || extension === 'docx') return 'docx'
  if (mime.includes('spreadsheetml') || mime.includes('ms-excel') || extension === 'xlsx' || extension === 'xls' || extension === 'csv') return 'excel'
  return 'text'
}

function documentTypeLabel(type: ReturnType<typeof inferDocumentType>): string {
  switch (type) {
    case 'image':
      return 'Image'
    case 'pdf':
      return 'PDF'
    case 'docx':
      return 'DOCX'
    case 'excel':
      return 'Excel'
    case 'markdown':
      return 'Markdown'
    default:
      return 'Text'
  }
}

function parseTaggedSections(
  text: string,
  tagName: string,
  labelFactory: (attrs: Record<string, string>, index: number) => string,
): SectionBlock[] {
  const pattern = new RegExp(`<${tagName}([^>]*)>([\\s\\S]*?)<\\/${tagName}>`, 'g')
  const sections: SectionBlock[] = []
  let match: RegExpExecArray | null
  let index = 0

  while ((match = pattern.exec(text)) !== null) {
    const attrsRaw = match[1] ?? ''
    const content = match[2]?.trim() ?? ''
    if (!content) continue

    const attrs: Record<string, string> = {}
    for (const attrMatch of attrsRaw.matchAll(/(\w+)="([^"]*)"/g)) {
      attrs[attrMatch[1]] = attrMatch[2]
    }

    sections.push({
      id: `${tagName}_${index}`,
      label: labelFactory(attrs, index),
      content,
    })
    index += 1
  }

  return sections
}

function parseDocumentSections(attachment: ChatAttachment): SectionBlock[] {
  if (attachment.kind === 'image') return []

  const type = inferDocumentType(attachment)
  const text = attachment.text.trim()

  if (type === 'pdf') {
    const pages = parseTaggedSections(text, 'page', (attrs, index) => `Page ${attrs.number ?? index + 1}`)
    if (pages.length > 0) return pages
  }

  if (type === 'docx') {
    const pages = parseTaggedSections(text, 'page', (attrs, index) => `Page ${attrs.number ?? index + 1}`)
    if (pages.length > 0) return pages
  }

  if (type === 'excel') {
    const sheets = parseTaggedSections(text, 'sheet', (attrs, index) => attrs.name || `Sheet ${attrs.index ?? index + 1}`)
    if (sheets.length > 0) return sheets
  }

  return [{ id: 'plain', label: 'Content', content: text }]
}

function stripWrapperTags(text: string): string {
  return text
    .replace(/^<\w+[^>]*>\s*/i, '')
    .replace(/\s*<\/\w+>\s*$/i, '')
    .trim()
}

function renderTextParagraphs(text: string, mono = false) {
  const cleaned = stripWrapperTags(text)
  const paragraphs = cleaned.split(/\n{2,}/).map((chunk) => chunk.trim()).filter(Boolean)

  if (paragraphs.length === 0) {
    return <div className="text-sm text-text-secondary">暂无可展示内容</div>
  }

  return (
    <div className={clsx('space-y-4', mono && 'font-mono text-[13px] leading-6')}>
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="whitespace-pre-wrap break-words text-sm leading-7 text-text-primary">
          {paragraph}
        </p>
      ))}
    </div>
  )
}

export function DocumentPanel({ document, width, onClose }: DocumentPanelProps) {
  const { attachment } = document
  const documentType = inferDocumentType(attachment)
  const sections = useMemo(() => parseDocumentSections(attachment), [attachment])
  const [activeSectionId, setActiveSectionId] = useState<string | null>(sections[0]?.id ?? null)

  useEffect(() => {
    setActiveSectionId(sections[0]?.id ?? null)
  }, [sections])

  const activeSection = sections.find((section) => section.id === activeSectionId) ?? sections[0] ?? null
  const imageUrl = attachment.kind === 'image' ? buildAttachmentPreviewUrl(attachment) : null

  return (
    <aside
      className="flex h-full min-h-0 min-w-[22rem] shrink-0 flex-col overflow-hidden border-l border-border/70 bg-surface"
      style={{ width }}
    >
      <div className="flex shrink-0 items-start gap-2 border-b border-border/70 bg-surface px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          className="inline-flex size-9 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
          aria-label="关闭文档面板"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[1.5rem] font-semibold leading-tight text-text-primary">
            {attachment.name}
          </div>
          <div className="mt-1 text-xs text-text-secondary">
            {formatBytes(attachment.size)} · {documentTypeLabel(documentType)}
            {attachment.kind === 'file' && attachment.truncated ? ' · 内容已截断' : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex size-9 items-center justify-center rounded-xl text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
          aria-label="关闭文档"
        >
          <X className="size-5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden bg-surface">
        {attachment.kind === 'image' ? (
          <div className="flex h-full min-h-0 items-center justify-center overflow-auto bg-surface px-6 py-6">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={attachment.name}
                className="max-h-[calc(100vh-12rem)] max-w-full rounded-[1rem] object-contain shadow-[0_18px_38px_rgba(15,23,42,0.12)]"
              />
            ) : (
              <div className="flex h-64 w-64 items-center justify-center rounded-[1rem] border border-dashed border-border/80 bg-surface text-text-secondary">
                <ImageIcon className="size-10" />
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full min-h-0 overflow-hidden bg-surface">
            {documentType === 'excel' && sections.length > 1 && (
              <div className="w-44 shrink-0 border-r border-border/70 bg-surface p-3">
                <div className="mb-3 px-2 text-xs font-medium uppercase tracking-[0.14em] text-text-muted">Sheets</div>
                <div className="space-y-1">
                  {sections.map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setActiveSectionId(section.id)}
                      className={clsx(
                        'w-full rounded-xl px-3 py-2 text-left text-sm transition-colors',
                        activeSectionId === section.id
                          ? 'border border-border/70 bg-surface-alt text-text-primary'
                          : 'text-text-secondary hover:bg-hover hover:text-text-primary',
                      )}
                    >
                      <div className="truncate">{section.label}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-hidden bg-surface">
              <div className="h-full overflow-y-auto px-6 py-5">
                <div className="mx-auto max-w-4xl">
                {documentType === 'excel' ? (
                  <>
                    {activeSection && (
                      <>
                        <div className="overflow-x-auto rounded-2xl border border-border/70 bg-surface px-4 py-3">
                          {renderTextParagraphs(activeSection.content, true)}
                        </div>
                      </>
                    )}
                  </>
                ) : documentType === 'markdown' ? (
                  renderMarkdown(activeSection?.content ?? attachment.text)
                ) : activeSection || (attachment.kind === 'file' && attachment.text.trim().length > 0) ? (
                  renderTextParagraphs(activeSection?.content ?? attachment.text, false)
                ) : (
                  <div className="rounded-2xl border border-dashed border-border/70 bg-surface px-4 py-5 text-sm text-text-secondary">
                    当前未能从该文档中提取可展示内容。请重新上传，或换用更容易解析的格式。
                  </div>
                )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
