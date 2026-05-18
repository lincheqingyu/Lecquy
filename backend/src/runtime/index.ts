// 中文：本文件（index.ts）位于 backend/src/runtime/index.ts，属于backend链路中的会话运行时代码，连接上游调用方与下游执行逻辑。
// English: This file (index.ts) belongs to the backend 会话运行时 layer in backend/src/runtime/index.ts, wiring upstream callers with downstream runtime logic.

export {
  SessionRuntimeService,
  createSessionRuntimeService,
  getSessionRuntimeService,
  type SendRunResult,
  type SessionDetail,
  type SpawnTaskResult,
} from './session-runtime-service.js'
export { resolveSessionKey, type SessionBinding } from './session-key.js'
export { SessionManager, buildSessionContext, CURRENT_SESSION_VERSION, type SessionContext } from './pi-session-core/session-manager.js'
