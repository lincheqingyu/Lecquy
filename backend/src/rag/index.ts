import { randomUUID } from 'node:crypto'
import { getConfig } from '../config/index.js'
import { getPool } from '../db/client.js'
import {
  insertKnowledgeChunks,
  insertKnowledgeDocument,
  searchKnowledgeChunks as searchKnowledgeChunksFromRepository,
} from '../db/knowledge-repository.js'
import { logger } from '../utils/logger.js'
import { splitKnowledgeText } from './chunking.js'
import type {
  IngestKnowledgeDocumentInput,
  KnowledgeChunk,
  KnowledgeChunkHit,
  KnowledgeDocument,
  SearchKnowledgeChunksInput,
} from './types.js'

function createKnowledgeDocumentId(): string {
  return `kdoc_${randomUUID()}`
}

function createKnowledgeChunkId(): string {
  return `kchunk_${randomUUID()}`
}

function normalizeMetadata(metadata?: Record<string, unknown>): Record<string, unknown> {
  return metadata ? { ...metadata } : {}
}

function isPgEnabled(): boolean {
  try {
    return getConfig().PG_ENABLED
  } catch {
    return process.env.PG_ENABLED === 'true'
  }
}

function buildKnowledgeDocument(input: IngestKnowledgeDocumentInput, now: string): KnowledgeDocument {
  return {
    id: createKnowledgeDocumentId(),
    sourceType: input.sourceType,
    sourceUri: input.sourceUri,
    title: input.title,
    metadata: normalizeMetadata(input.metadata),
    createdAt: now,
    updatedAt: now,
  }
}

function buildKnowledgeChunk(documentId: string, input: IngestKnowledgeDocumentInput, now: string): KnowledgeChunk {
  return {
    id: createKnowledgeChunkId(),
    documentId,
    seq: 0,
    content: input.content,
    metadata: normalizeMetadata(input.metadata),
    createdAt: now,
  }
}

function buildKnowledgeChunks(documentId: string, input: IngestKnowledgeDocumentInput, now: string): KnowledgeChunk[] {
  return splitKnowledgeText(input.content).map((content, index) => ({
    ...buildKnowledgeChunk(documentId, input, now),
    id: createKnowledgeChunkId(),
    seq: index,
    content,
    metadata: {
      ...normalizeMetadata(input.metadata),
      chunk_chars: content.length,
      chunk_strategy: 'paragraph_text_v1',
    },
  }))
}

export async function ingestKnowledgeDocument(
  input: IngestKnowledgeDocumentInput,
): Promise<{ documentId: string; chunkCount: number }> {
  const now = new Date().toISOString()
  const document = buildKnowledgeDocument(input, now)
  const chunks = buildKnowledgeChunks(document.id, input, now)

  if (!isPgEnabled()) {
    logger.info('knowledge ingest 跳过：PostgreSQL 未启用', {
      documentId: document.id,
      sourceType: input.sourceType,
      title: input.title,
      chunkCount: chunks.length,
    })
    return {
      documentId: document.id,
      chunkCount: chunks.length,
    }
  }

  const pool = getPool()
  await insertKnowledgeDocument(pool, document)
  await insertKnowledgeChunks(pool, chunks)

  return {
    documentId: document.id,
    chunkCount: chunks.length,
  }
}

export async function searchKnowledgeChunks(
  input: SearchKnowledgeChunksInput,
): Promise<KnowledgeChunkHit[]> {
  if (!isPgEnabled()) {
    logger.info('knowledge search 跳过：PostgreSQL 未启用', {
      query: input.query,
      topK: input.topK ?? 5,
    })
    return []
  }

  return searchKnowledgeChunksFromRepository(getPool(), input)
}

export type {
  IngestKnowledgeDocumentInput,
  KnowledgeChunk,
  KnowledgeChunkHit,
  KnowledgeDocument,
  SearchKnowledgeChunksInput,
} from './types.js'
export { splitKnowledgeText, type KnowledgeChunkingOptions } from './chunking.js'
