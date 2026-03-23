import clsx from 'clsx'
import { ChevronDown, Code2, Copy, Eye, FileCode2, LoaderCircle, RefreshCw, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArtifactDetail } from '@webclaw/shared'
import { renderMarkdown } from '../chat/MessageItem'
import { fetchArtifactDetail, buildArtifactDownloadUrl } from '../../lib/session-api'
import { formatBytes, inferArtifactPreviewMode, inferArtifactTypeLabel, inferCodeLanguage, inferFileExtension } from '../../lib/file-display'
import { ShikiCodeView } from './ShikiCodeView'
import type { ChatArtifact } from '../../lib/artifacts'

type ArtifactViewMode = 'preview' | 'source'

interface ArtifactPanelProps {
  sessionKey: string
  artifact: ChatArtifact
  width: number
  onClose: () => void
}

function stripExtension(fileName: string): string {
  const extension = inferFileExtension(fileName)
  if (!extension) return fileName
  return fileName.slice(0, -(extension.length + 1))
}

function formatUpdatedAt(timestamp: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function renderTextPreview(text: string) {
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)
  if (paragraphs.length === 0) {
    return <div className="text-sm text-text-secondary">暂无可展示内容</div>
  }

  return (
    <div className="space-y-6 text-[15px] leading-8 text-text-primary">
      {paragraphs.map((paragraph, index) => (
        <p key={index} className="whitespace-pre-wrap break-words">
          {paragraph}
        </p>
      ))}
    </div>
  )
}

function createDownloadLink(url: string, fileName: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.target = '_blank'
  link.rel = 'noreferrer'
  link.click()
}

function openPrintWindow(title: string, content: string) {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer')
  if (!printWindow) return

  printWindow.document.open()
  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          body { margin: 0; padding: 32px; font-family: Georgia, 'Times New Roman', serif; color: #0f172a; background: #ffffff; }
          pre, code { font-family: 'SFMono-Regular', 'Consolas', monospace; white-space: pre-wrap; word-break: break-word; }
          img { max-width: 100%; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #e2e8f0; padding: 8px 10px; }
        </style>
      </head>
      <body>${content}</body>
    </html>
  `)
  printWindow.document.close()
  printWindow.focus()
  printWindow.print()
}

function toArtifactDetail(artifact: ChatArtifact): ArtifactDetail | null {
  if (typeof artifact.content !== 'string') return null
  return {
    artifactId: artifact.artifactId,
    filePath: artifact.filePath,
    name: artifact.name,
    mimeType: artifact.mimeType,
    size: artifact.size,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    content: artifact.content,
  }
}

export function ArtifactPanel({ sessionKey, artifact, width, onClose }: ArtifactPanelProps) {
  const [detail, setDetail] = useState<ArtifactDetail | null>(() => toArtifactDetail(artifact))
  const [viewMode, setViewMode] = useState<ArtifactViewMode>('preview')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [isActionMenuOpen, setIsActionMenuOpen] = useState(false)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const actionMenuRef = useRef<HTMLDivElement | null>(null)

  const loadArtifact = useCallback(async (options?: { allowFallback?: boolean }) => {
    const allowFallback = options?.allowFallback ?? false
    if (artifact.status === 'draft') {
      setDetail(toArtifactDetail(artifact))
      setError(null)
      setIsLoading(false)
      return
    }

    if (!allowFallback) {
      setIsLoading(true)
    }
    setError(null)
    try {
      const nextDetail = await fetchArtifactDetail(sessionKey, artifact.artifactId)
      setDetail(nextDetail)
    } catch {
      if (!allowFallback || !artifact.content) {
        setError('文件内容加载失败')
      }
    } finally {
      setIsLoading(false)
    }
  }, [artifact, sessionKey])

  useEffect(() => {
    setViewMode('preview')
    const fallbackDetail = toArtifactDetail(artifact)
    setDetail(fallbackDetail)
    setError(null)

    if (artifact.status === 'draft') {
      setIsLoading(false)
      return
    }

    if (fallbackDetail) {
      setIsLoading(false)
      void loadArtifact({ allowFallback: true })
      return
    }

    void loadArtifact()
  }, [artifact, loadArtifact])

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

  const resolvedArtifact = detail ?? artifact
  const previewMode = inferArtifactPreviewMode(resolvedArtifact)
  const canPreview = true
  const isDraft = artifact.status === 'draft'
  const isHtmlPreview = viewMode === 'preview' && previewMode === 'html'
  const copyRawContent = async () => {
    const content = detail?.content ?? artifact.content ?? ''
    if (!content) return
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  const handleDownload = () => {
    if (isDraft) return
    setIsActionMenuOpen(false)
    createDownloadLink(buildArtifactDownloadUrl(sessionKey, artifact.artifactId), artifact.name)
  }

  const handleExportPdf = () => {
    const exportContent = detail?.content ?? artifact.content
    if (!exportContent) return
    setIsActionMenuOpen(false)
    if (previewMode === 'html') {
      openPrintWindow(artifact.name, exportContent)
      return
    }
    const previewHtml = previewRef.current?.innerHTML
    if (!previewHtml) return
    openPrintWindow(artifact.name, previewHtml)
  }

  const content = detail?.content ?? artifact.content ?? ''

  return (
    <aside
      className="flex h-full min-h-0 min-w-[26rem] shrink-0 flex-col overflow-hidden bg-surface"
      style={{ width }}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-3.5 py-2.5">
        <div className="min-w-0 flex items-center gap-2">
          <div className="inline-flex items-center rounded-[0.95rem] bg-surface-alt p-0.5">
            <button
              type="button"
              onClick={() => setViewMode('preview')}
              className={clsx(
                'inline-flex size-7 items-center justify-center rounded-[0.8rem] transition-colors',
                viewMode === 'preview' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
              )}
              aria-label="预览模式"
            >
              <Eye className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('source')}
              className={clsx(
                'inline-flex size-7 items-center justify-center rounded-[0.8rem] transition-colors',
                viewMode === 'source' ? 'bg-surface text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
              )}
              aria-label="源码模式"
            >
              <Code2 className="size-3.5" />
            </button>
          </div>
          <div className="min-w-0">
            <div className="truncate text-[1rem] font-semibold leading-tight text-text-primary">
              {stripExtension(artifact.name)} · {inferArtifactTypeLabel(artifact)}
            </div>
            <div className="mt-px text-[11px] text-text-secondary">
              {formatBytes(resolvedArtifact.size)} · {isDraft ? '生成中' : `更新于 ${formatUpdatedAt(resolvedArtifact.updatedAt)}`}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <div ref={actionMenuRef} className="relative">
            <div className="inline-flex h-8 items-stretch overflow-hidden rounded-[0.9rem] border border-border bg-surface">
              <button
                type="button"
                onClick={copyRawContent}
                className="inline-flex items-center justify-center px-3 text-[13px] font-medium text-text-primary transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:text-text-muted"
                disabled={!content}
              >
                <Copy className="mr-1.25 size-3.25" />
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={() => setIsActionMenuOpen((value) => !value)}
                className="inline-flex w-9 items-center justify-center border-l border-border text-text-primary transition-colors hover:bg-hover"
                aria-label={isActionMenuOpen ? '关闭操作菜单' : '打开操作菜单'}
                aria-expanded={isActionMenuOpen}
              >
                <ChevronDown className={clsx('size-3.25 transition-transform', isActionMenuOpen && 'rotate-180')} />
              </button>
            </div>

            {isActionMenuOpen && (
              <div className="absolute right-0 top-[calc(100%+0.75rem)] z-20 min-w-[14rem] overflow-hidden rounded-[1.5rem] border border-border bg-surface-raised py-2 shadow-[0_18px_44px_rgba(15,23,42,0.16)]">
                <button
                  type="button"
                  onClick={handleDownload}
                  className="flex w-full items-center px-6 py-3 text-left text-[15px] text-text-primary transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:text-text-muted"
                  disabled={isDraft}
                >
                  Download
                </button>
                <button
                  type="button"
                  onClick={handleExportPdf}
                  className="flex w-full items-center px-6 py-3 text-left text-[15px] text-text-primary transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:text-text-muted"
                  disabled={!content}
                >
                  Download as PDF
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => void loadArtifact()}
            className="inline-flex size-8 items-center justify-center rounded-[0.9rem] text-text-primary transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:text-text-muted"
            aria-label="重新渲染文件"
            disabled={isDraft}
          >
            <RefreshCw className="size-3.75" />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center rounded-[0.9rem] text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
            aria-label="关闭"
          >
            <X className="size-3.75" />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <div
          ref={previewRef}
          className={clsx(
            'h-full overflow-y-auto bg-surface',
            isHtmlPreview ? 'px-0 py-0' : 'px-6 py-5',
          )}
        >
          {isLoading && !content ? (
            <div className="flex h-full min-h-[12rem] items-center justify-center text-sm text-text-secondary">正在加载文件内容...</div>
          ) : error ? (
            <div className="flex h-full min-h-[12rem] items-center justify-center text-sm text-text-secondary">{error}</div>
          ) : viewMode === 'source' ? (
            <div>
              {isDraft && (
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-secondary">
                  <LoaderCircle className="size-3.5 animate-spin" />
                  正在生成文件内容，完成后会自动同步正式版本
                </div>
              )}
              <div className="mb-4 flex items-center gap-2 text-sm text-text-secondary">
                <FileCode2 className="size-4" />
                原始内容
              </div>
              <pre className="min-h-full overflow-x-auto whitespace-pre-wrap break-words bg-surface font-mono text-[13px] leading-7 text-text-primary">
                <code>{content}</code>
              </pre>
            </div>
          ) : !canPreview ? (
            <div className="text-sm text-text-secondary">当前文件暂不支持预览</div>
          ) : previewMode === 'html' ? (
            <div className="flex h-full min-h-0 flex-col">
              {isDraft && (
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-secondary">
                  <LoaderCircle className="size-3.5 animate-spin" />
                  预览已先展示草稿内容，完成后可下载正式文件
                </div>
              )}
              <iframe
                title={artifact.name}
                sandbox=""
                srcDoc={content}
                className="min-h-0 flex-1 bg-surface"
              />
            </div>
          ) : previewMode === 'markdown' ? (
            <div className="prose prose-slate dark:prose-invert max-w-none text-text-primary">
              {isDraft && (
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-secondary not-prose">
                  <LoaderCircle className="size-3.5 animate-spin" />
                  正在生成文件内容
                </div>
              )}
              {renderMarkdown(content)}
            </div>
          ) : previewMode === 'text' ? (
            <>
              {isDraft && (
                <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-secondary">
                  <LoaderCircle className="size-3.5 animate-spin" />
                  正在生成文件内容
                </div>
              )}
              {renderTextPreview(content)}
            </>
          ) : (
            <div className="space-y-4">
              {isDraft && (
                <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-secondary">
                  <LoaderCircle className="size-3.5 animate-spin" />
                  正在生成文件内容
                </div>
              )}
              <ShikiCodeView code={content} language={inferCodeLanguage(artifact.name)} />
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
