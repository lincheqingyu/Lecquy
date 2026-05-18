// 中文：本文件（PiMessageListAdapter.tsx）位于 frontend/src/adapters/pi-web-ui/PiMessageListAdapter.tsx，属于frontend链路中的前端适配层代码，连接上游调用方与下游执行逻辑。
// English: This file (PiMessageListAdapter.tsx) belongs to the frontend 前端适配层 layer in frontend/src/adapters/pi-web-ui/PiMessageListAdapter.tsx, wiring upstream callers with downstream runtime logic.

import type { ChatAttachment } from '@lecquy/shared'
import { MessageList } from '../../components/chat/MessageList'
import type { ChatMessage } from '../../hooks/useChat'
import type { ChatArtifact } from '../../lib/artifacts'

interface PiMessageListAdapterProps {
  messages: ChatMessage[]
  onResendUser?: (messageId: string) => void
  onEditUser?: (messageId: string, nextContent: string) => void
  onToggleThinking?: (messageId: string, groupKey?: string) => void
  onToggleTodo?: (messageId: string) => void
  onTogglePlanTask?: (messageId: string, todoIndex: number) => void
  onToggleToolCall?: (messageId: string, blockId: string) => void
  onToggleToolGroup?: (messageId: string, groupKey: string) => void
  onOpenAttachment?: (messageId: string, attachmentIndex: number, attachment: ChatAttachment) => void
  onOpenArtifact?: (messageId: string, artifactIndex: number, artifact: ChatArtifact) => void
  activeAttachmentKey?: string | null
  scrollRequestVersion?: number
  wideLayout?: boolean
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
