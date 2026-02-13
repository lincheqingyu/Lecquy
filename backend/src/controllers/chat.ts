/**
 * 对话路由
 * 通过请求体 stream 参数控制同步/流式响应
 * 直接使用 LangChain ChatOpenAI 客户端
 */

import { Router, type Router as RouterType } from 'express'
import { z } from 'zod'
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import { getLLM } from '../core/llm/client.js'
import { initSSE, sendSSEEvent } from '../utils/stream.js'
import { createHttpError } from '../middlewares/error-handler.js'
import { logger } from '../utils/logger.js'

const router: RouterType = Router()

/** 请求体校验 Schema */
const chatRequestSchema = z.object({
  messages: z.array(
    z.object({
      role: z.enum(['system', 'user', 'assistant']),
      content: z.string().min(1, '消息内容不能为空'),
    }),
  ).min(1, '至少需要一条消息'),
  provider: z.string().optional(),
  stream: z.boolean().optional(),
  options: z
    .object({
      model: z.string().optional(),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().min(1).optional(),
    })
    .optional(),
})

/** 将前端消息转换为 LangChain 消息对象 */
function toLangChainMessages(messages: readonly { role: string; content: string }[]) {
  return messages.map((m) => {
    switch (m.role) {
      case 'system': return new SystemMessage(m.content)
      case 'assistant': return new AIMessage(m.content)
      default: return new HumanMessage(m.content)
    }
  })
}

/** POST /api/chat - 对话（同步或流式） */
router.post('/chat', async (req, res, next) => {
  try {
    const parsed = chatRequestSchema.safeParse(req.body)
    if (!parsed.success) {
      throw createHttpError(400, parsed.error.issues.map((i) => i.message).join('; '))
    }

    const lcMessages = toLangChainMessages(parsed.data.messages)

    const baseLLM = getLLM()
    const opts = parsed.data.options
    // 有前端 options 覆盖时，基于单例配置创建新实例
    const llm = opts
      ? new ChatOpenAI({
          ...baseLLM,
          ...(opts.model && { model: opts.model }),
          ...(opts.temperature !== undefined && { temperature: opts.temperature }),
          ...(opts.maxTokens !== undefined && { maxTokens: opts.maxTokens }),
        })
      : baseLLM

    if (parsed.data.stream) {
      initSSE(res)
      const stream = await llm.stream(lcMessages)
      for await (const chunk of stream) {
        const text = typeof chunk.content === 'string' ? chunk.content : ''
        if (text) {
          sendSSEEvent(res, 'message', { content: text })
        }
      }
      sendSSEEvent(res, 'done', { done: true })
      res.end()
    } else {
      const result = await llm.invoke(lcMessages)

      res.json({
        success: true,
        data: {
          content: result.content,
          model: result.response_metadata?.model ?? '',
          provider: 'openai-compatible',
          usage: result.usage_metadata ? {
            promptTokens: result.usage_metadata.input_tokens,
            completionTokens: result.usage_metadata.output_tokens,
            totalTokens: result.usage_metadata.total_tokens,
          } : undefined,
        },
      })
    }
  } catch (error) {
    if (res.headersSent) {
      logger.error('流式响应过程中出错:', error)
      res.end()
    } else {
      next(error)
    }
  }
})

export { router as chatRouter }
