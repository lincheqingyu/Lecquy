/**
 * 前端会话身份（peerId）管理
 * 说明：
 * - 后端 Session V2 由 route 解析会话键，不再依赖 URL sessionId。
 * - 前端持久化一个稳定的 peerId，用于 dm 场景的 route.peerId。
 */

const PEER_ID_KEY = 'webclaw.peerId'
const LEGACY_SESSION_ID_KEY = 'webclaw.sessionId'

let memoryPeerId: string | null = null

function generatePeerId(): string {
  return `peer_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function getPeerId(): string {
  try {
    const existing = localStorage.getItem(PEER_ID_KEY)
    if (existing) return existing

    // 一次性迁移旧键
    const legacy = localStorage.getItem(LEGACY_SESSION_ID_KEY)
    if (legacy) {
      localStorage.setItem(PEER_ID_KEY, legacy)
      return legacy
    }

    const id = generatePeerId()
    localStorage.setItem(PEER_ID_KEY, id)
    return id
  } catch {
    if (memoryPeerId) return memoryPeerId
    memoryPeerId = generatePeerId()
    return memoryPeerId
  }
}

export function resetPeerId(): string {
  const id = generatePeerId()
  setPeerId(id)
  return id
}

export function setPeerId(id: string): string {
  try {
    localStorage.setItem(PEER_ID_KEY, id)
  } catch {
    memoryPeerId = id
  }
  return id
}

// 兼容旧调用方（后续可移除）
export function getSessionId(): string {
  return getPeerId()
}

export function resetSessionId(): string {
  return resetPeerId()
}
