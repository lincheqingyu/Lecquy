-- 中文：本文件（dedupe.sql）位于 backend/src/memory/dedupe.sql，属于backend链路中的数据库脚本代码，连接上游调用方与下游执行逻辑。
-- English: This file (dedupe.sql) belongs to the backend 数据库脚本 layer in backend/src/memory/dedupe.sql, wiring upstream callers with downstream runtime logic.

-- 清理 memory_items 中按 (kind, event_type, project_id, summary, content) 完全重复的条目。
-- 保留每组中 rowid 最小的那一条。
-- 执行前先备份：
-- cp .lecquy/memory/memory.db .lecquy/memory/memory.db.bak
--
-- 执行：
-- sqlite3 .lecquy/memory/memory.db < backend/src/memory/dedupe.sql

BEGIN;

DELETE FROM memory_items
WHERE rowid NOT IN (
  SELECT MIN(rowid)
  FROM memory_items
  GROUP BY
    kind,
    COALESCE(event_type, ''),
    COALESCE(project_id, ''),
    summary,
    content
);

INSERT INTO memory_items_fts(memory_items_fts) VALUES('rebuild');

COMMIT;
