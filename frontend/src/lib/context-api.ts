// 中文：本文件（context-api.ts）位于 frontend/src/lib/context-api.ts，属于frontend链路中的前端共享库代码，连接上游调用方与下游执行逻辑。
// English: This file (context-api.ts) belongs to the frontend 前端共享库 layer in frontend/src/lib/context-api.ts, wiring upstream callers with downstream runtime logic.

import { API_V1 } from '../config/api'

export type ContextFileName =
  | 'SOUL.md'
  | 'IDENTITY.md'
  | 'USER.md'
  | 'MEMORY.md'
  | 'AGENTS.md'
  | 'TOOLS.md'

export interface ContextFileRecord {
  name: ContextFileName
  path: string
  description: string
  editable: boolean
  content: string
}

export interface MemoryRuntimeConfig {
  flushTurns: number
  embeddingBaseUrl: string
}

export interface MemoryFileMeta {
  name: string
  size: number
  updatedAt: string
}

interface ApiEnvelope<T> {
  success: boolean
  data: T
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return payload
}

export async function fetchContextFiles(): Promise<ContextFileRecord[]> {
  const response = await fetch(`${API_V1}/context/files`)
  const payload = await readJson<ApiEnvelope<{ files: ContextFileRecord[] }>>(response)
  return payload.data.files
}

export async function updateContextFile(name: Extract<ContextFileName, 'SOUL.md' | 'IDENTITY.md' | 'USER.md' | 'MEMORY.md'>, content: string): Promise<ContextFileRecord> {
  const response = await fetch(`${API_V1}/context/files/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  })
  const payload = await readJson<ApiEnvelope<{ file: ContextFileRecord }>>(response)
  return payload.data.file
}

export async function fetchMemoryRuntimeConfig(): Promise<MemoryRuntimeConfig> {
  const response = await fetch(`${API_V1}/memory/config`)
  const payload = await readJson<ApiEnvelope<MemoryRuntimeConfig>>(response)
  return payload.data
}

export async function saveMemoryRuntimeConfig(config: Partial<MemoryRuntimeConfig>): Promise<MemoryRuntimeConfig> {
  const response = await fetch(`${API_V1}/memory/config`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(config),
  })
  const payload = await readJson<ApiEnvelope<MemoryRuntimeConfig>>(response)
  return payload.data
}

export async function fetchMemoryFiles(): Promise<MemoryFileMeta[]> {
  const response = await fetch(`${API_V1}/memory/files`)
  const payload = await readJson<ApiEnvelope<{ files: MemoryFileMeta[] }>>(response)
  return payload.data.files
}

export async function fetchMemoryFileContent(name: string): Promise<string> {
  const response = await fetch(`${API_V1}/memory/file?name=${encodeURIComponent(name)}`)
  const payload = await readJson<ApiEnvelope<{ name: string; content: string }>>(response)
  return payload.data.content
}
