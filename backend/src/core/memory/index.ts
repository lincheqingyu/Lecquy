// 中文：本文件（index.ts）位于 backend/src/core/memory/index.ts，属于backend链路中的核心运行时与配置代码，连接上游调用方与下游执行逻辑。
// English: This file (index.ts) belongs to the backend 核心运行时与配置 layer in backend/src/core/memory/index.ts, wiring upstream callers with downstream runtime logic.

export type { MemoryConfig } from './config.js'
export { getMemoryConfig, saveMemoryConfig, resetMemoryConfigCache } from './config.js'
