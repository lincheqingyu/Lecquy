// 中文：本文件（PiChatInputAdapter.tsx）位于 frontend/src/adapters/pi-web-ui/PiChatInputAdapter.tsx，属于frontend链路中的前端适配层代码，连接上游调用方与下游执行逻辑。
// English: This file (PiChatInputAdapter.tsx) belongs to the frontend 前端适配层 layer in frontend/src/adapters/pi-web-ui/PiChatInputAdapter.tsx, wiring upstream callers with downstream runtime logic.

import { ChatInput, type ChatInputSubmitPayload } from '../../components/ui/ChatInput'
import type { ChatMode, ModelConfig } from '../../hooks/useChat'
import type { ModelPresetItem } from '../../lib/model-presets'
import type { ReactNode } from 'react'

interface PiChatInputAdapterProps {
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
  onSend: (payload: ChatInputSubmitPayload) => void
  modelConfig: ModelConfig
  modelPresets: ModelPresetItem[]
  selectedModelPresetId: string
  onModelPresetSelect: (presetId: string) => void
  showSuggestions?: boolean
  disabled?: boolean
  disabledReason?: string | null
  rightSlot?: ReactNode
}

/**
 * pi-web-ui 局部复用适配入口（占位实现）
 *
 * 当前保持原有 UI 样式不变，后续可在适配层切换到 message-editor。
 */
export function PiChatInputAdapter(props: PiChatInputAdapterProps) {
  return <ChatInput {...props} />
}
