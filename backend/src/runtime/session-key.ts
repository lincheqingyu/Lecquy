import type { SessionChannel, SessionKind, SessionRouteContext } from '@webclaw/shared'

function sanitize(value: string | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

export interface SessionBinding {
  readonly key: string
  readonly kind: SessionKind
  readonly channel: SessionChannel
}

export function resolveSessionKey(route: SessionRouteContext, agentId: string, mainKey: string): SessionBinding {
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
