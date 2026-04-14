import clsx from 'clsx'
import { Image as ImageIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatAttachment } from '@lecquy/shared'
import { buildAttachmentPreviewUrl, getAttachmentDisplayText } from '../../../lib/chat-attachments'
import { renderMarkdown } from '../../../components/chat/MessageItem'
import { formatBytes, inferCodeLanguage, inferFileExtension, stripFileExtension } from '../../../lib/file-display'
import { ShikiCodeView } from '../../../components/artifacts/ShikiCodeView'
import { FilePreviewPanelHeader, type FilePreviewActionItem, type FilePreviewViewMode } from '../../../components/files/FilePreviewPanelHeader'
import { HtmlPreviewFrame } from '../../../components/files/HtmlPreviewFrame'
import { downloadTextContent, openPrintWindow } from '../../../lib/file-preview-actions'

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

const CODE_EXTENSIONS = new Set([
  'cjs',
  'css',
  'go',
  'java',
  'js',
  'json',
  'jsx',
  'mjs',
  'py',
  'rs',
  'scss',
  'sh',
  'sql',
  'ts',
  'tsx',
  'xml',
  'yaml',
  'yml',
])

function inferDocumentType(attachment: ChatAttachment): 'image' | 'pdf' | 'docx' | 'excel' | 'markdown' | 'html' | 'code' | 'text' {
  if (attachment.kind === 'image') return 'image'

  const mime = attachment.mimeType.toLowerCase()
  const extension = inferFileExtension(attachment.name)

  if (mime.includes('html') || extension === 'html' || extension === 'htm') return 'html'
  if (mime.includes('markdown') || extension === 'md' || extension === 'markdown') return 'markdown'
  if (mime.includes('pdf')) return 'pdf'
  if (mime.includes('wordprocessingml') || extension === 'docx') return 'docx'
  if (mime.includes('spreadsheetml') || mime.includes('ms-excel') || extension === 'xlsx' || extension === 'xls' || extension === 'csv') return 'excel'
  if (
    CODE_EXTENSIONS.has(extension)
    || mime.includes('javascript')
    || mime.includes('typescript')
    || mime.includes('json')
    || mime.includes('xml')
    || mime.includes('yaml')
  ) {
    return 'code'
  }
  return 'text'
}

function documentTypeLabel(attachment: ChatAttachment, type: ReturnType<typeof inferDocumentType>): string {
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
    case 'html':
      return 'HTML'
    case 'code': {
      const extension = inferFileExtension(attachment.name)
      return extension ? extension.toUpperCase() : 'Code'
    }
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
  const text = getAttachmentDisplayText(attachment).trim()

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
  const [viewMode, setViewMode] = useState<FilePreviewViewMode>('preview')
  const [copied, setCopied] = useState(false)
  const [previewRevision, setPreviewRevision] = useState(0)
  const previewRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setActiveSectionId(sections[0]?.id ?? null)
  }, [sections])

  useEffect(() => {
    setViewMode('preview')
    setCopied(false)
    setPreviewRevision(0)
  }, [document.key])

  const activeSection = sections.find((section) => section.id === activeSectionId) ?? sections[0] ?? null
  const imageUrl = attachment.kind === 'image' ? buildAttachmentPreviewUrl(attachment) : null
  const displayText = attachment.kind === 'file' ? getAttachmentDisplayText(attachment) : ''
  const supportsSourceView = attachment.kind === 'file'

  const copyRawContent = async () => {
    if (attachment.kind !== 'file' || !displayText) return
    try {
      await navigator.clipboard.writeText(displayText)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  const handleDownload = () => {
    if (attachment.kind !== 'file') return
    downloadTextContent(displayText, attachment.name, attachment.mimeType)
  }

  const handleExportPdf = () => {
    if (attachment.kind !== 'file') return
    if (documentType === 'html') {
      openPrintWindow(attachment.name, displayText)
      return
    }
    const previewHtml = previewRef.current?.innerHTML
    if (!previewHtml) return
    openPrintWindow(attachment.name, previewHtml)
  }

  const actionItems: FilePreviewActionItem[] = attachment.kind === 'file'
    ? [
      { label: 'Download', onSelect: handleDownload, disabled: !displayText },
      { label: 'Download as PDF', onSelect: handleExportPdf, disabled: !displayText },
    ]
    : []

  return (
    <aside
      className="flex h-full min-h-0 min-w-[22rem] shrink-0 flex-col overflow-hidden border-l border-border/70 bg-surface"
      style={{ width }}
    >
      <FilePreviewPanelHeader
        title={attachment.kind === 'file'
          ? (
              <>
                <span className="font-normal text-text-primary">{stripFileExtension(attachment.name)}</span>
                <span className="font-normal text-[rgb(139,137,133)]"> · {documentTypeLabel(attachment, documentType)} · {formatBytes(attachment.size)}</span>
              </>
            )
          : attachment.name}
        viewMode={supportsSourceView ? viewMode : undefined}
        onViewModeChange={supportsSourceView ? setViewMode : undefined}
        onCopy={attachment.kind === 'file' && displayText ? copyRawContent : undefined}
        copied={copied}
        actionItems={actionItems}
        onRefresh={documentType === 'html' ? () => setPreviewRevision((value) => value + 1) : undefined}
        onClose={onClose}
      />

      <div className="min-h-0 flex-1 overflow-hidden bg-surface">
        {attachment.kind === 'image' ? (
          <div className="flex h-full min-h-0 items-center justify-center overflow-auto bg-surface px-5 py-4">
            {imageUrl ? (
              <img
                src={imageUrl}
                alt={attachment.name}
                className="max-h-[calc(100vh-9rem)] max-w-full object-contain shadow-[0_18px_38px_rgba(15,23,42,0.08)]"
              />
            ) : (
              <div className="flex h-64 w-64 items-center justify-center rounded-[1rem] border border-dashed border-border/80 bg-surface text-text-secondary">
                <ImageIcon className="size-10" />
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full min-h-0 overflow-hidden bg-surface">
            {viewMode === 'preview' && documentType === 'excel' && sections.length > 1 && (
              <div className="w-40 shrink-0 border-r border-border/70 bg-surface px-3 py-3">
                <div className="mb-3 px-2 text-[11px] font-medium uppercase tracking-[0.14em] text-text-muted">Sheets</div>
                <div className="space-y-1">
                  {sections.map((section) => (
                    <button
                      key={section.id}
                      type="button"
                      onClick={() => setActiveSectionId(section.id)}
                      className={clsx(
                        'w-full rounded-xl px-3 py-2 text-left text-[13px] transition-colors',
                        activeSectionId === section.id
                          ? 'bg-surface-alt text-text-primary'
                          : 'text-text-secondary hover:bg-hover hover:text-text-primary',
                      )}
                    >
                      <div className="truncate">{section.label}</div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div ref={previewRef} className="min-h-0 flex-1 overflow-hidden bg-surface">
              <div className="h-full overflow-y-auto">
                {viewMode === 'source' ? (
                  <ShikiCodeView code={activeSection?.content ?? displayText} language={inferCodeLanguage(attachment.name)} />
                ) : documentType === 'code' ? (
                  <ShikiCodeView code={activeSection?.content ?? displayText} language={inferCodeLanguage(attachment.name)} />
                ) : documentType === 'html' ? (
                  <HtmlPreviewFrame title={attachment.name} html={displayText} resetKey={previewRevision} className="h-full min-h-0" />
                ) : documentType === 'excel' ? (
                  <div className="px-5 py-4">
                    <div className="mx-auto max-w-4xl">
                      {activeSection && renderTextParagraphs(activeSection.content, true)}
                    </div>
                  </div>
                ) : documentType === 'markdown' ? (
                  <div className="px-5 py-4">
                    <div className="mx-auto max-w-4xl">
                      {renderMarkdown(activeSection?.content ?? displayText)}
                    </div>
                  </div>
                ) : activeSection || (attachment.kind === 'file' && displayText.trim().length > 0) ? (
                  <div className="px-5 py-4">
                    <div className="mx-auto max-w-4xl">
                      {renderTextParagraphs(activeSection?.content ?? displayText, false)}
                    </div>
                  </div>
                ) : (
                  <div className="px-5 py-4">
                    <div className="mx-auto max-w-4xl rounded-2xl border border-dashed border-border/70 px-4 py-5 text-sm text-text-secondary">
                      当前未能从该文档中提取可展示内容。请重新上传，或换用更容易解析的格式。
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  )
}
