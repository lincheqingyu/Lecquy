// 中文：本文件（index.d.ts）位于 shared/src/index.d.ts，属于shared链路中的TypeScript 类型声明代码，连接上游调用方与下游执行逻辑。
// English: This file (index.d.ts) belongs to the shared typescript 类型声明 layer in shared/src/index.d.ts, wiring upstream callers with downstream runtime logic.

/**
 * @lecquy/shared — 前后端共享类型
 */
export type { ServerEventType, ClientEventType, ServerEventPayloadMap, ClientEventPayloadMap, ServerEvent, ClientEvent, } from './ws-events.js';
export type { SessionId, SerializedTodoItem, SessionSnapshot, WsConnectParams, } from './session.js';
export { createSessionId } from './session.js';
