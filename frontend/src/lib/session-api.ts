import { API_V1 } from '../config/api'
import type { SessionListEntry, SessionMessageRecord } from './session-management'

interface ApiEnvelope<T> {
  success: boolean
  data: T
}

interface SessionListResponse {
  sessions: SessionListEntry[]
}

interface SessionHistoryResponse {
  sessionKey: string
  messages: SessionMessageRecord[]
}

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json() as T
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }
  return payload
}

export async function fetchSessions(limit = 50, messageLimit = 10): Promise<SessionListEntry[]> {
  const response = await fetch(`${API_V1}/sessions?limit=${limit}&messageLimit=${messageLimit}`)
  const payload = await readJson<ApiEnvelope<SessionListResponse>>(response)
  return payload.data.sessions
}

export async function fetchSessionHistory(sessionKey: string, limit = 100): Promise<SessionMessageRecord[]> {
  const encodedKey = encodeURIComponent(sessionKey)
  const response = await fetch(`${API_V1}/sessions/${encodedKey}/history?limit=${limit}&includeTools=false`)
  const payload = await readJson<ApiEnvelope<SessionHistoryResponse>>(response)
  return payload.data.messages
}

export async function deleteSession(sessionKey: string): Promise<void> {
  const encodedKey = encodeURIComponent(sessionKey)
  const response = await fetch(`${API_V1}/sessions/${encodedKey}`, { method: 'DELETE' })
  await readJson<ApiEnvelope<{ deleted: boolean; sessionKey: string }>>(response)
}
