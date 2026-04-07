import type { Pool } from 'pg'
import type { MemoryRecallQuery, MemoryRecallResult } from '../memory/types.js'

interface MemoryRecallRow {
  id: string
  kind: string
  summary: string
  content: string
  tags: string[] | null
  importance: number
  confidence: number
  occurred_at: string | null
  source_event_ids: string[] | null
  score: number | string
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function normalizeSearchText(text: string): string {
  return normalizeWhitespace(text).toLowerCase()
}

function extractSearchTerms(text: string): string[] {
  const normalized = normalizeSearchText(text)
    .replace(/[^\p{L}\p{N}_\- ]+/gu, ' ')
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 24)

  return [...new Set(normalized)].slice(0, 6)
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, '\\$&')
}

function mapMemoryRecallRows(rows: MemoryRecallRow[]): MemoryRecallResult[] {
  return rows.map((row) => ({
    id: row.id,
    kind: 'event',
    summary: row.summary,
    content: row.content,
    tags: row.tags ?? [],
    importance: Number(row.importance ?? 0),
    confidence: Number(row.confidence ?? 0),
    occurredAt: row.occurred_at ?? undefined,
    sourceEventIds: row.source_event_ids ?? [],
    score: Number(row.score ?? 0),
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
  query: MemoryRecallQuery,
  searchTerms: string[],
  normalizedQuery: string,
): Promise<MemoryRecallResult[]> {
  const result = await pool.query<MemoryRecallRow>(
    `
      SELECT
        id,
        kind,
        summary,
        content,
        tags,
        importance,
        confidence,
        payload_json->>'occurred_at' AS occurred_at,
        source_event_ids,
        (
          (
            SELECT COUNT(*)
            FROM unnest(tags) AS tag
            WHERE lower(tag) = ANY($2::text[])
          ) * 5.0
          + GREATEST(similarity(lower(summary), $3), similarity(lower(content), $3)) * 3.0
          + ts_rank(
              to_tsvector('simple', coalesce(summary, '') || ' ' || coalesce(content, '')),
              websearch_to_tsquery('simple', $4)
            ) * 2.0
          + importance * 0.1
          + confidence * 0.5
        ) AS score
      FROM memory_items
      WHERE session_id = $1
        AND kind = 'event'
        AND status = 'active'
        AND (
          EXISTS (
            SELECT 1
            FROM unnest(tags) AS tag
            WHERE lower(tag) = ANY($2::text[])
          )
          OR similarity(lower(summary), $3) > 0.1
          OR similarity(lower(content), $3) > 0.1
          OR to_tsvector('simple', coalesce(summary, '') || ' ' || coalesce(content, ''))
             @@ websearch_to_tsquery('simple', $4)
        )
      ORDER BY score DESC, importance DESC, confidence DESC, created_at DESC
      LIMIT $5
    `,
    [
      query.sessionId,
      searchTerms,
      normalizedQuery,
      query.userQuery,
      query.limit ?? 5,
    ],
  )

  return mapMemoryRecallRows(result.rows)
}

async function searchFallback(
  pool: Pool,
  query: MemoryRecallQuery,
  searchTerms: string[],
  normalizedQuery: string,
): Promise<MemoryRecallResult[]> {
  const likePattern = `%${escapeLike(normalizedQuery)}%`
  const result = await pool.query<MemoryRecallRow>(
    `
      SELECT
        id,
        kind,
        summary,
        content,
        tags,
        importance,
        confidence,
        payload_json->>'occurred_at' AS occurred_at,
        source_event_ids,
        (
          (
            SELECT COUNT(*)
            FROM unnest(tags) AS tag
            WHERE lower(tag) = ANY($2::text[])
          ) * 5.0
          + CASE WHEN lower(summary) LIKE $3 ESCAPE '\\' THEN 1.5 ELSE 0 END
          + CASE WHEN lower(content) LIKE $3 ESCAPE '\\' THEN 1.5 ELSE 0 END
          + ts_rank(
              to_tsvector('simple', coalesce(summary, '') || ' ' || coalesce(content, '')),
              websearch_to_tsquery('simple', $4)
            ) * 2.0
          + importance * 0.1
          + confidence * 0.5
        ) AS score
      FROM memory_items
      WHERE session_id = $1
        AND kind = 'event'
        AND status = 'active'
        AND (
          EXISTS (
            SELECT 1
            FROM unnest(tags) AS tag
            WHERE lower(tag) = ANY($2::text[])
          )
          OR lower(summary) LIKE $3 ESCAPE '\\'
          OR lower(content) LIKE $3 ESCAPE '\\'
          OR to_tsvector('simple', coalesce(summary, '') || ' ' || coalesce(content, ''))
             @@ websearch_to_tsquery('simple', $4)
        )
      ORDER BY score DESC, importance DESC, confidence DESC, created_at DESC
      LIMIT $5
    `,
    [
      query.sessionId,
      searchTerms,
      likePattern,
      query.userQuery,
      query.limit ?? 5,
    ],
  )

  return mapMemoryRecallRows(result.rows)
}

export async function searchEventMemories(
  pool: Pool,
  query: MemoryRecallQuery,
): Promise<MemoryRecallResult[]> {
  const normalizedQuery = normalizeSearchText(query.userQuery)
  if (normalizedQuery.length < 2) {
    return []
  }

  const searchTerms = extractSearchTerms(query.userQuery)

  if (await hasPgTrgmExtension(pool)) {
    return searchWithTrgm(pool, query, searchTerms, normalizedQuery)
  }

  return searchFallback(pool, query, searchTerms, normalizedQuery)
}
