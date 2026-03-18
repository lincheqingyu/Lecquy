/**
 * API 请求/响应类型定义
 */

import { z } from 'zod'

/** 错误响应体 */
export interface ErrorResponse {
  readonly success: false
  readonly error: string
  readonly code?: string
}

/** API 统一响应类型 */
export type ApiResponse<T = unknown> =
  | { readonly success: true; readonly data: T }
  | ErrorResponse

/** 健康检查响应 */
export interface HealthResponse {
  readonly status: 'ok'
  readonly timestamp: string
}

export const sessionRouteSchema = z.object({
  route: z.object({
    channel: z.enum(['webchat', 'internal', 'telegram', 'discord', 'whatsapp', 'unknown']),
    chatType: z.enum(['dm', 'group', 'channel', 'thread']),
    peerId: z.string().optional(),
    groupId: z.string().optional(),
    channelId: z.string().optional(),
    threadId: z.string().optional(),
    accountId: z.string().optional(),
    senderName: z.string().optional(),
    conversationLabel: z.string().optional(),
  }),
})

export const modelOptionsSchema = z.object({
  model: z.string().optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  enableTools: z.boolean().default(false),
  thinking: z.object({
    enabled: z.boolean().default(false),
    level: z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']).default('medium'),
    protocol: z.enum(['off', 'qwen', 'zai', 'openai_reasoning']).default('off'),
  }).optional(),
  systemPrompt: z.string().optional(),
  options: z
      .object({
        temperature: z.number().min(0).max(2).optional(),
        maxTokens: z.number().int().min(1).optional(),
      })
      .optional(),
})

export const runStartSchema = sessionRouteSchema.extend({
  route: sessionRouteSchema.shape.route,
  input: z.string().min(1, '消息内容不能为空'),
  mode: z.enum(['simple', 'plan']).default('simple'),
  sessionKey: z.string().optional(),
}).merge(modelOptionsSchema)

export const runResumeSchema = z.object({
  sessionKey: z.string().min(1, 'sessionKey 不能为空'),
  runId: z.string().min(1, 'runId 不能为空'),
  pauseId: z.string().min(1, 'pauseId 不能为空'),
  input: z.string().min(1, '消息内容不能为空'),
}).merge(modelOptionsSchema)

export const runCancelSchema = z.object({
  sessionKey: z.string().min(1, 'sessionKey 不能为空'),
  runId: z.string().optional(),
})
