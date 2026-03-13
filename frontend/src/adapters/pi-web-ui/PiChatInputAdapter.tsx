import { ChatInput } from '../../components/ui/ChatInput'
import type { ChatMode } from '../../hooks/useChat'
import type { ReactNode } from 'react'

interface PiChatInputAdapterProps {
  mode: ChatMode
  onModeChange: (mode: ChatMode) => void
  onSend: (message: string) => void
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
