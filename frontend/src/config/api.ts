// 中文：本文件（api.ts）位于 frontend/src/config/api.ts，属于frontend链路中的配置与路由代码，连接上游调用方与下游执行逻辑。
// English: This file (api.ts) belongs to the frontend 配置与路由 layer in frontend/src/config/api.ts, wiring upstream callers with downstream runtime logic.

/**
 * API 地址配置
 * 优先使用统一的 BACKEND_ORIGIN，否则从当前页面地址与 BACKEND_PORT 自动派生
 */

declare const __BACKEND_ORIGIN__: string
declare const __LEGACY_WS_BASE__: string
declare const __BACKEND_PORT__: string
declare const __FRONTEND_PORT__: string

function isAutoBase(value: string): boolean {
  return value.trim() === '' || value === 'auto'
}

function normalizeBase(value: string): string {
  return value.replace(/\/+$/, '')
}

function resolveWindowBase(protocol: 'http:' | 'https:' | 'ws:' | 'wss:'): string {
  return `${protocol}//${window.location.hostname}:${__BACKEND_PORT__}`
}

function resolveCurrentOriginBase(protocol: 'http:' | 'https:' | 'ws:' | 'wss:'): string {
  return `${protocol}//${window.location.host}`
}

function currentPort(): string {
  if (window.location.port) return window.location.port
  return window.location.protocol === 'https:' ? '443' : '80'
}

function shouldUseSameOriginBackend(): boolean {
  if (!isAutoBase(__BACKEND_ORIGIN__)) return false
  if (isAutoBase(__FRONTEND_PORT__)) return false
  return currentPort() !== __FRONTEND_PORT__
}

function toWsBase(value: string): string {
  const url = new URL(value)
  if (url.protocol === 'http:') {
    url.protocol = 'ws:'
  } else if (url.protocol === 'https:') {
    url.protocol = 'wss:'
  }
  return normalizeBase(url.toString())
}

function resolveApiBase(): string {
  if (!isAutoBase(__BACKEND_ORIGIN__)) {
    return normalizeBase(__BACKEND_ORIGIN__)
  }

  if (shouldUseSameOriginBackend()) {
    return normalizeBase(window.location.origin)
  }

  return resolveWindowBase(window.location.protocol === 'https:' ? 'https:' : 'http:')
}

function resolveWsBase(): string {
  if (!isAutoBase(__LEGACY_WS_BASE__)) {
    return normalizeBase(__LEGACY_WS_BASE__)
  }

  if (!isAutoBase(__BACKEND_ORIGIN__)) {
    return toWsBase(__BACKEND_ORIGIN__)
  }

  if (shouldUseSameOriginBackend()) {
    return resolveCurrentOriginBase(window.location.protocol === 'https:' ? 'wss:' : 'ws:')
  }

  return resolveWindowBase(window.location.protocol === 'https:' ? 'wss:' : 'ws:')
}

export const API_BASE = resolveApiBase()
export const WS_BASE = resolveWsBase()
export const API_V1 = `${API_BASE}/api/v1`
export const USE_PI_WEB_UI_PARTIAL = import.meta.env.VITE_USE_PI_WEB_UI_PARTIAL === 'true'
