-- 中文：本文件（0004_init_knowledge_tables.sql）位于 backend/src/db/migrations/0004_init_knowledge_tables.sql，属于backend链路中的数据库脚本代码，连接上游调用方与下游执行逻辑。
-- English: This file (0004_init_knowledge_tables.sql) belongs to the backend 数据库脚本 layer in backend/src/db/migrations/0004_init_knowledge_tables.sql, wiring upstream callers with downstream runtime logic.

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
