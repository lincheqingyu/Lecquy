-- 中文：本文件（0003_memory_search_indexes.sql）位于 backend/src/db/migrations/0003_memory_search_indexes.sql，属于backend链路中的数据库脚本代码，连接上游调用方与下游执行逻辑。
-- English: This file (0003_memory_search_indexes.sql) belongs to the backend 数据库脚本 layer in backend/src/db/migrations/0003_memory_search_indexes.sql, wiring upstream callers with downstream runtime logic.

-- 为 memory recall 增加安全的 text-first 检索索引
-- 不强依赖 pg_trgm；trigram 查询可在扩展已安装时自动受益

CREATE INDEX memory_items_event_fts_idx
  ON memory_items
  USING GIN (to_tsvector('simple', coalesce(summary, '') || ' ' || coalesce(content, '')))
  WHERE kind = 'event' AND status = 'active';
