// 中文：本文件（session-api.ts）位于 frontend/src/lib/session-api.ts，属于frontend链路中的前端共享库代码，连接上游调用方与下游执行逻辑。
// English: This file (session-api.ts) belongs to the frontend 前端共享库 layer in frontend/src/lib/session-api.ts, wiring upstream callers with downstream runtime logic.

import { API_V1 } from '../config/api'
import type { ArtifactDetail, SessionEventEntry, SessionMessageRecord, SessionProjection } from '@lecquy/shared'

interface ApiEnvelope<T> {
  success: boolean
  data: T
}

interface SessionListResponse {
  sessions: SessionProjection[]
}

interface SessionHistoryResponse {
  sessionKey: string
  messages: SessionMessageRecord[]
}

interface SessionHistoryViewResponse {
  sessionKey: string
  projection: SessionProjection
  entries: SessionEventEntry[]
}

interface SessionUpdateResponse {
  session: SessionProjection
}

interface ArtifactDetailResponse {
  sessionKey: string
  artifact: ArtifactDetail
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return payload
}

export async function fetchSessions(limit = 50, messageLimit = 10): Promise<SessionProjection[]> {
  const response = await fetch(`${API_V1}/sessions?limit=${limit}&messageLimit=${messageLimit}`)
  const payload = await readJson<ApiEnvelope<SessionListResponse>>(response)
  return payload.data.sessions
}

export async function fetchSessionHistory(sessionKey: string, limit = 100): Promise<SessionMessageRecord[]> {
  const encodedKey = encodeURIComponent(sessionKey)
  const response = await fetch(`${API_V1}/sessions/${encodedKey}/history?limit=${limit}`)
  const payload = await readJson<ApiEnvelope<SessionHistoryResponse>>(response)
  return payload.data.messages
}

export async function fetchSessionHistoryView(sessionKey: string): Promise<SessionHistoryViewResponse> {
  const encodedKey = encodeURIComponent(sessionKey)
  const response = await fetch(`${API_V1}/sessions/${encodedKey}/history-view`)
  const payload = await readJson<ApiEnvelope<SessionHistoryViewResponse>>(response)
  return payload.data
}

export async function fetchArtifactDetail(sessionKey: string, artifactId: string): Promise<ArtifactDetail> {
  const encodedKey = encodeURIComponent(sessionKey)
  const encodedArtifactId = encodeURIComponent(artifactId)
  const response = await fetch(`${API_V1}/sessions/${encodedKey}/artifacts/${encodedArtifactId}`)
  const payload = await readJson<ApiEnvelope<ArtifactDetailResponse>>(response)
  return payload.data.artifact
}

export function buildArtifactDownloadUrl(sessionKey: string, artifactId: string): string {
  const encodedKey = encodeURIComponent(sessionKey)
  const encodedArtifactId = encodeURIComponent(artifactId)
  return `${API_V1}/sessions/${encodedKey}/artifacts/${encodedArtifactId}/download`
}

export async function deleteSession(sessionKey: string): Promise<void> {
  const encodedKey = encodeURIComponent(sessionKey)
  const response = await fetch(`${API_V1}/sessions/${encodedKey}`, { method: 'DELETE' })
  await readJson<ApiEnvelope<{ deleted: boolean; sessionKey: string }>>(response)
}

export async function updateSessionTitle(sessionKey: string, title: string): Promise<SessionProjection> {
  const encodedKey = encodeURIComponent(sessionKey)
  const response = await fetch(`${API_V1}/sessions/${encodedKey}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  })
  const payload = await readJson<ApiEnvelope<SessionUpdateResponse>>(response)
  return payload.data.session
}
