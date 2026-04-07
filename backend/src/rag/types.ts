export interface KnowledgeDocument {
  readonly id: string
  readonly sourceType: string
  readonly sourceUri?: string
  readonly title: string
  readonly metadata: Record<string, unknown>
  readonly createdAt: string
  readonly updatedAt: string
}

export interface KnowledgeChunk {
  readonly id: string
  readonly documentId: string
  readonly seq: number
  readonly content: string
  readonly metadata: Record<string, unknown>
  readonly createdAt: string
}

export interface KnowledgeChunkHit {
  readonly chunkId: string
  readonly documentId: string
  readonly content: string
  readonly score: number
  readonly metadata: Record<string, unknown>
}

export interface IngestKnowledgeDocumentInput {
  readonly sourceType: string
  readonly sourceUri?: string
  readonly title: string
  readonly content: string
  readonly metadata?: Record<string, unknown>
}

export interface SearchKnowledgeChunksInput {
  readonly query: string
  readonly topK?: number
  readonly sourceFilter?: string[]
}
