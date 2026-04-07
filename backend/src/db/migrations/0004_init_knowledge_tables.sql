-- 第一版 knowledge / RAG spike 表
-- 只冻结文档与分块边界，不引入 embedding、不接主链路

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE TABLE knowledge_documents (
  id            TEXT        PRIMARY KEY,
  source_type   TEXT        NOT NULL,
  source_uri    TEXT,
  title         TEXT        NOT NULL,
  metadata_json JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE knowledge_chunks (
  id            TEXT        PRIMARY KEY,
  document_id   TEXT        NOT NULL REFERENCES knowledge_documents (id) ON DELETE CASCADE,
  seq           INTEGER     NOT NULL,
  content       TEXT        NOT NULL,
  metadata_json JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX knowledge_chunks_document_id_seq_idx
  ON knowledge_chunks (document_id, seq);

CREATE INDEX knowledge_chunks_content_trgm_idx
  ON knowledge_chunks
  USING GIN (content gin_trgm_ops);
