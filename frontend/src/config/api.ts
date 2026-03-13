/**
 * API 地址配置
 * 优先使用 VITE_ 环境变量，否则从 PORT 自动派生（见 vite.config.ts）
 */

declare const __API_BASE__: string
declare const __WS_BASE__: string

export const API_BASE = __API_BASE__
export const WS_BASE = __WS_BASE__
export const API_V1 = `${API_BASE}/api/v1`
export const USE_PI_WEB_UI_PARTIAL = import.meta.env.VITE_USE_PI_WEB_UI_PARTIAL === 'true'
