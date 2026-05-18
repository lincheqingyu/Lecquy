// 中文：本文件（index.ts）位于 backend/src/memory/index.ts，属于backend链路中的memory 记忆链路代码，连接上游调用方与下游执行逻辑。
// English: This file (index.ts) belongs to the backend memory 记忆链路 layer in backend/src/memory/index.ts, wiring upstream callers with downstream runtime logic.

export {
  ensureMemoryFiles,
  loadMemoryInjectionText,
  loadMemorySummary,
  appendDailyMemoryEntry,
  getDailyMemoryFilePath,
  getMemoryDir,
  getMainMemoryFilePath,
  listMemoryFiles,
  readMemoryFile,
} from './store.js'
export { recordMemoryTurnAndMaybeFlush, resetMemoryTurnCounter } from './flush.js'
export {
  buildEventExtractionInput,
  createMemoryCoordinator,
  extractAndPersistOnTurnComplete,
  getMemoryCoordinator,
  MemoryCoordinator,
} from './coordinator.js'
export { extractEventMemoryItems } from './extraction-runner.js'
export { deriveProjectId } from './project-id.js'
export {
  closeDb,
  countMemoryItems,
  getDb,
  getLastExtractedSeq,
  insertItemsAndAdvanceWatermark,
  insertMemoryItems,
  MEMORY_RECALL_TOP_K,
  searchForRecall,
  searchMemoryItems,
  setLastExtractedSeq,
} from './sqlite-store.js'
export type {
  MemoryItemRow,
  RecallOptions,
  MemorySearchOptions,
  SQLiteMemoryItemInsert,
} from './sqlite-store.js'
export type {
  EventExtractionInput,
  EventExtractionJobPayload,
  ExtractedEventCandidate,
  ExtractedEventType,
  MemoryItemInsert,
  MemoryJobRecord,
  MemoryJobStatus,
  MemoryJobType,
  MemoryKind,
  MemoryStatus,
} from './types.js'
