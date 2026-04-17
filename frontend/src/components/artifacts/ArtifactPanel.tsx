import { LoaderCircle } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ArtifactDetail } from '@lecquy/shared'
import { StreamdownMarkdown } from '../chat/StreamdownMarkdown'
import { fetchArtifactDetail, buildArtifactDownloadUrl } from '../../lib/session-api'
import { formatBytes, inferArtifactPreviewMode, inferArtifactTypeLabel, inferCodeLanguage, stripFileExtension } from '../../lib/file-display'
import { ShikiCodeView } from './ShikiCodeView'
import type { ChatArtifact } from '../../lib/artifacts'
import { FilePreviewPanelHeader, type FilePreviewActionItem } from '../files/FilePreviewPanelHeader'
import { HtmlPreviewFrame } from '../files/HtmlPreviewFrame'
import { createDownloadLink, openPrintWindow } from '../../lib/file-preview-actions'

type ArtifactViewMode = 'preview' | 'source'

interface ArtifactPanelProps {
  sessionKey: string
  artifact: ChatArtifact
  width: number
  onClose: () => void
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
  const [previewRevision, setPreviewRevision] = useState(0)
  const previewRef = useRef<HTMLDivElement | null>(null)

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
    setPreviewRevision(0)
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

  const resolvedArtifact = detail ?? artifact
  const previewMode = inferArtifactPreviewMode(resolvedArtifact)
  const canPreview = true
  const isDraft = artifact.status === 'draft'

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
    createDownloadLink(buildArtifactDownloadUrl(sessionKey, artifact.artifactId), artifact.name)
  }

  const handleExportPdf = () => {
    const exportContent = detail?.content ?? artifact.content
    if (!exportContent) return
    if (previewMode === 'html') {
      openPrintWindow(artifact.name, exportContent)
      return
    }
    const previewHtml = previewRef.current?.innerHTML
    if (!previewHtml) return
    openPrintWindow(artifact.name, previewHtml)
  }

  const content = detail?.content ?? artifact.content ?? ''
  const actionItems: FilePreviewActionItem[] = [
    {
      label: 'Download',
      onSelect: handleDownload,
      disabled: isDraft,
    },
    {
      label: 'Download as PDF',
      onSelect: handleExportPdf,
      disabled: !content,
    },
  ]

  return (
    <aside
      className="flex h-full min-h-0 min-w-[26rem] shrink-0 flex-col overflow-hidden border-l border-border/70 bg-surface"
      style={{ width }}
    >
      <FilePreviewPanelHeader
        title={
          <>
            <span className="font-normal text-text-primary">{stripFileExtension(artifact.name)}</span>
            <span className="font-normal text-[rgb(139,137,133)]"> · {inferArtifactTypeLabel(artifact)} · {formatBytes(resolvedArtifact.size)}</span>
          </>
        }
        meta={isDraft ? '生成中' : `更新于 ${formatUpdatedAt(resolvedArtifact.updatedAt)}`}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onCopy={content ? copyRawContent : undefined}
        copied={copied}
        actionItems={actionItems}
        onRefresh={() => {
          setPreviewRevision((value) => value + 1)
          void loadArtifact()
        }}
        refreshDisabled={isDraft}
        onClose={onClose}
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        <div
          ref={previewRef}
          className="h-full overflow-y-auto bg-surface"
        >
          {isLoading && !content ? (
            <div className="flex h-full min-h-[12rem] items-center justify-center text-sm text-text-secondary">正在加载文件内容...</div>
          ) : error ? (
            <div className="flex h-full min-h-[12rem] items-center justify-center text-sm text-text-secondary">{error}</div>
          ) : viewMode === 'source' ? (
            <div className="h-full">
              {isDraft && (
                <div className="px-4 pb-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-secondary">
                    <LoaderCircle className="size-3.5 animate-spin" />
                    正在生成文件内容，完成后会自动同步正式版本
                  </div>
                </div>
              )}
              <ShikiCodeView code={content} language={inferCodeLanguage(artifact.name)} />
            </div>
          ) : !canPreview ? (
            <div className="text-sm text-text-secondary">当前文件暂不支持预览</div>
          ) : previewMode === 'html' ? (
            <div className="flex h-full min-h-0 flex-col">
              {isDraft && (
                <div className="px-4 pb-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-secondary">
                    <LoaderCircle className="size-3.5 animate-spin" />
                    预览已先展示草稿内容，完成后可下载正式文件
                  </div>
                </div>
              )}
              <HtmlPreviewFrame title={artifact.name} html={content} resetKey={previewRevision} />
            </div>
          ) : previewMode === 'markdown' ? (
            <div className="px-5 py-4">
              <div className="mx-auto max-w-4xl text-text-primary">
                {isDraft && (
                  <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-secondary">
                    <LoaderCircle className="size-3.5 animate-spin" />
                    正在生成文件内容
                  </div>
                )}
                <StreamdownMarkdown content={content} />
              </div>
            </div>
          ) : previewMode === 'text' ? (
            <div className="px-5 py-4">
              <div className="mx-auto max-w-4xl">
                {isDraft && (
                  <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-secondary">
                    <LoaderCircle className="size-3.5 animate-spin" />
                    正在生成文件内容
                  </div>
                )}
                {renderTextPreview(content)}
              </div>
            </div>
          ) : (
            <div className="h-full">
              {isDraft && (
                <div className="px-4 pb-2">
                  <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-text-secondary">
                    <LoaderCircle className="size-3.5 animate-spin" />
                    正在生成文件内容
                  </div>
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
