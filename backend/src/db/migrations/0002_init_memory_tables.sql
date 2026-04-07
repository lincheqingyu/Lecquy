-- 第一版 memory 核心表
-- 只落 memory_items / memory_jobs，不涉及 embedding、RAG、graph memory

CREATE TABLE memory_items (
  id               TEXT        PRIMARY KEY,
  kind             TEXT        NOT NULL,
  session_id       TEXT,
  session_key      TEXT,
  summary          TEXT        NOT NULL,
  content          TEXT        NOT NULL,
  payload_json     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  tags             TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  importance       REAL        NOT NULL DEFAULT 5,
  confidence       REAL        NOT NULL DEFAULT 0.5,
  status           TEXT        NOT NULL DEFAULT 'active',
  source_event_ids TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  source_session_id TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX memory_items_kind_status_created_idx
  ON memory_items (kind, status, created_at DESC);

CREATE INDEX memory_items_session_kind_created_idx
  ON memory_items (session_id, kind, created_at DESC);

CREATE INDEX memory_items_tags_idx
  ON memory_items USING GIN (tags);

CREATE TABLE memory_jobs (
  id                TEXT        PRIMARY KEY,
  job_type          TEXT        NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'pending',
  session_id        TEXT        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  trigger_event_seq BIGINT,
  payload_json      JSONB       NOT NULL DEFAULT '{}'::jsonb,
  attempt_count     SMALLINT    NOT NULL DEFAULT 0,
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX memory_jobs_pending_idx
  ON memory_jobs (status, created_at)
  WHERE status = 'pending';

CREATE UNIQUE INDEX memory_jobs_session_type_trigger_idx
  ON memory_jobs (session_id, job_type, trigger_event_seq);
