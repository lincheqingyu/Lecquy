// 中文：本文件（session-policy.ts）位于 backend/src/session-v2/session-policy.ts，属于backend链路中的会话服务代码，连接上游调用方与下游执行逻辑。
// English: This file (session-policy.ts) belongs to the backend 会话服务 layer in backend/src/session-v2/session-policy.ts, wiring upstream callers with downstream runtime logic.

import type { Env } from '../config/index.js'
import type { SessionEntry } from '@lecquy/shared'

function getDailyBoundary(now: Date, atHour: number): number {
  const boundary = new Date(now)
  boundary.setHours(atHour, 0, 0, 0)
  if (now.getTime() < boundary.getTime()) {
    boundary.setDate(boundary.getDate() - 1)
  }
  return boundary.getTime()
}

export function shouldRotateSession(entry: SessionEntry, cfg: Env, nowTs = Date.now()): boolean {
  const now = new Date(nowTs)

  const byDaily = cfg.SESSION_RESET_MODE === 'daily'
    ? entry.updatedAt < getDailyBoundary(now, cfg.SESSION_RESET_AT_HOUR)
    : false

  const byIdle = nowTs - entry.updatedAt > cfg.SESSION_IDLE_MINUTES * 60 * 1000

  if (cfg.SESSION_RESET_MODE === 'daily') {
    return byDaily || byIdle
  }
  return byIdle
}
