// 中文：本文件（types.ts）位于 backend/src/rag/types.ts，属于backend链路中的backend 模块实现代码，连接上游调用方与下游执行逻辑。
// English: This file (types.ts) belongs to the backend backend 模块实现 layer in backend/src/rag/types.ts, wiring upstream callers with downstream runtime logic.

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
