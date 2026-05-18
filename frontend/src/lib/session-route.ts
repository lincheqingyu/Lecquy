// 中文：本文件（session-route.ts）位于 frontend/src/lib/session-route.ts，属于frontend链路中的前端共享库代码，连接上游调用方与下游执行逻辑。
// English: This file (session-route.ts) belongs to the frontend 前端共享库 layer in frontend/src/lib/session-route.ts, wiring upstream callers with downstream runtime logic.

import type { SessionRouteContext } from '@lecquy/shared'

interface BuildRouteOptions {
  peerId: string
  channel?: SessionRouteContext['channel']
  accountId?: string
}

export function buildDefaultRoute(options: BuildRouteOptions): SessionRouteContext {
  return {
    channel: options.channel ?? 'webchat',
    chatType: 'dm',
    peerId: options.peerId,
    accountId: options.accountId ?? 'default',
    userTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}
