-- 第一版 runtime 核心表
-- 只建 sessions 和 session_events，不涉及 memory 和 compact

-- ─── sessions ─────────────────────────────────────────────────────────────────
-- 每行对应一个会话快照：路由、模式、最新 projection、最后写入时序
CREATE TABLE sessions (
  id              TEXT        PRIMARY KEY,
  route           TEXT        NOT NULL,
  mode            TEXT,
  title           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_event_seq  INTEGER     NOT NULL DEFAULT 0,
  projection_json JSONB
);

-- 支持按最近活跃时间倒序列表
CREATE INDEX sessions_updated_at_idx ON sessions (updated_at DESC);

-- ─── session_events ───────────────────────────────────────────────────────────
-- append-only 事件流，每行是一个不可变事件
-- seq 在同一 session 内单调递增，从 1 开始
CREATE TABLE session_events (
  id           BIGSERIAL   PRIMARY KEY,
  session_id   TEXT        NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  seq          INTEGER     NOT NULL,
  event_type   TEXT        NOT NULL,
  role         TEXT,
  content_text TEXT,
  content_json JSONB,
  payload_json JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- 同一 session 内 seq 唯一，同时作为主查询索引
  CONSTRAINT session_events_session_id_seq_unique UNIQUE (session_id, seq)
);
