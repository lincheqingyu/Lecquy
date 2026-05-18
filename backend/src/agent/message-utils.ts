// 中文：本文件（message-utils.ts）位于 backend/src/agent/message-utils.ts，属于backend链路中的agent 编排与工具链代码，连接上游调用方与下游执行逻辑。
// English: This file (message-utils.ts) belongs to the backend agent 编排与工具链 layer in backend/src/agent/message-utils.ts, wiring upstream callers with downstream runtime logic.

/**
 * Agent 消息归一化工具
 */

import type { AgentMessage } from '@mariozechner/pi-agent-core'
import type { AssistantMessage, UserMessage } from '@mariozechner/pi-ai'

export const MAX_CONTEXT_MESSAGES = 40

export function normalizeIncomingMessages(
  messages: readonly { role: string; content: string }[],
  modelId: string,
): {
  promptMessages: AgentMessage[]
  contextMessages: AgentMessage[]
  extraSystemPrompt?: string
} {
  const systemChunks = messages
    .filter((m) => m.role === 'system')
    .map((m) => m.content.trim())
    .filter((text) => text.length > 0)

  const llmMessages = messages
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .slice(-MAX_CONTEXT_MESSAGES)
    .map((m): AgentMessage => {
      if (m.role === 'user') {
        const userMsg: UserMessage = {
          role: 'user',
          content: m.content,
          timestamp: Date.now(),
        }
        return userMsg
      }

      const assistantMsg: AssistantMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: m.content }],
        api: 'openai-completions',
        provider: 'openai',
        model: modelId,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: 'stop',
        timestamp: Date.now(),
      }
      return assistantMsg
    })

  const lastUserIndex = (() => {
    for (let i = llmMessages.length - 1; i >= 0; i -= 1) {
      if (llmMessages[i].role === 'user') return i
    }
    return -1
  })()

  const promptMessages = lastUserIndex >= 0 ? [llmMessages[lastUserIndex]] : []
  const contextMessages = lastUserIndex > 0 ? llmMessages.slice(0, lastUserIndex) : []

  return {
    promptMessages,
    contextMessages,
    extraSystemPrompt: systemChunks.length > 0 ? systemChunks.join('\n\n') : undefined,
  }
}
