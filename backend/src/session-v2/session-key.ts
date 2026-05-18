// 中文：本文件（session-key.ts）位于 backend/src/session-v2/session-key.ts，属于backend链路中的会话服务代码，连接上游调用方与下游执行逻辑。
// English: This file (session-key.ts) belongs to the backend 会话服务 layer in backend/src/session-v2/session-key.ts, wiring upstream callers with downstream runtime logic.

import type { SessionRouteEnvelope, SessionKeyResolved } from './types.js'

function sanitize(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export function resolveSessionKey(route: SessionRouteEnvelope, agentId: string, mainKey: string): SessionKeyResolved {
  const channel = route.channel ?? 'unknown'
  const accountId = sanitize(route.accountId) ?? 'default'

  if (route.chatType === 'dm') {
    const peer = sanitize(route.peerId)
    if (!peer) {
      throw new Error('dm 会话缺少 peerId')
    }
    if (peer === mainKey) {
      return {
        key: `agent:${agentId}:${mainKey}`,
        kind: 'main',
        channel,
      }
    }
    return {
      key: `agent:${agentId}:${channel}:${accountId}:dm:${peer}`,
      kind: 'main',
      channel,
    }
  }

  if (route.chatType === 'group') {
    const groupId = sanitize(route.groupId)
    if (!groupId) throw new Error('group 会话缺少 groupId')
    return {
      key: `agent:${agentId}:${channel}:group:${groupId}`,
      kind: 'group',
      channel,
    }
  }

  if (route.chatType === 'channel') {
    const channelId = sanitize(route.channelId)
    if (!channelId) throw new Error('channel 会话缺少 channelId')
    return {
      key: `agent:${agentId}:${channel}:channel:${channelId}`,
      kind: 'channel',
      channel,
    }
  }

  const threadId = sanitize(route.threadId)
  const groupId = sanitize(route.groupId) ?? sanitize(route.channelId)
  if (!threadId || !groupId) {
    throw new Error('thread 会话缺少 threadId/groupId')
  }
  return {
    key: `agent:${agentId}:${channel}:group:${groupId}:topic:${threadId}`,
    kind: 'thread',
    channel,
  }
}
