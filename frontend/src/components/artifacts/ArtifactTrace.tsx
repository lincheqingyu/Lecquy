import { FileText, LoaderCircle } from 'lucide-react'
import type { ArtifactTraceItem } from '@lecquy/shared'
import { TimelineEvent } from '../chat/TimelineEvent'
import {
  doesArtifactMatchTraceItem,
  isFileOperationTraceItem,
  type ChatArtifact,
} from '../../lib/artifacts'

interface ArtifactTraceProps {
  items: ArtifactTraceItem[]
  artifacts?: ChatArtifact[]
  onOpenArtifact?: (artifact: ChatArtifact) => void
}

export interface ArtifactOperationEntry {
  key: string
  artifact?: ChatArtifact
  trace?: ArtifactTraceItem
  artifactIndex?: number
}

export function buildFileOperationEntries(items: ArtifactTraceItem[], artifacts: ChatArtifact[]): ArtifactOperationEntry[] {
  const fileTraces = items.filter(isFileOperationTraceItem)
  const usedArtifactIds = new Set<string>()
  const entries: ArtifactOperationEntry[] = []

  for (const trace of fileTraces) {
    const artifactIndex = artifacts.findIndex((artifact) =>
      !usedArtifactIds.has(artifact.artifactId) && doesArtifactMatchTraceItem(trace, artifact),
    )
    if (artifactIndex >= 0) {
      const artifact = artifacts[artifactIndex]
      usedArtifactIds.add(artifact.artifactId)
      entries.push({
        key: artifact.artifactId,
        artifact,
        trace,
        artifactIndex,
      })
      continue
    }
    entries.push({
      key: trace.traceId,
      trace,
    })
  }

  for (const [artifactIndex, artifact] of artifacts.entries()) {
    if (usedArtifactIds.has(artifact.artifactId)) continue
    if (artifact.status !== 'draft' && !artifact.content) continue
    entries.push({
      key: artifact.artifactId,
      artifact,
      artifactIndex,
    })
  }

  return entries
}

function resolveOperationVerb(entry: ArtifactOperationEntry): string {
  if (entry.artifact?.status === 'draft') return '正在写入'
  if (entry.trace?.kind === 'updated_file') return 'Updated'
  return 'Created'
}

function resolveOperationTarget(entry: ArtifactOperationEntry): string {
  return entry.artifact?.name ?? entry.trace?.detail ?? '未命名文件'
}

export function ArtifactOperationCard({
  entry,
  onOpenArtifact,
}: {
  entry: ArtifactOperationEntry
  onOpenArtifact?: (artifact: ChatArtifact) => void
}) {
  const artifact = entry.artifact
  const isDraft = artifact?.status === 'draft'
  const handleTargetClick = artifact && !isDraft && onOpenArtifact
    ? () => onOpenArtifact(artifact)
    : undefined

  return (
    <TimelineEvent
      icon={isDraft ? <LoaderCircle /> : <FileText />}
      verb={resolveOperationVerb(entry)}
      target={resolveOperationTarget(entry)}
      status={isDraft ? 'streaming' : 'ready'}
      onTargetClick={handleTargetClick}
    />
  )
}

export function ArtifactTrace({ items, artifacts = [], onOpenArtifact }: ArtifactTraceProps) {
  const operations = buildFileOperationEntries(items, artifacts)
  if (operations.length === 0) return null

  return (
    <div className="space-y-1">
      {operations.map((entry) => (
        <ArtifactOperationCard
          key={`${entry.key}:${entry.artifact?.status ?? 'trace'}`}
          entry={entry}
          onOpenArtifact={onOpenArtifact}
        />
      ))}
    </div>
  )
}
