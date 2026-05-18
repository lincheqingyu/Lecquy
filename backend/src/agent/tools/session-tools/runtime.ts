// 中文：本文件（runtime.ts）位于 backend/src/agent/tools/session-tools/runtime.ts，属于backend链路中的agent 编排与工具链代码，连接上游调用方与下游执行逻辑。
// English: This file (runtime.ts) belongs to the backend agent 编排与工具链 layer in backend/src/agent/tools/session-tools/runtime.ts, wiring upstream callers with downstream runtime logic.

import type { SessionRuntimeService } from '../../../runtime/index.js'

let serviceRef: SessionRuntimeService | null = null
let currentSessionKeyRef: string | null = null

export function bindSessionService(service: SessionRuntimeService): void {
  serviceRef = service
}

export function getBoundSessionService(): SessionRuntimeService {
  if (!serviceRef) throw new Error('SessionRuntimeService 未绑定到 tools runtime')
  return serviceRef
}

export function setCurrentToolSessionKey(sessionKey: string): void {
  currentSessionKeyRef = sessionKey
}

export function clearCurrentToolSessionKey(): void {
  currentSessionKeyRef = null
}

export function getCurrentToolSessionKey(): string | null {
  return currentSessionKeyRef
}
