import { MessageList } from '../../components/chat/MessageList'
import type { ChatMessage } from '../../hooks/useChat'

interface PiMessageListAdapterProps {
  messages: ChatMessage[]
  isStreaming: boolean
  isWaiting: boolean
  onResendUser?: (message: string) => void
  scrollRequestVersion?: number
}

/**
 * pi-web-ui 局部复用适配入口（占位实现）
 *
 * 当前保持原有 UI 样式不变，先复用同一数据契约。
 * 后续若接入 @mariozechner/pi-web-ui，可在此处替换为 message-list web component。
 */
export function PiMessageListAdapter(props: PiMessageListAdapterProps) {
  return <MessageList {...props} />
}
