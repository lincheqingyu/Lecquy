/**
 * 会话注册表
 * 管理所有活跃会话的生命周期：创建、恢复、持久化、GC
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { SessionId, SessionSnapshot } from '@webclaw/shared'
import { createSessionState, restoreSessionState, serializeSessionState } from './session-state.js'
import type { SessionState } from './session-state.js'
import { logger } from '../utils/logger.js'
import { resolveRuntimePaths } from '../core/runtime-paths.js'

/** 会话文件存储目录 */
const SESSIONS_DIR = join(resolveRuntimePaths().runtimeRootDir, 'sessions', 'legacy-registry')

/** GC 间隔：5 分钟扫描一次 */
const GC_INTERVAL = 5 * 60 * 1000

/** 会话过期时间：30 分钟无活动 */
const SESSION_TTL = 30 * 60 * 1000

/** 持久化防抖间隔：1 秒 */
const PERSIST_DEBOUNCE = 1000

export class SessionRegistry {
  private readonly sessions = new Map<string, SessionState>()
  private gcTimer: ReturnType<typeof setInterval> | null = null
  private readonly pendingPersist = new Map<string, ReturnType<typeof setTimeout>>()

  /** 获取或创建会话 */
  getOrCreate(sessionId: SessionId): SessionState {
    const existing = this.sessions.get(sessionId)
    if (existing) {
      existing.lastActiveAt = Date.now()
      return existing
    }

    const state = createSessionState(sessionId)
    this.sessions.set(sessionId, state)
    return state
  }

  /** 获取已有会话 */
  get(sessionId: SessionId): SessionState | null {
    return this.sessions.get(sessionId) ?? null
  }

  /** 设置会话状态（用于 getOrCreate 后的更新） */
  set(sessionId: SessionId, state: SessionState): void {
    this.sessions.set(sessionId, state)
  }

  /** 从磁盘恢复会话 */
  async restore(sessionId: SessionId): Promise<SessionState | null> {
    const cached = this.sessions.get(sessionId)
    if (cached) return cached

    const filePath = join(SESSIONS_DIR, `${sessionId}.json`)
    try {
      const raw = await readFile(filePath, 'utf-8')
      const snapshot: SessionSnapshot = JSON.parse(raw)
      const state = restoreSessionState(snapshot)
      this.sessions.set(sessionId, state)
      logger.info(`会话已恢复: ${sessionId}`)
      return state
    } catch {
      return null
    }
  }

  /** 持久化会话到磁盘（带防抖） */
  persist(sessionId: SessionId): void {
    const existing = this.pendingPersist.get(sessionId)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      this.pendingPersist.delete(sessionId)
      void this.doPersist(sessionId)
    }, PERSIST_DEBOUNCE)
    this.pendingPersist.set(sessionId, timer)
  }

  /** 立即持久化（原子写入） */
  private async doPersist(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId)
    if (!state) return

    try {
      await mkdir(SESSIONS_DIR, { recursive: true })
      const snapshot = serializeSessionState(state)
      const filePath = join(SESSIONS_DIR, `${sessionId}.json`)
      const tmpPath = `${filePath}.tmp`

      await writeFile(tmpPath, JSON.stringify(snapshot, null, 2), 'utf-8')
      await rename(tmpPath, filePath)
    } catch (error) {
      logger.error(`持久化会话失败 [${sessionId}]:`, error)
    }
  }

  /** 更新会话活跃时间 */
  touch(sessionId: SessionId): void {
    const state = this.sessions.get(sessionId)
    if (state) {
      state.lastActiveAt = Date.now()
    }
  }

  /** 移除会话（内存 + 磁盘） */
  async remove(sessionId: SessionId): Promise<void> {
    this.sessions.delete(sessionId)
    const filePath = join(SESSIONS_DIR, `${sessionId}.json`)
    try {
      if (existsSync(filePath)) {
        await unlink(filePath)
      }
    } catch {
      // 文件不存在或删除失败，忽略
    }
  }

  /** 启动 GC 定时器 */
  startGc(): void {
    if (this.gcTimer) return
    this.gcTimer = setInterval(() => {
      void this.runGc()
    }, GC_INTERVAL)
    logger.info('会话 GC 已启动')
  }

  /** 停止 GC 定时器 */
  stopGc(): void {
    if (this.gcTimer) {
      clearInterval(this.gcTimer)
      this.gcTimer = null
    }
  }

  /** 执行 GC：清理过期会话 */
  private async runGc(): Promise<void> {
    const now = Date.now()
    const expired: string[] = []

    for (const [id, state] of this.sessions) {
      // 运行中的会话不清理
      if (state.isRunning) continue
      if (now - state.lastActiveAt > SESSION_TTL) {
        expired.push(id)
      }
    }

    for (const id of expired) {
      // 清理前先持久化
      await this.doPersist(id)
      this.sessions.delete(id)
      logger.info(`会话已过期清理: ${id}`)
    }

    if (expired.length > 0) {
      logger.info(`GC 清理了 ${expired.length} 个过期会话，剩余 ${this.sessions.size} 个`)
    }
  }

  /** 优雅关闭：持久化所有会话 */
  async shutdown(): Promise<void> {
    this.stopGc()

    // 清除所有防抖定时器
    for (const timer of this.pendingPersist.values()) {
      clearTimeout(timer)
    }
    this.pendingPersist.clear()

    // 持久化所有活跃会话
    const tasks = Array.from(this.sessions.keys()).map((id) => this.doPersist(id))
    await Promise.all(tasks)
    logger.info(`已持久化 ${tasks.length} 个会话`)
  }

  /** 获取活跃会话数（调试用） */
  get size(): number {
    return this.sessions.size
  }
}

/** 创建会话注册表单例 */
export function createSessionRegistry(): SessionRegistry {
  return new SessionRegistry()
}
