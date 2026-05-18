// 中文：本文件（sqlite-store.ts）位于 backend/src/memory/sqlite-store.ts，属于backend链路中的memory 记忆链路代码，连接上游调用方与下游执行逻辑。
// English: This file (sqlite-store.ts) belongs to the backend memory 记忆链路 layer in backend/src/memory/sqlite-store.ts, wiring upstream callers with downstream runtime logic.

import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { resolveRuntimePaths } from '../core/runtime-paths.js'
import type { ExtractedEventType, MemoryItemInsert, MemoryStatus } from './types.js'

type Database = BetterSqlite3.Database

type SqliteMemoryKind = 'event' | 'compaction'
type SqliteMemoryStatus = Extract<MemoryStatus, 'active'> | 'archived'

export interface SQLiteMemoryItemInsert extends Omit<MemoryItemInsert, 'kind' | 'status'> {
  readonly kind: MemoryItemInsert['kind'] | 'compaction'
  readonly projectId?: string
  readonly status: MemoryStatus | 'archived'
}

export interface MemoryItemRow {
  readonly id: string
  readonly kind: SqliteMemoryKind
  readonly eventType?: ExtractedEventType
  readonly projectId?: string
  readonly sessionId?: string
  readonly sessionKey?: string
  readonly summary: string
  readonly content: string
  readonly tags: string[]
  readonly importance: number
  readonly confidence: number
  readonly status: SqliteMemoryStatus
  readonly sourceEventIds: string[]
  readonly sourceSessionId?: string
  readonly occurredAt: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly score?: number
}

export interface MemorySearchOptions {
  readonly projectId?: string
  readonly limit?: number
  readonly query?: string
  readonly eventTypes?: readonly ExtractedEventType[]
  readonly sinceDays?: number
}

export interface RecallOptions {
  readonly currentProjectId?: string
  readonly userQuery?: string
  readonly limit?: number
  readonly sinceDays?: number
}

interface RawMemoryItemRow {
  readonly id: string
  readonly kind: string
  readonly event_type: string | null
  readonly project_id: string | null
  readonly session_id: string | null
  readonly session_key: string | null
  readonly summary: string
  readonly content: string
  readonly tags_json: string
  readonly importance: number
  readonly confidence: number
  readonly status: string
  readonly source_event_ids_json: string
  readonly source_session_id: string | null
  readonly occurred_at: string
  readonly created_at: string
  readonly updated_at: string
  readonly score?: number
}

interface CachedStatements {
  readonly insertMemoryItem: BetterSqlite3.Statement
  readonly getWatermark: BetterSqlite3.Statement<[string]>
  readonly setWatermark: BetterSqlite3.Statement<[string, number]>
}

const DEFAULT_LIMIT = 10
export const MEMORY_RECALL_TOP_K = 5
const RECALL_RECENCY_HALF_LIFE_DAYS = 30
const SCORE_WEIGHTS = {
  bm25: 0.40,
  importance: 0.25,
  recency: 0.25,
  projectMatch: 0.10,
} as const
const MEMORY_DB_FILE = 'memory.db'

let db: Database | null = null
let dbPath: string | null = null
let statements: CachedStatements | null = null

function resolveDefaultDbPath(): string {
  return join(resolveRuntimePaths().memoryDir, MEMORY_DB_FILE)
}

function resolveDbPath(): string {
  return process.env.LECQUY_MEMORY_DB_PATH?.trim() || resolveDefaultDbPath()
}

function ensureDbDirectory(targetPath: string): void {
  if (targetPath === ':memory:') return
  mkdirSync(dirname(targetPath), { recursive: true })
}

function initializeSchema(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS memory_items (
      id            TEXT     PRIMARY KEY,
      kind          TEXT     NOT NULL,
      event_type    TEXT,
      project_id    TEXT,
      session_id    TEXT,
      session_key   TEXT,
      summary       TEXT     NOT NULL,
      content       TEXT     NOT NULL,
      tags_json     TEXT     NOT NULL DEFAULT '[]',
      importance    REAL     NOT NULL DEFAULT 5,
      confidence    REAL     NOT NULL DEFAULT 0.5,
      status        TEXT     NOT NULL DEFAULT 'active',
      source_event_ids_json TEXT NOT NULL DEFAULT '[]',
      source_session_id     TEXT,
      occurred_at   TEXT     NOT NULL,
      created_at    TEXT     NOT NULL DEFAULT (datetime('now')),
      updated_at    TEXT     NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_project_occurred
      ON memory_items(project_id, occurred_at DESC)
      WHERE status = 'active';

    CREATE INDEX IF NOT EXISTS idx_event_type_created
      ON memory_items(event_type, created_at DESC)
      WHERE status = 'active';

    CREATE INDEX IF NOT EXISTS idx_session_created
      ON memory_items(session_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS memory_extraction_watermark (
      session_id TEXT PRIMARY KEY,
      last_extracted_seq INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS memory_items_fts USING fts5(
      summary, content, tags_text,
      content='memory_items',
      content_rowid='rowid',
      tokenize='unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS memory_items_ai AFTER INSERT ON memory_items BEGIN
      INSERT INTO memory_items_fts(rowid, summary, content, tags_text)
      VALUES (new.rowid, new.summary, new.content, replace(replace(new.tags_json, '[', ''), ']', ''));
    END;

    CREATE TRIGGER IF NOT EXISTS memory_items_ad AFTER DELETE ON memory_items BEGIN
      INSERT INTO memory_items_fts(memory_items_fts, rowid, summary, content, tags_text)
      VALUES ('delete', old.rowid, old.summary, old.content, replace(replace(old.tags_json, '[', ''), ']', ''));
    END;

    CREATE TRIGGER IF NOT EXISTS memory_items_au AFTER UPDATE ON memory_items BEGIN
      INSERT INTO memory_items_fts(memory_items_fts, rowid, summary, content, tags_text)
      VALUES ('delete', old.rowid, old.summary, old.content, replace(replace(old.tags_json, '[', ''), ']', ''));
      INSERT INTO memory_items_fts(rowid, summary, content, tags_text)
      VALUES (new.rowid, new.summary, new.content, replace(replace(new.tags_json, '[', ''), ']', ''));
    END;
  `)
}

function registerSqlFunctions(database: Database): void {
  database.function('pow_decay', { deterministic: true }, (daysAgoValue: unknown, halfLifeValue: unknown) => {
    const daysAgo = typeof daysAgoValue === 'number' && Number.isFinite(daysAgoValue)
      ? Math.max(daysAgoValue, 0)
      : 0
    const halfLife = typeof halfLifeValue === 'number' && Number.isFinite(halfLifeValue) && halfLifeValue > 0
      ? halfLifeValue
      : RECALL_RECENCY_HALF_LIFE_DAYS

    return Math.pow(0.5, daysAgo / halfLife)
  })
}

function parseJsonArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return []
  }
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function isExtractedEventType(value: unknown): value is ExtractedEventType {
  return (
    value === 'user_fact'
    || value === 'assistant_commitment'
    || value === 'tool_action'
    || value === 'decision'
    || value === 'observation'
  )
}

function getPayloadString(item: { readonly payloadJson: Record<string, unknown> }, key: string): string | undefined {
  const value = item.payloadJson[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function mapRow(row: RawMemoryItemRow): MemoryItemRow {
  return {
    id: row.id,
    kind: row.kind === 'compaction' ? 'compaction' : 'event',
    eventType: isExtractedEventType(row.event_type) ? row.event_type : undefined,
    projectId: row.project_id ?? undefined,
    sessionId: row.session_id ?? undefined,
    sessionKey: row.session_key ?? undefined,
    summary: row.summary,
    content: row.content,
    tags: parseJsonArray(row.tags_json),
    importance: row.importance,
    confidence: row.confidence,
    status: row.status === 'archived' ? 'archived' : 'active',
    sourceEventIds: parseJsonArray(row.source_event_ids_json),
    sourceSessionId: row.source_session_id ?? undefined,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    score: row.score,
  }
}

function normalizeFtsQuery(query: string): string {
  return query
    .replace(/[^\p{L}\p{N}_]+/gu, ' ')
    .trim()
    .split(/\s+/)
    .map((term) => term.replace(/"/g, '""').trim())
    .filter(Boolean)
    .map((term) => `"${term}"`)
    .join(' OR ')
}

function createSinceDate(sinceDays: number): string {
  return new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000).toISOString()
}

function getStatements(database: Database): CachedStatements {
  if (statements) return statements

  statements = {
    insertMemoryItem: database.prepare(`
      INSERT INTO memory_items (
        id,
        kind,
        event_type,
        project_id,
        session_id,
        session_key,
        summary,
        content,
        tags_json,
        importance,
        confidence,
        status,
        source_event_ids_json,
        source_session_id,
        occurred_at,
        created_at,
        updated_at
      ) VALUES (
        @id,
        @kind,
        @eventType,
        @projectId,
        @sessionId,
        @sessionKey,
        @summary,
        @content,
        @tagsJson,
        @importance,
        @confidence,
        @status,
        @sourceEventIdsJson,
        @sourceSessionId,
        @occurredAt,
        @createdAt,
        @updatedAt
      )
    `),
    getWatermark: database.prepare(`
      SELECT last_extracted_seq AS lastExtractedSeq
      FROM memory_extraction_watermark
      WHERE session_id = ?
    `),
    setWatermark: database.prepare(`
      INSERT INTO memory_extraction_watermark (
        session_id,
        last_extracted_seq,
        updated_at
      ) VALUES (
        ?,
        ?,
        datetime('now')
      )
      ON CONFLICT(session_id) DO UPDATE
      SET last_extracted_seq = excluded.last_extracted_seq,
          updated_at = excluded.updated_at
    `),
  }
  return statements
}

function insertMemoryItemsImpl(database: Database, items: readonly SQLiteMemoryItemInsert[]): void {
  const insert = getStatements(database).insertMemoryItem

  for (const item of items) {
    const eventType = getPayloadString(item, 'event_type')
    insert.run({
      id: item.id,
      kind: item.kind === 'compaction' ? 'compaction' : 'event',
      eventType: isExtractedEventType(eventType) ? eventType : null,
      projectId: item.projectId ?? null,
      sessionId: item.sessionId ?? null,
      sessionKey: item.sessionKey ?? null,
      summary: item.summary,
      content: item.content,
      tagsJson: JSON.stringify(item.tags),
      importance: item.importance,
      confidence: item.confidence,
      status: item.status === 'active' ? 'active' : 'archived',
      sourceEventIdsJson: JSON.stringify(item.sourceEventIds),
      sourceSessionId: item.sourceSessionId ?? null,
      occurredAt: getPayloadString(item, 'occurred_at') ?? item.createdAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })
  }
}

function setLastExtractedSeqImpl(database: Database, sessionId: string, seq: number): void {
  getStatements(database).setWatermark.run(sessionId, seq)
}

interface RecallSelectInput {
  readonly currentProjectId: string
  readonly ftsQuery: string
  readonly projectId?: string
  readonly excludeIds: readonly string[]
  readonly limit: number
  readonly sinceDays?: number
}

function normalizePositiveLimit(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback
}

function buildRecallFilters(input: RecallSelectInput): {
  readonly filters: string[]
  readonly params: Array<string | number>
} {
  const filters = [
    "memory_items.status = 'active'",
    "memory_items.kind = 'event'",
  ]
  const params: Array<string | number> = []

  if (input.projectId) {
    filters.push('memory_items.project_id = ?')
    params.push(input.projectId)
  }

  if (input.excludeIds.length > 0) {
    filters.push(`memory_items.id NOT IN (${input.excludeIds.map(() => '?').join(', ')})`)
    params.push(...input.excludeIds)
  }

  if (typeof input.sinceDays === 'number' && input.sinceDays > 0) {
    filters.push('memory_items.occurred_at >= ?')
    params.push(createSinceDate(input.sinceDays))
  }

  return { filters, params }
}

function selectRecallRows(database: Database, input: RecallSelectInput): MemoryItemRow[] {
  if (input.limit <= 0) return []

  const { filters, params } = buildRecallFilters(input)
  const scoreParams = [
    SCORE_WEIGHTS.bm25,
    SCORE_WEIGHTS.importance,
    SCORE_WEIGHTS.recency,
    RECALL_RECENCY_HALF_LIFE_DAYS,
    SCORE_WEIGHTS.projectMatch,
    input.currentProjectId,
  ] as const

  if (input.ftsQuery) {
    const rows = database.prepare(`
      WITH fts_scores AS (
        SELECT
          rowid AS item_rowid,
          -rank AS bm25_score
        FROM memory_items_fts
        WHERE memory_items_fts MATCH ?
      ),
      max_score AS (
        SELECT MAX(bm25_score) AS max_bm25
        FROM fts_scores
      )
      SELECT
        memory_items.*,
        (
          ? * CASE
            WHEN COALESCE(fts_scores.bm25_score, 0) > 0
              AND COALESCE(max_score.max_bm25, 0) > 0
            THEN fts_scores.bm25_score / max_score.max_bm25
            ELSE 0
          END
          + ? * (memory_items.importance / 10.0)
          + ? * pow_decay(julianday('now') - julianday(memory_items.occurred_at), ?)
          + ? * CASE WHEN memory_items.project_id = ? THEN 1.0 ELSE 0.0 END
        ) AS score
      FROM memory_items
      LEFT JOIN fts_scores ON fts_scores.item_rowid = memory_items.rowid
      CROSS JOIN max_score
      WHERE ${filters.join(' AND ')}
      ORDER BY
        score DESC,
        COALESCE(fts_scores.bm25_score, 0) DESC,
        memory_items.importance DESC,
        memory_items.occurred_at DESC
      LIMIT ?
    `).all(input.ftsQuery, ...scoreParams, ...params, input.limit) as RawMemoryItemRow[]

    return rows.map(mapRow)
  }

  const rows = database.prepare(`
    SELECT
      memory_items.*,
      (
        ? * 0.0
        + ? * (memory_items.importance / 10.0)
        + ? * pow_decay(julianday('now') - julianday(memory_items.occurred_at), ?)
        + ? * CASE WHEN memory_items.project_id = ? THEN 1.0 ELSE 0.0 END
      ) AS score
    FROM memory_items
    WHERE ${filters.join(' AND ')}
    ORDER BY
      score DESC,
      memory_items.importance DESC,
      memory_items.occurred_at DESC
    LIMIT ?
  `).all(...scoreParams, ...params, input.limit) as RawMemoryItemRow[]

  return rows.map(mapRow)
}

export function getDb(): Database {
  const targetPath = resolveDbPath()
  if (db && dbPath === targetPath) return db

  closeDb()
  ensureDbDirectory(targetPath)

  const database = new BetterSqlite3(targetPath)
  database.pragma('journal_mode = WAL')
  database.pragma('foreign_keys = ON')
  registerSqlFunctions(database)
  initializeSchema(database)

  db = database
  dbPath = targetPath
  return database
}

export function closeDb(): void {
  if (db) {
    db.close()
    db = null
    dbPath = null
    statements = null
  }
}

export function insertMemoryItems(items: readonly SQLiteMemoryItemInsert[]): void {
  if (items.length === 0) return

  const database = getDb()
  const insertMany = database.transaction((records: readonly SQLiteMemoryItemInsert[]) => {
    insertMemoryItemsImpl(database, records)
  })

  insertMany(items)
}

export function getLastExtractedSeq(sessionId: string): number {
  const row = getStatements(getDb()).getWatermark.get(sessionId) as { lastExtractedSeq: number } | undefined
  return row?.lastExtractedSeq ?? 0
}

export function setLastExtractedSeq(sessionId: string, seq: number): void {
  setLastExtractedSeqImpl(getDb(), sessionId, seq)
}

export function insertItemsAndAdvanceWatermark(
  items: readonly SQLiteMemoryItemInsert[],
  sessionId: string,
  newSeq: number,
): void {
  const database = getDb()
  const insertAndAdvance = database.transaction(() => {
    if (items.length > 0) {
      insertMemoryItemsImpl(database, items)
    }
    setLastExtractedSeqImpl(database, sessionId, newSeq)
  })

  insertAndAdvance()
}

export function searchMemoryItems(options: MemorySearchOptions | string = {}): MemoryItemRow[] {
  const opts: MemorySearchOptions = typeof options === 'string'
    ? { query: options }
    : options
  const limit = opts.limit && opts.limit > 0 ? opts.limit : DEFAULT_LIMIT
  const params: Array<string | number> = []
  const filters = ['memory_items.status = ?']
  params.push('active')

  if (opts.projectId) {
    filters.push('memory_items.project_id = ?')
    params.push(opts.projectId)
  }

  if (opts.eventTypes && opts.eventTypes.length > 0) {
    filters.push(`memory_items.event_type IN (${opts.eventTypes.map(() => '?').join(', ')})`)
    params.push(...opts.eventTypes)
  }

  if (typeof opts.sinceDays === 'number' && opts.sinceDays > 0) {
    filters.push('memory_items.occurred_at >= ?')
    params.push(createSinceDate(opts.sinceDays))
  }

  const normalizedQuery = opts.query ? normalizeFtsQuery(opts.query) : ''
  const database = getDb()

  if (normalizedQuery) {
    const rows = database.prepare(`
      SELECT
        memory_items.*,
        -bm25(memory_items_fts) AS score
      FROM memory_items_fts
      JOIN memory_items ON memory_items.rowid = memory_items_fts.rowid
      WHERE memory_items_fts MATCH ?
        AND ${filters.join(' AND ')}
      ORDER BY score DESC, memory_items.importance DESC, memory_items.occurred_at DESC
      LIMIT ?
    `).all(normalizedQuery, ...params, limit) as RawMemoryItemRow[]

    return rows.map(mapRow)
  }

  const rows = database.prepare(`
    SELECT
      memory_items.*,
      0 AS score
    FROM memory_items
    WHERE ${filters.join(' AND ')}
    ORDER BY memory_items.importance DESC, memory_items.occurred_at DESC
    LIMIT ?
  `).all(...params, limit) as RawMemoryItemRow[]

  return rows.map(mapRow)
}

export function searchForRecall(opts: RecallOptions): MemoryItemRow[] {
  const limit = normalizePositiveLimit(opts.limit, MEMORY_RECALL_TOP_K)
  const currentProjectId = opts.currentProjectId?.trim() ?? ''
  const userQuery = normalizeWhitespace(opts.userQuery ?? '')
  const ftsQuery = userQuery.length >= 2 ? normalizeFtsQuery(userQuery) : ''
  const database = getDb()

  if (!currentProjectId) {
    return selectRecallRows(database, {
      currentProjectId,
      ftsQuery,
      excludeIds: [],
      limit,
      sinceDays: opts.sinceDays,
    })
  }

  const projectRows = selectRecallRows(database, {
    currentProjectId,
    ftsQuery,
    projectId: currentProjectId,
    excludeIds: [],
    limit,
    sinceDays: opts.sinceDays,
  })

  if (projectRows.length >= limit) {
    return projectRows
  }

  const globalRows = selectRecallRows(database, {
    currentProjectId,
    ftsQuery,
    excludeIds: projectRows.map((row) => row.id),
    limit: limit - projectRows.length,
    sinceDays: opts.sinceDays,
  })

  return [...projectRows, ...globalRows]
    .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
    .slice(0, limit)
}

export function countMemoryItems(): number {
  const row = getDb().prepare('SELECT COUNT(*) AS count FROM memory_items').get() as { count: number }
  return row.count
}
