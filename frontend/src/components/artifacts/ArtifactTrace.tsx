import { ChevronDown, ChevronUp, FileText, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ArtifactTraceItem } from '@webclaw/shared'
import type { ChatArtifact } from '../../lib/artifacts'

interface ArtifactTraceProps {
  items: ArtifactTraceItem[]
  artifacts?: ChatArtifact[]
  onOpenArtifact?: (artifact: ChatArtifact) => void
}

interface ArtifactOperationEntry {
  key: string
  artifact?: ChatArtifact
  trace?: ArtifactTraceItem
  artifactIndex?: number
}

const PREVIEW_STREAM_INTERVAL_MS = 16

function isFileOperationTrace(item: ArtifactTraceItem): boolean {
  return item.kind === 'created_file' || item.kind === 'updated_file'
}

function matchTraceToArtifact(trace: ArtifactTraceItem, artifact: ChatArtifact): boolean {
  return trace.detail === artifact.name || trace.detail === artifact.filePath
}

function buildOperationEntries(items: ArtifactTraceItem[], artifacts: ChatArtifact[]): ArtifactOperationEntry[] {
  const fileTraces = items.filter(isFileOperationTrace)
  const usedTraceIds = new Set<string>()
  const entries: ArtifactOperationEntry[] = []

  for (const [artifactIndex, artifact] of artifacts.entries()) {
    const matchedTrace = fileTraces.find((item) => !usedTraceIds.has(item.traceId) && matchTraceToArtifact(item, artifact))
    if (matchedTrace) {
      usedTraceIds.add(matchedTrace.traceId)
    }

    if (artifact.status === 'draft' || matchedTrace || artifact.content) {
      entries.push({
        key: artifact.artifactId,
        artifact,
        trace: matchedTrace,
        artifactIndex,
      })
    }
  }

  for (const trace of fileTraces) {
    if (usedTraceIds.has(trace.traceId)) continue
    entries.push({
      key: trace.traceId,
      trace,
    })
  }

  return entries
}

function resolveOperationHeader(entry: ArtifactOperationEntry): string {
  if (entry.trace?.subtitle) return entry.trace.subtitle
  return entry.artifact?.status === 'draft' ? 'Creating a file' : 'Created a file'
}

function resolveOperationDetail(entry: ArtifactOperationEntry): string {
  return entry.trace?.detail ?? entry.artifact?.name ?? '未命名文件'
}

function PreviewContent({
  content,
  isStreaming,
}: {
  content: string
  isStreaming: boolean
}) {
  const [visibleLength, setVisibleLength] = useState(() => (isStreaming ? 0 : content.length))
  const previewRef = useRef<HTMLPreElement | null>(null)

  useEffect(() => {
    if (!isStreaming) {
      setVisibleLength(content.length)
    }
  }, [content, isStreaming])

  useEffect(() => {
    if (!content || !isStreaming) return

    const chunkSize = Math.max(16, Math.ceil(content.length / 90))
    const timer = window.setInterval(() => {
      setVisibleLength((current) => {
        if (current >= content.length) {
          window.clearInterval(timer)
          return content.length
        }
        return Math.min(content.length, current + chunkSize)
      })
    }, PREVIEW_STREAM_INTERVAL_MS)

    return () => window.clearInterval(timer)
  }, [content, isStreaming])

  useEffect(() => {
    if (!content || !isStreaming || !previewRef.current) return
    const frame = window.requestAnimationFrame(() => {
      if (!previewRef.current) return
      previewRef.current.scrollTop = previewRef.current.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
  }, [content, isStreaming, visibleLength])

  if (!content) return null

  const visibleContent = content.slice(0, visibleLength)
  const showCursor = isStreaming && visibleLength < content.length

  return (
    <pre
      ref={previewRef}
      className="h-[21rem] overflow-auto whitespace-pre-wrap break-words rounded-[1.1rem] border border-border/80 bg-white/95 px-4 py-3 font-mono text-[12px] leading-6 text-text-primary"
    >
      {visibleContent}
      {showCursor && <span className="ml-0.5 inline-block h-4 w-1 animate-pulse rounded-full bg-accent-text align-[-2px]" />}
    </pre>
  )
}

function OperationRow({ entry }: { entry: ArtifactOperationEntry }) {
  const previewContent = entry.artifact?.content ?? ''
  const isDraft = entry.artifact?.status === 'draft'
  const [isExpanded, setIsExpanded] = useState(isDraft)
  const wasDraftRef = useRef(isDraft)

  useEffect(() => {
    if (isDraft && !wasDraftRef.current) {
      setIsExpanded(true)
    } else if (!isDraft && wasDraftRef.current) {
      setIsExpanded(false)
    }
    wasDraftRef.current = isDraft
  }, [isDraft])

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-1 py-0.5 text-left text-[13px] text-text-muted transition-colors hover:text-text-secondary"
        aria-expanded={isExpanded}
      >
        <FileText className="size-3.5 shrink-0" />
        <span className="shrink-0 font-medium text-text-secondary">{resolveOperationHeader(entry)}</span>
        <span className="truncate text-text-muted">{resolveOperationDetail(entry)}</span>
        <div className="ml-auto flex shrink-0 items-center gap-2 text-text-muted">
          {isDraft && (
            <span className="inline-flex items-center gap-1 rounded-full border border-border/80 bg-surface px-2 py-0.5 text-[11px] font-medium text-text-muted">
              <LoaderCircle className="size-3 animate-spin" />
              生成中
            </span>
          )}
          {isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </div>
      </button>

      {isExpanded && (
        <div className="pt-1">
          {previewContent ? (
            <PreviewContent content={previewContent} isStreaming={isDraft} />
          ) : (
            <div className="rounded-[1.1rem] border border-dashed border-border/80 bg-white/95 px-4 py-4 text-sm text-text-secondary">
              {isDraft ? '正在流式生成文档内容...' : '文件已写入，预览内容将在可用时显示。'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ReadyArtifactLink({
  entry,
  onOpenArtifact,
}: {
  entry: ArtifactOperationEntry
  onOpenArtifact?: (artifact: ChatArtifact) => void
}) {
  const artifact = entry.artifact
  const label = artifact?.name ?? resolveOperationDetail(entry)
  const isClickable = Boolean(artifact && onOpenArtifact)

  if (!artifact || !isClickable) {
    return (
      <div className="inline-flex max-w-full items-center gap-2 px-1 py-0.5 text-[13px] text-text-muted">
        <FileText className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => onOpenArtifact?.(artifact)}
      className="inline-flex max-w-full items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-[13px] text-text-muted transition-colors hover:bg-hover hover:text-text-secondary"
    >
      <FileText className="size-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

function ReadyOperationRow({
  entry,
  onOpenArtifact,
}: {
  entry: ArtifactOperationEntry
  onOpenArtifact?: (artifact: ChatArtifact) => void
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={() => setIsExpanded((value) => !value)}
        className="flex w-full items-center gap-2 px-1 py-0.5 text-left text-[13px] text-text-muted transition-colors hover:text-text-secondary"
        aria-expanded={isExpanded}
      >
        <FileText className="size-3.5 shrink-0" />
        <span className="truncate font-medium text-text-secondary">{resolveOperationHeader(entry)}</span>
        <div className="ml-auto flex shrink-0 items-center text-text-muted">
          {isExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </div>
      </button>

      {isExpanded && (
        <div className="pl-6 pt-1">
          <ReadyArtifactLink entry={entry} onOpenArtifact={onOpenArtifact} />
        </div>
      )}
    </div>
  )
}

function ArtifactOperation({
  entry,
  onOpenArtifact,
}: {
  entry: ArtifactOperationEntry
  onOpenArtifact?: (artifact: ChatArtifact) => void
}) {
  const shouldUseReadyInteraction = !entry.artifact || entry.artifact.status !== 'draft'
  if (shouldUseReadyInteraction) {
    return <ReadyOperationRow entry={entry} onOpenArtifact={onOpenArtifact} />
  }

  return <OperationRow entry={entry} />
}

export function ArtifactTrace({ items, artifacts = [], onOpenArtifact }: ArtifactTraceProps) {
  const operations = buildOperationEntries(items, artifacts)
  if (operations.length === 0) return null

  return (
    <div className="space-y-2">
      {operations.map((entry) => (
        <ArtifactOperation
          key={`${entry.key}:${entry.artifact?.status ?? 'trace'}:${entry.artifact?.content ? 'preview' : 'empty'}`}
          entry={entry}
          onOpenArtifact={onOpenArtifact}
        />
      ))}
    </div>
  )
}
