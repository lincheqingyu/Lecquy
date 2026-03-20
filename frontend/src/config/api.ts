/**
 * API 地址配置
 * 优先使用统一的 BACKEND_ORIGIN，否则从当前页面地址与 PORT 自动派生
 */

declare const __BACKEND_ORIGIN__: string
declare const __LEGACY_WS_BASE__: string
declare const __BACKEND_PORT__: string

function isAutoBase(value: string): boolean {
  return value.trim() === '' || value === 'auto'
}

function normalizeBase(value: string): string {
  return value.replace(/\/+$/, '')
}

function resolveWindowBase(protocol: 'http:' | 'https:' | 'ws:' | 'wss:'): string {
  return `${protocol}//${window.location.hostname}:${__BACKEND_PORT__}`
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

  return resolveWindowBase(window.location.protocol === 'https:' ? 'https:' : 'http:')
}

function resolveWsBase(): string {
  if (!isAutoBase(__LEGACY_WS_BASE__)) {
    return normalizeBase(__LEGACY_WS_BASE__)
  }

  if (!isAutoBase(__BACKEND_ORIGIN__)) {
    return toWsBase(__BACKEND_ORIGIN__)
  }

  return resolveWindowBase(window.location.protocol === 'https:' ? 'wss:' : 'ws:')
}

export const API_BASE = resolveApiBase()
export const WS_BASE = resolveWsBase()
export const API_V1 = `${API_BASE}/api/v1`
export const USE_PI_WEB_UI_PARTIAL = import.meta.env.VITE_USE_PI_WEB_UI_PARTIAL === 'true'
