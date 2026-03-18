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
