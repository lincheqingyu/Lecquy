export interface ModelPresetItem {
  id: string
  model: string
  baseUrl: string
  apiKey: string
  title?: string
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
  const modelLabel = item.model?.trim()
  if (modelLabel) return modelLabel
  const legacyTitle = item.title?.trim()
  if (legacyTitle) return legacyTitle
  return 'Untitled model'
}
