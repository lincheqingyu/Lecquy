import type { Pool } from 'pg'
import type {
  KnowledgeChunk,
  KnowledgeChunkHit,
  KnowledgeDocument,
  SearchKnowledgeChunksInput,
} from '../rag/types.js'

interface KnowledgeChunkSearchRow {
  chunk_id: string
  document_id: string
  content: string
  score: number | string
  metadata_json: unknown
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function normalizeSearchText(text: string): string {
  return normalizeWhitespace(text).toLowerCase()
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&')
}

function clampTopK(topK?: number): number {
  if (!Number.isFinite(topK)) return 5
  return Math.min(20, Math.max(1, Math.trunc(topK ?? 5)))
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function mapKnowledgeChunkRows(rows: KnowledgeChunkSearchRow[]): KnowledgeChunkHit[] {
  return rows.map((row) => ({
    chunkId: row.chunk_id,
    documentId: row.document_id,
    content: row.content,
    score: Number(row.score ?? 0),
    metadata: asObject(row.metadata_json),
  }))
}

async function hasPgTrgmExtension(pool: Pool): Promise<boolean> {
  const result = await pool.query<{ installed: boolean }>(
    `
      SELECT EXISTS (
        SELECT 1
        FROM pg_extension
        WHERE extname = 'pg_trgm'
      ) AS installed
    `,
  )

  return Boolean(result.rows[0]?.installed)
}

async function searchWithTrgm(
  pool: Pool,
  input: SearchKnowledgeChunksInput,
  normalizedQuery: string,
  sourceFilter: string[] | null,
  limit: number,
): Promise<KnowledgeChunkHit[]> {
  const result = await pool.query<KnowledgeChunkSearchRow>(
    `
      SELECT
        c.id AS chunk_id,
        c.document_id,
        c.content,
        (
          GREATEST(
            similarity(lower(c.content), $1),
            similarity(lower(d.title), $1)
          ) * 4.0
          + ts_rank(
              to_tsvector('simple', coalesce(d.title, '') || ' ' || coalesce(c.content, '')),
              plainto_tsquery('simple', $2)
            ) * 3.0
        ) AS score,
        (
          coalesce(d.metadata_json, '{}'::jsonb)
          || coalesce(c.metadata_json, '{}'::jsonb)
          || jsonb_build_object(
            'title', d.title,
            'source_type', d.source_type,
            'source_uri', d.source_uri,
            'seq', c.seq
          )
        ) AS metadata_json
      FROM knowledge_chunks c
      INNER JOIN knowledge_documents d
        ON d.id = c.document_id
      WHERE (
        GREATEST(
          similarity(lower(c.content), $1),
          similarity(lower(d.title), $1)
        ) > 0.1
        OR to_tsvector('simple', coalesce(d.title, '') || ' ' || coalesce(c.content, ''))
           @@ plainto_tsquery('simple', $2)
      )
        AND ($3::text[] IS NULL OR d.source_type = ANY($3::text[]))
      ORDER BY score DESC, c.document_id ASC, c.seq ASC
      LIMIT $4
    `,
    [
      normalizedQuery,
      input.query,
      sourceFilter,
      limit,
    ],
  )

  return mapKnowledgeChunkRows(result.rows)
}

async function searchFallback(
  pool: Pool,
  input: SearchKnowledgeChunksInput,
  normalizedQuery: string,
  sourceFilter: string[] | null,
  limit: number,
): Promise<KnowledgeChunkHit[]> {
  const likePattern = `%${escapeLike(normalizedQuery)}%`
  const result = await pool.query<KnowledgeChunkSearchRow>(
    `
      SELECT
        c.id AS chunk_id,
        c.document_id,
        c.content,
        (
          CASE
            WHEN lower(c.content) LIKE $1 ESCAPE '\\'
              OR lower(d.title) LIKE $1 ESCAPE '\\'
            THEN 2.0
            ELSE 0
          END
          + ts_rank(
              to_tsvector('simple', coalesce(d.title, '') || ' ' || coalesce(c.content, '')),
              plainto_tsquery('simple', $2)
            ) * 3.0
        ) AS score,
        (
          coalesce(d.metadata_json, '{}'::jsonb)
          || coalesce(c.metadata_json, '{}'::jsonb)
          || jsonb_build_object(
            'title', d.title,
            'source_type', d.source_type,
            'source_uri', d.source_uri,
            'seq', c.seq
          )
        ) AS metadata_json
      FROM knowledge_chunks c
      INNER JOIN knowledge_documents d
        ON d.id = c.document_id
      WHERE (
        lower(c.content) LIKE $1 ESCAPE '\\'
        OR lower(d.title) LIKE $1 ESCAPE '\\'
        OR to_tsvector('simple', coalesce(d.title, '') || ' ' || coalesce(c.content, ''))
           @@ plainto_tsquery('simple', $2)
      )
        AND ($3::text[] IS NULL OR d.source_type = ANY($3::text[]))
      ORDER BY score DESC, c.document_id ASC, c.seq ASC
      LIMIT $4
    `,
    [
      likePattern,
      input.query,
      sourceFilter,
      limit,
    ],
  )

  return mapKnowledgeChunkRows(result.rows)
}

export async function insertKnowledgeDocument(
  pool: Pool,
  document: KnowledgeDocument,
): Promise<void> {
  await pool.query(
    `
      INSERT INTO knowledge_documents (
        id,
        source_type,
        source_uri,
        title,
        metadata_json,
        created_at,
        updated_at
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
    `,
    [
      document.id,
      document.sourceType,
      document.sourceUri ?? null,
      document.title,
      JSON.stringify(document.metadata),
      document.createdAt,
      document.updatedAt,
    ],
  )
}

export async function insertKnowledgeChunks(
  pool: Pool,
  chunks: readonly KnowledgeChunk[],
): Promise<void> {
  for (const chunk of chunks) {
    await pool.query(
      `
        INSERT INTO knowledge_chunks (
          id,
          document_id,
          seq,
          content,
          metadata_json,
          created_at
        ) VALUES ($1, $2, $3, $4, $5::jsonb, $6)
      `,
      [
        chunk.id,
        chunk.documentId,
        chunk.seq,
        chunk.content,
        JSON.stringify(chunk.metadata),
        chunk.createdAt,
      ],
    )
  }
}

export async function searchKnowledgeChunks(
  pool: Pool,
  input: SearchKnowledgeChunksInput,
): Promise<KnowledgeChunkHit[]> {
  const normalizedQuery = normalizeSearchText(input.query)
  if (normalizedQuery.length < 2) {
    return []
  }

  const sourceFilter = input.sourceFilter && input.sourceFilter.length > 0
    ? [...new Set(input.sourceFilter.map((item) => item.trim()).filter(Boolean))]
    : null
  const limit = clampTopK(input.topK)

  if (await hasPgTrgmExtension(pool)) {
    return searchWithTrgm(pool, input, normalizedQuery, sourceFilter, limit)
  }

  return searchFallback(pool, input, normalizedQuery, sourceFilter, limit)
}
