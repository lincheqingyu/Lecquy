-- 为 memory recall 增加安全的 text-first 检索索引
-- 不强依赖 pg_trgm；trigram 查询可在扩展已安装时自动受益

CREATE INDEX memory_items_event_fts_idx
  ON memory_items
  USING GIN (to_tsvector('simple', coalesce(summary, '') || ' ' || coalesce(content, '')))
  WHERE kind = 'event' AND status = 'active';
