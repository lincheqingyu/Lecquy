// 中文：本文件（index.ts）位于 backend/src/types/index.ts，属于backend链路中的backend 模块实现代码，连接上游调用方与下游执行逻辑。
// English: This file (index.ts) belongs to the backend backend 模块实现 layer in backend/src/types/index.ts, wiring upstream callers with downstream runtime logic.

/**
 * 类型统一导出
 */

export type {
  ErrorResponse,
  ApiResponse,
  HealthResponse,
} from './api.js'
