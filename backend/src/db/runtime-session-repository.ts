import type { Pool, PoolClient } from 'pg'
import { extractSessionText, type SessionEventEntry, type SessionProjection } from '@webclaw/shared'

function toTimestamp(value?: number): Date {
  return new Date(value ?? Date.now())
}

function toEventTimestamp(value: string): Date {
  const parsed = Date.parse(value)
  return new Date(Number.isNaN(parsed) ? Date.now() : parsed)
}

function serializeRoute(projection: SessionProjection): string {
  return JSON.stringify(projection.route ?? { channel: projection.channel })
}

function deriveSessionMode(projection: SessionProjection): string | null {
  return projection.workflow?.mode ?? null
}

function extractEventContentText(entry: SessionEventEntry): string | null {
  switch (entry.type) {
    case 'message':
      return extractSessionText(entry.message.content) || null
    case 'custom_message':
      return extractSessionText(entry.content) || null
    case 'branch_summary':
      return entry.summary || null
    case 'compaction':
      return entry.summary || null
    case 'session_info':
      return entry.name?.trim() || null
    case 'session_tool_invoked':
    case 'session_tool_finished':
      return entry.detail?.trim() || null
    case 'run_finished':
      return entry.error?.trim() || null
    case 'pause_resolved':
      return entry.input.trim() || null
    default:
      return null
  }
}

function extractEventContentJson(entry: SessionEventEntry): unknown | null {
  switch (entry.type) {
    case 'message':
      return entry.message.content
    case 'custom_message':
      return entry.content
    default:
      return null
  }
}

async function ensureSessionRow(client: PoolClient, projection: SessionProjection): Promise<number> {
  const existing = await client.query<{ last_event_seq: number }>(
    'SELECT last_event_seq FROM sessions WHERE id = $1 FOR UPDATE',
    [projection.sessionId],
  )

  if (existing.rowCount && existing.rows[0]) {
    return existing.rows[0].last_event_seq
  }

  await client.query(
    `
      INSERT INTO sessions (
        id,
        route,
        mode,
        title,
        created_at,
        updated_at,
        last_event_seq,
        projection_json
      ) VALUES ($1, $2, $3, $4, $5, $6, 0, $7::jsonb)
    `,
    [
      projection.sessionId,
      serializeRoute(projection),
      deriveSessionMode(projection),
      projection.title ?? null,
      toTimestamp(projection.createdAt),
      toTimestamp(projection.updatedAt),
      JSON.stringify(projection),
    ],
  )

  return 0
}

async function insertMissingEvents(
  client: PoolClient,
  sessionId: string,
  lastEventSeq: number,
  entries: SessionEventEntry[],
): Promise<number> {
  const missingEntries = entries.slice(lastEventSeq)
  if (missingEntries.length === 0) {
    return lastEventSeq
  }

  for (let index = 0; index < missingEntries.length; index += 1) {
    const entry = missingEntries[index]
    const seq = lastEventSeq + index + 1

    await client.query(
      `
        INSERT INTO session_events (
          session_id,
          seq,
          event_type,
          role,
          content_text,
          content_json,
          payload_json,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)
        ON CONFLICT (session_id, seq) DO NOTHING
      `,
      [
        sessionId,
        seq,
        entry.type,
        entry.type === 'message' ? entry.message.role : null,
        extractEventContentText(entry),
        JSON.stringify(extractEventContentJson(entry)),
        JSON.stringify(entry),
        toEventTimestamp(entry.timestamp),
      ],
    )
  }

  return lastEventSeq + missingEntries.length
}

async function updateSessionRow(
  client: PoolClient,
  projection: SessionProjection,
  lastEventSeq: number,
): Promise<void> {
  await client.query(
    `
      UPDATE sessions
      SET route = $2,
          mode = $3,
          title = $4,
          updated_at = $5,
          last_event_seq = $6,
          projection_json = $7::jsonb
      WHERE id = $1
    `,
    [
      projection.sessionId,
      serializeRoute(projection),
      deriveSessionMode(projection),
      projection.title ?? null,
      toTimestamp(projection.updatedAt),
      lastEventSeq,
      JSON.stringify(projection),
    ],
  )
}

export async function syncRuntimeSession(
  pool: Pool,
  projection: SessionProjection,
  entries: SessionEventEntry[],
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const lastEventSeq = await ensureSessionRow(client, projection)
    const nextLastEventSeq = await insertMissingEvents(client, projection.sessionId, lastEventSeq, entries)
    await updateSessionRow(client, projection, Math.max(nextLastEventSeq, entries.length))
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function deleteRuntimeSession(pool: Pool, sessionId: string): Promise<void> {
  await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId])
}
