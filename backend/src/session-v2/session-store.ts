import { existsSync } from 'node:fs'
import { appendFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { SessionEntry, SessionSnapshot } from '@webclaw/shared'
import type { SessionStoreShape } from './types.js'

export class SessionStore {
  private readonly root: string
  private readonly indexFile: string
  private readonly snapshotsDir: string
  private readonly transcriptDir: string

  constructor(rootDir: string) {
    this.root = rootDir
    this.indexFile = join(this.root, 'sessions.json')
    this.snapshotsDir = join(this.root, 'snapshots')
    this.transcriptDir = join(this.root, 'transcripts')
  }

  async init(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    await mkdir(this.snapshotsDir, { recursive: true })
    await mkdir(this.transcriptDir, { recursive: true })
    if (!existsSync(this.indexFile)) {
      await this.writeJsonAtomic(this.indexFile, { entries: {} } satisfies SessionStoreShape)
    }
  }

  private async writeJsonAtomic(path: string, value: unknown): Promise<void> {
    const tmpPath = `${path}.tmp`
    await writeFile(tmpPath, JSON.stringify(value, null, 2), 'utf-8')
    await rename(tmpPath, path)
  }

  private async readJsonOrRecover<T>(path: string, fallback: T): Promise<T> {
    try {
      const raw = await readFile(path, 'utf-8')
      const trimmed = raw.trim()
      if (!trimmed) {
        await this.writeJsonAtomic(path, fallback)
        return fallback
      }
      return JSON.parse(trimmed) as T
    } catch {
      if (existsSync(path)) {
        const backupPath = `${path}.corrupt.${Date.now()}`
        await rename(path, backupPath).catch(() => undefined)
      }
      await this.writeJsonAtomic(path, fallback)
      return fallback
    }
  }

  async loadIndex(): Promise<Record<string, SessionEntry>> {
    const parsed = await this.readJsonOrRecover(this.indexFile, { entries: {} } satisfies SessionStoreShape)
    return parsed.entries ?? {}
  }

  async saveIndex(entries: Record<string, SessionEntry>): Promise<void> {
    await this.writeJsonAtomic(this.indexFile, { entries })
  }

  async saveSnapshot(sessionId: string, snapshot: SessionSnapshot): Promise<void> {
    const path = join(this.snapshotsDir, `${sessionId}.json`)
    await this.writeJsonAtomic(path, snapshot)
  }

  async loadSnapshot(sessionId: string): Promise<SessionSnapshot | null> {
    const path = join(this.snapshotsDir, `${sessionId}.json`)
    if (!existsSync(path)) return null
    try {
      return await this.readJsonOrRecover<SessionSnapshot | null>(path, null)
    } catch {
      return null
    }
  }

  transcriptPath(sessionId: string): string {
    return join(this.transcriptDir, `${sessionId}.jsonl`)
  }

  async appendTranscript(sessionId: string, messages: AgentMessage[]): Promise<void> {
    if (messages.length === 0) return
    const path = this.transcriptPath(sessionId)
    const lines = messages.map((m) => JSON.stringify({
      role: m.role,
      content: m.content,
      timestamp: m.timestamp ?? Date.now(),
    }))
    await appendFile(path, `${lines.join('\n')}\n`, 'utf-8')
  }

  async readTranscript(sessionId: string, limit = 50): Promise<Array<{ role: string; content: unknown; timestamp?: number }>> {
    const path = this.transcriptPath(sessionId)
    if (!existsSync(path)) return []
    const raw = await readFile(path, 'utf-8')
    const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
    return lines.slice(-Math.max(1, limit)).map((line) => {
      try {
        return JSON.parse(line) as { role: string; content: unknown; timestamp?: number }
      } catch {
        return { role: 'other', content: line }
      }
    })
  }

  async deleteSnapshot(sessionId: string): Promise<void> {
    const path = join(this.snapshotsDir, `${sessionId}.json`)
    await rm(path, { force: true })
  }

  async deleteTranscript(sessionId: string): Promise<void> {
    const path = this.transcriptPath(sessionId)
    await rm(path, { force: true })
  }
}
