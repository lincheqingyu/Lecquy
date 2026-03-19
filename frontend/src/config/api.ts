/**
 * API 地址配置
 * 优先使用 VITE_ 环境变量，否则从 PORT 自动派生（见 vite.config.ts）
 */

declare const __API_BASE__: string
declare const __WS_BASE__: string
declare const __BACKEND_PORT__: string

function isAutoBase(value: string): boolean {
  return value === '' || value === 'auto'
}

function resolveApiBase(): string {
  if (!isAutoBase(__API_BASE__)) {
    return __API_BASE__
  }

  const protocol = window.location.protocol === 'https:' ? 'https:' : 'http:'
  return `${protocol}//${window.location.hostname}:${__BACKEND_PORT__}`
}

function resolveWsBase(): string {
  if (!isAutoBase(__WS_BASE__)) {
    return __WS_BASE__
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.hostname}:${__BACKEND_PORT__}`
}

export const API_BASE = resolveApiBase()
export const WS_BASE = resolveWsBase()
export const API_V1 = `${API_BASE}/api/v1`
export const USE_PI_WEB_UI_PARTIAL = import.meta.env.VITE_USE_PI_WEB_UI_PARTIAL === 'true'
