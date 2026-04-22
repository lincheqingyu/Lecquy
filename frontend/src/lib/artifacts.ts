import type { ArtifactTraceItem, GeneratedFileArtifact } from '@lecquy/shared'

const GENERATED_DOCS_DIR = '.lecquy/artifacts/docs'
const DEFAULT_ARTIFACT_EXTENSIONS = new Set([
  'html',
  'htm',
  'md',
  'markdown',
  'txt',
  'json',
  'csv',
])

export interface ChatArtifact extends GeneratedFileArtifact {
  status?: 'draft' | 'ready'
  content?: string
  stepId?: string
}

function normalizeWorkspacePath(filePath: string): string {
  return filePath.trim().replace(/\\/g, '/').replace(/^\.\//, '')
}

function inferFileName(filePath: string): string {
  const normalized = normalizeWorkspacePath(filePath)
  const parts = normalized.split('/')
  return parts.at(-1) ?? normalized
}

function inferFileExtension(fileName: string): string {
  const parts = inferFileName(fileName).toLowerCase().split('.')
  return parts.length > 1 ? parts.at(-1) ?? '' : ''
}

function inferMimeType(filePath: string): string {
  switch (inferFileExtension(filePath)) {
    case 'html':
    case 'htm':
      return 'text/html'
    case 'md':
    case 'markdown':
      return 'text/markdown'
    case 'json':
      return 'application/json'
    case 'csv':
      return 'text/csv'
    case 'xml':
      return 'application/xml'
    case 'css':
      return 'text/css'
    case 'js':
      return 'text/javascript'
    case 'ts':
      return 'text/typescript'
    case 'py':
      return 'text/x-python'
    default:
      return 'text/plain'
  }
}

function resolveDraftOutputPath(filePath: string): string {
  const normalized = normalizeWorkspacePath(filePath)
  if (!normalized) return ''
  const hasExplicitDirectory = normalized.includes('/')
  const extension = inferFileExtension(normalized)
  if (!hasExplicitDirectory && DEFAULT_ARTIFACT_EXTENSIONS.has(extension)) {
    return `${GENERATED_DOCS_DIR}/${inferFileName(normalized)}`
  }
  return normalized
}

function isDisplayableArtifactPath(filePath: string): boolean {
  const normalized = normalizeWorkspacePath(filePath)
  return normalized === GENERATED_DOCS_DIR || normalized.startsWith(`${GENERATED_DOCS_DIR}/`)
}

function toByteSize(content: string): number {
  if (typeof Blob !== 'undefined') {
    return new Blob([content]).size
  }
  return content.length
}

function toChatArtifact(artifact: GeneratedFileArtifact | ChatArtifact): ChatArtifact {
  const status = 'status' in artifact ? artifact.status : undefined
  return {
    ...artifact,
    status: status ?? (artifact.artifactId.startsWith('draft:') ? 'draft' : 'ready'),
  }
}

function findArtifactIndex(artifacts: ChatArtifact[], candidate: ChatArtifact): number {
  const exactIndex = artifacts.findIndex((artifact) => artifact.artifactId === candidate.artifactId)
  if (exactIndex >= 0) return exactIndex

  if (candidate.stepId) {
    const sameStepDraftIndex = artifacts.findIndex((artifact) =>
      artifact.status === 'draft' && artifact.stepId === candidate.stepId,
    )
    if (sameStepDraftIndex >= 0) return sameStepDraftIndex
  }

  if (candidate.status === 'draft') return -1
  return artifacts.findIndex((artifact) =>
    artifact.status === 'draft'
    && normalizeWorkspacePath(artifact.filePath) === normalizeWorkspacePath(candidate.filePath),
  )
}

export function isGeneratedFileArtifact(value: unknown): value is GeneratedFileArtifact {
  if (!value || typeof value !== 'object') return false
  const artifactId = 'artifactId' in value ? (value as { artifactId?: unknown }).artifactId : undefined
  const filePath = 'filePath' in value ? (value as { filePath?: unknown }).filePath : undefined
  const name = 'name' in value ? (value as { name?: unknown }).name : undefined
  const mimeType = 'mimeType' in value ? (value as { mimeType?: unknown }).mimeType : undefined
  const size = 'size' in value ? (value as { size?: unknown }).size : undefined
  const createdAt = 'createdAt' in value ? (value as { createdAt?: unknown }).createdAt : undefined
  const updatedAt = 'updatedAt' in value ? (value as { updatedAt?: unknown }).updatedAt : undefined

  return (
    typeof artifactId === 'string'
    && typeof filePath === 'string'
    && typeof name === 'string'
    && typeof mimeType === 'string'
    && typeof size === 'number'
    && typeof createdAt === 'number'
    && typeof updatedAt === 'number'
  )
}

export function isArtifactTraceItem(value: unknown): value is ArtifactTraceItem {
  if (!value || typeof value !== 'object') return false
  const traceId = 'traceId' in value ? (value as { traceId?: unknown }).traceId : undefined
  const stepId = 'stepId' in value ? (value as { stepId?: unknown }).stepId : undefined
  const toolName = 'toolName' in value ? (value as { toolName?: unknown }).toolName : undefined
  const kind = 'kind' in value ? (value as { kind?: unknown }).kind : undefined
  const title = 'title' in value ? (value as { title?: unknown }).title : undefined
  const subtitle = 'subtitle' in value ? (value as { subtitle?: unknown }).subtitle : undefined
  const timestamp = 'timestamp' in value ? (value as { timestamp?: unknown }).timestamp : undefined

  return (
    typeof traceId === 'string'
    && typeof stepId === 'string'
    && typeof toolName === 'string'
    && typeof kind === 'string'
    && typeof title === 'string'
    && typeof subtitle === 'string'
    && typeof timestamp === 'number'
  )
}

export function mergeArtifacts(
  current: ChatArtifact[] | undefined,
  incoming: Array<GeneratedFileArtifact | ChatArtifact> | undefined,
): ChatArtifact[] | undefined {
  const next = [...(current ?? [])]
  for (const item of incoming ?? []) {
    const artifact = toChatArtifact(item)
    const existingIndex = findArtifactIndex(next, artifact)
    if (existingIndex < 0) {
      next.push(artifact)
      continue
    }

    const existing = next[existingIndex]
    next[existingIndex] = {
      ...existing,
      ...artifact,
      content: artifact.content ?? existing.content,
      status: artifact.status ?? existing.status ?? 'ready',
    }
  }
  return next.length > 0 ? next : undefined
}

export function mergeArtifactTraceItems(
  current: ArtifactTraceItem[] | undefined,
  incoming: ArtifactTraceItem[] | undefined,
): ArtifactTraceItem[] | undefined {
  const next = [...(current ?? [])]
  for (const item of incoming ?? []) {
    if (next.some((candidate) => candidate.traceId === item.traceId)) continue
    next.push(item)
  }
  return next.length > 0 ? next : undefined
}

export function formatArtifactTraceSummary(items: ArtifactTraceItem[]): string {
  return items.map((item) => item.subtitle).join(', ')
}

export function isFileOperationTraceItem(item: ArtifactTraceItem): boolean {
  return item.kind === 'created_file' || item.kind === 'updated_file'
}

export function doesArtifactMatchTraceItem(trace: ArtifactTraceItem, artifact: ChatArtifact): boolean {
  return trace.detail === artifact.name || trace.detail === artifact.filePath
}

export function hasFileOperationTraceItem(
  items: ArtifactTraceItem[] | undefined,
  artifact: ChatArtifact,
): boolean {
  return (items ?? []).some((item) => isFileOperationTraceItem(item) && doesArtifactMatchTraceItem(item, artifact))
}

export function createDraftArtifact(
  stepId: string,
  toolName: string,
  args: unknown,
): ChatArtifact | null {
  if (toolName !== 'write_file' || !args || typeof args !== 'object') return null
  const filePath = 'file_path' in args ? (args as { file_path?: unknown }).file_path : undefined
  const content = 'content' in args ? (args as { content?: unknown }).content : undefined
  if (typeof filePath !== 'string') return null

  const outputPath = resolveDraftOutputPath(filePath)
  if (!outputPath || !isDisplayableArtifactPath(outputPath)) return null
  const normalizedContent = typeof content === 'string' ? content : ''

  const timestamp = Date.now()
  return {
    artifactId: `draft:${stepId}`,
    filePath: normalizeWorkspacePath(outputPath),
    name: inferFileName(outputPath),
    mimeType: inferMimeType(outputPath),
    size: toByteSize(normalizedContent),
    createdAt: timestamp,
    updatedAt: timestamp,
    status: 'draft',
    content: normalizedContent,
    stepId,
  }
}
