import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type {
  EventExtractionInput,
  EventExtractionJobPayload,
  MemoryItemInsert,
  MemoryJobRecord,
} from '../memory/types.js'

interface SessionProjectionRow {
  title: string | null
  mode: string | null
}

function createMemoryJobId(): string {
  return `mjob_${randomUUID()}`
}

function createMemoryItemId(): string {
  return `mem_${randomUUID()}`
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function mapMemoryJobRow(row: {
  id: string
  job_type: string
  status: string
  session_id: string
  trigger_event_seq: number | null
  payload_json: unknown
  attempt_count: number
  last_error: string | null
  created_at: Date | string
  updated_at: Date | string
}): MemoryJobRecord {
  return {
    id: row.id,
    jobType: row.job_type as MemoryJobRecord['jobType'],
    status: row.status as MemoryJobRecord['status'],
    sessionId: row.session_id,
    triggerEventSeq: typeof row.trigger_event_seq === 'number' ? row.trigger_event_seq : null,
    payloadJson: asObject(row.payload_json),
    attemptCount: row.attempt_count,
    lastError: row.last_error,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

export function newMemoryItemId(): string {
  return createMemoryItemId()
}

export async function getLatestTriggerEventSeq(
  pool: Pool,
  sessionId: string,
  jobType: MemoryJobRecord['jobType'],
): Promise<number> {
  const result = await pool.query<{ latest_seq: number | null }>(
    `
      SELECT MAX(trigger_event_seq)::int AS latest_seq
      FROM memory_jobs
      WHERE session_id = $1
        AND job_type = $2
    `,
    [sessionId, jobType],
  )

  return result.rows[0]?.latest_seq ?? 0
}

export async function enqueueEventExtractionJob(
  pool: Pool,
  args: {
    sessionId: string
    triggerEventSeq: number
    payload: EventExtractionJobPayload
  },
): Promise<boolean> {
  const result = await pool.query(
    `
      INSERT INTO memory_jobs (
        id,
        job_type,
        status,
        session_id,
        trigger_event_seq,
        payload_json
      ) VALUES ($1, 'extract_event', 'pending', $2, $3, $4::jsonb)
      ON CONFLICT (session_id, job_type, trigger_event_seq) DO NOTHING
    `,
    [
      createMemoryJobId(),
      args.sessionId,
      args.triggerEventSeq,
      JSON.stringify(args.payload),
    ],
  )

  return (result.rowCount ?? 0) > 0
}

export async function claimNextPendingMemoryJob(pool: Pool): Promise<MemoryJobRecord | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await client.query<{
      id: string
      job_type: string
      status: string
      session_id: string
      trigger_event_seq: number | null
      payload_json: unknown
      attempt_count: number
      last_error: string | null
      created_at: Date | string
      updated_at: Date | string
    }>(
      `
        WITH next_job AS (
          SELECT id
          FROM memory_jobs
          WHERE status = 'pending'
          ORDER BY created_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE memory_jobs jobs
        SET status = 'running',
            attempt_count = jobs.attempt_count + 1,
            updated_at = NOW()
        FROM next_job
        WHERE jobs.id = next_job.id
        RETURNING jobs.*
      `,
    )
    await client.query('COMMIT')

    if ((result.rowCount ?? 0) === 0 || !result.rows[0]) {
      return null
    }

    return mapMemoryJobRow(result.rows[0])
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}

export async function markMemoryJobDone(pool: Pool, jobId: string): Promise<void> {
  await pool.query(
    `
      UPDATE memory_jobs
      SET status = 'done',
          last_error = NULL,
          updated_at = NOW()
      WHERE id = $1
    `,
    [jobId],
  )
}

export async function markMemoryJobFailure(
  pool: Pool,
  jobId: string,
  args: { error: string; retryable: boolean },
): Promise<void> {
  await pool.query(
    `
      UPDATE memory_jobs
      SET status = $2,
          last_error = $3,
          updated_at = NOW()
      WHERE id = $1
    `,
    [jobId, args.retryable ? 'pending' : 'failed', args.error],
  )
}

export async function insertMemoryItems(pool: Pool, items: MemoryItemInsert[]): Promise<void> {
  for (const item of items) {
    await pool.query(
      `
        INSERT INTO memory_items (
          id,
          kind,
          session_id,
          session_key,
          summary,
          content,
          payload_json,
          tags,
          importance,
          confidence,
          status,
          source_event_ids,
          source_session_id,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7::jsonb, $8::text[], $9, $10, $11, $12::text[], $13, $14, $15
        )
      `,
      [
        item.id,
        item.kind,
        item.sessionId ?? null,
        item.sessionKey ?? null,
        item.summary,
        item.content,
        JSON.stringify(item.payloadJson),
        item.tags,
        item.importance,
        item.confidence,
        item.status,
        item.sourceEventIds,
        item.sourceSessionId ?? null,
        item.createdAt,
        item.updatedAt,
      ],
    )
  }
}

export async function upsertMemoryItems(pool: Pool, items: MemoryItemInsert[]): Promise<void> {
  for (const item of items) {
    await pool.query(
      `
        INSERT INTO memory_items (
          id,
          kind,
          session_id,
          session_key,
          summary,
          content,
          payload_json,
          tags,
          importance,
          confidence,
          status,
          source_event_ids,
          source_session_id,
          created_at,
          updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7::jsonb, $8::text[], $9, $10, $11, $12::text[], $13, $14, $15
        )
        ON CONFLICT (id) DO UPDATE
        SET kind = EXCLUDED.kind,
            session_id = EXCLUDED.session_id,
            session_key = EXCLUDED.session_key,
            summary = EXCLUDED.summary,
            content = EXCLUDED.content,
            payload_json = EXCLUDED.payload_json,
            tags = EXCLUDED.tags,
            importance = EXCLUDED.importance,
            confidence = EXCLUDED.confidence,
            status = EXCLUDED.status,
            source_event_ids = EXCLUDED.source_event_ids,
            source_session_id = EXCLUDED.source_session_id,
            updated_at = EXCLUDED.updated_at
      `,
      [
        item.id,
        item.kind,
        item.sessionId ?? null,
        item.sessionKey ?? null,
        item.summary,
        item.content,
        JSON.stringify(item.payloadJson),
        item.tags,
        item.importance,
        item.confidence,
        item.status,
        item.sourceEventIds,
        item.sourceSessionId ?? null,
        item.createdAt,
        item.updatedAt,
      ],
    )
  }
}

export async function loadEventExtractionInput(
  pool: Pool,
  job: MemoryJobRecord,
): Promise<EventExtractionInput> {
  const payload = job.payloadJson as Partial<EventExtractionJobPayload>
  const fromEventSeq = typeof payload.fromEventSeq === 'number' ? payload.fromEventSeq : 0
  const maxMessages = typeof payload.maxMessages === 'number' ? payload.maxMessages : 8

  const sessionRow = await pool.query<SessionProjectionRow>(
    `
      SELECT title, mode
      FROM sessions
      WHERE id = $1
      LIMIT 1
    `,
    [job.sessionId],
  )

  const messagesResult = await pool.query<{
    seq: number
    role: string | null
    content_text: string | null
    payload_json: unknown
    created_at: Date | string
  }>(
    `
      SELECT seq, role, content_text, payload_json, created_at
      FROM (
        SELECT seq, role, content_text, payload_json, created_at
        FROM session_events
        WHERE session_id = $1
          AND seq > $2
          AND ($3::bigint IS NULL OR seq <= $3)
          AND event_type = 'message'
          AND role IN ('user', 'assistant')
        ORDER BY seq DESC
        LIMIT $4
      ) AS recent_messages
      ORDER BY seq ASC
    `,
    [job.sessionId, fromEventSeq, job.triggerEventSeq, maxMessages],
  )

  return {
    sessionContext: {
      sessionId: job.sessionId,
      sessionKey: typeof payload.sessionKey === 'string' ? payload.sessionKey : undefined,
      title: sessionRow.rows[0]?.title ?? undefined,
      mode: sessionRow.rows[0]?.mode === 'plan' ? 'plan' : 'simple',
    },
    messages: messagesResult.rows.map((row) => {
      const payloadJson = asObject(row.payload_json)
      const eventId = typeof payloadJson.id === 'string'
        ? payloadJson.id
        : `evt_seq_${row.seq}`
      return {
        seq: row.seq,
        eventId,
        role: row.role === 'assistant' ? 'assistant' : 'user',
        text: row.content_text ?? '',
        timestamp: new Date(row.created_at).toISOString(),
      }
    }),
  }
}
