// 中文：本文件（index.ts）位于 backend/src/session-v2/index.ts，属于backend链路中的会话服务代码，连接上游调用方与下游执行逻辑。
// English: This file (index.ts) belongs to the backend 会话服务 layer in backend/src/session-v2/index.ts, wiring upstream callers with downstream runtime logic.

export { SessionService, createSessionService, getSessionService } from './session-service.js'
export type { SessionDetail } from './session-service.js'
export type { Mode, SessionRuntimeState, ActiveSession, SessionRouteEnvelope } from './types.js'
