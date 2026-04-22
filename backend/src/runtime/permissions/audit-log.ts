/**
 * 权限决策审计日志
 *
 * 参考 Claude Code `utils/permissions/denialTracking.ts`，但扩展为记录所有决策
 * （不只是 deny），并支持两种后端：
 *
 *   1. InMemoryAuditSink   仅保留在内存中（默认，性能零开销）
 *   2. JsonFileAuditSink   逐行追加 JSON（JSON Lines）到磁盘文件
 *
 * 两者都实现 `AuditSink` 接口，上层 checker 只负责调用 `sink.write(record)`。
 */

import fsp from 'node:fs/promises'
import path from 'node:path'

import type { PermissionAuditRecord } from './types.js'

/**
 * 审计后端接口。
 */
export interface AuditSink {
  /** 写入一条决策记录。 */
  write(record: PermissionAuditRecord): Promise<void>
  /** 读取最近 N 条（可选，供 UI 使用）。 */
  recent?(limit: number): Promise<PermissionAuditRecord[]>
  /** 关闭后端，释放资源。 */
  close?(): Promise<void>
}

/**
 * 内存环形缓冲区审计后端。
 * 适合单元测试和轻量场景；默认保留最近 1000 条。
 */
export class InMemoryAuditSink implements AuditSink {
  private buffer: PermissionAuditRecord[] = []
  private readonly capacity: number

  constructor(capacity = 1000) {
    this.capacity = Math.max(1, capacity)
  }

  async write(record: PermissionAuditRecord): Promise<void> {
    this.buffer.push(record)
    if (this.buffer.length > this.capacity) {
      this.buffer.splice(0, this.buffer.length - this.capacity)
    }
  }

  async recent(limit: number): Promise<PermissionAuditRecord[]> {
    const safeLimit = Math.max(0, Math.min(limit, this.buffer.length))
    return this.buffer.slice(-safeLimit)
  }

  snapshot(): PermissionAuditRecord[] {
    return [...this.buffer]
  }

  async close(): Promise<void> {
    this.buffer = []
  }
}

/**
 * 磁盘文件审计后端（JSON Lines 格式）。
 *
 * 文件位置约定：`<workspaceDir>/.lecquy/permissions-audit.jsonl`
 * 每行一条独立 JSON，方便 `jq` / `grep` 直接过滤。
 */
export class JsonFileAuditSink implements AuditSink {
  private readonly filePath: string
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(filePath: string) {
    this.filePath = filePath
  }

  static forWorkspace(workspaceDir: string): JsonFileAuditSink {
    return new JsonFileAuditSink(
      path.join(workspaceDir, '.lecquy', 'permissions-audit.jsonl'),
    )
  }

  async write(record: PermissionAuditRecord): Promise<void> {
    // 简单串行化，避免并发 write 错乱
    this.writeQueue = this.writeQueue.then(async () => {
      await fsp.mkdir(path.dirname(this.filePath), { recursive: true })
      const line = `${JSON.stringify(record)}\n`
      await fsp.appendFile(this.filePath, line, 'utf-8')
    })
    return this.writeQueue
  }

  async recent(limit: number): Promise<PermissionAuditRecord[]> {
    try {
      const content = await fsp.readFile(this.filePath, 'utf-8')
      const lines = content.split('\n').filter((l) => l.trim().length > 0)
      const tail = lines.slice(-Math.max(0, limit))
      return tail
        .map((line) => {
          try {
            return JSON.parse(line) as PermissionAuditRecord
          } catch {
            return null
          }
        })
        .filter((v): v is PermissionAuditRecord => v !== null)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  async close(): Promise<void> {
    await this.writeQueue
  }
}

/**
 * 复合审计后端：同时写多个 sink。
 * 一般用于"内存 + 磁盘"双写（内存即时查询，磁盘用于故障分析）。
 */
export class CompositeAuditSink implements AuditSink {
  private readonly sinks: AuditSink[]

  constructor(sinks: AuditSink[]) {
    this.sinks = sinks
  }

  async write(record: PermissionAuditRecord): Promise<void> {
    await Promise.all(this.sinks.map((sink) => sink.write(record)))
  }

  async recent(limit: number): Promise<PermissionAuditRecord[]> {
    // 取第一个支持 recent 的 sink 的结果
    for (const sink of this.sinks) {
      if (sink.recent) return sink.recent(limit)
    }
    return []
  }

  async close(): Promise<void> {
    await Promise.all(this.sinks.map((sink) => sink.close?.()))
  }
}

/**
 * 空审计后端：什么都不做。
 * 用于显式关闭审计，而不修改调用方代码。
 */
export class NullAuditSink implements AuditSink {
  async write(_record: PermissionAuditRecord): Promise<void> {
    /* no-op */
    void _record
  }
  async recent(_limit: number): Promise<PermissionAuditRecord[]> {
    void _limit
    return []
  }
}
