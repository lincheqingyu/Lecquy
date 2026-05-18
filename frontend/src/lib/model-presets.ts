// 中文：本文件（model-presets.ts）位于 frontend/src/lib/model-presets.ts，属于frontend链路中的前端共享库代码，连接上游调用方与下游执行逻辑。
// English: This file (model-presets.ts) belongs to the frontend 前端共享库 layer in frontend/src/lib/model-presets.ts, wiring upstream callers with downstream runtime logic.

import type { ThinkingConfig } from '@lecquy/shared'

export interface ModelPresetItem {
  id: string
  model: string
  baseUrl: string
  apiKey: string
  title?: string
  temperature?: number
  maxTokens?: number
  enableTools?: boolean
  thinking?: ThinkingConfig
  headers?: Record<string, string>
  cacheRetention?: 'none' | 'short' | 'long'
  sessionId?: string
  maxRetryDelayMs?: number
  metadata?: Record<string, unknown>
  roleContextFiles?: string[]
}

export const MODEL_PRESET_STORAGE_KEY = 'lecquy.modelPresets'
export const ACTIVE_MODEL_PRESET_STORAGE_KEY = 'lecquy.activeModelPresetId'
export const NEW_MODEL_PRESET_VALUE = '__new_model__'

export function loadModelPresetsFromStorage(): ModelPresetItem[] {
  try {
    const raw = localStorage.getItem(MODEL_PRESET_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function loadActiveModelPresetIdFromStorage(): string | null {
  try {
    return localStorage.getItem(ACTIVE_MODEL_PRESET_STORAGE_KEY)
  } catch {
    return null
  }
}

export function getModelPresetLabel(item: ModelPresetItem | null | undefined): string {
  if (!item) return ''
  const legacyTitle = item.title?.trim()
  if (legacyTitle) return legacyTitle
  const modelLabel = item.model?.trim()
  if (modelLabel) return modelLabel
  return 'Untitled model'
}

export function getModelPresetModelLabel(item: ModelPresetItem | null | undefined): string {
  if (!item) return ''
  const modelLabel = item.model?.trim()
  if (modelLabel) return modelLabel
  return 'No model configured'
}
