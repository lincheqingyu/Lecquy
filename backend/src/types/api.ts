// 中文：本文件（api.ts）位于 backend/src/types/api.ts，属于backend链路中的backend 模块实现代码，连接上游调用方与下游执行逻辑。
// English: This file (api.ts) belongs to the backend backend 模块实现 layer in backend/src/types/api.ts, wiring upstream callers with downstream runtime logic.

/**
 * API 请求/响应类型定义
 */

import { z } from 'zod'

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MAX_FILE_TEXT_CHARS = 200_000
export const MAX_TOTAL_ATTACHMENT_BYTES = 8 * 1024 * 1024

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
    userTimezone: z.string().optional(),
  }),
})

export const modelOptionsSchema = z.object({
  model: z.string().optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  enableTools: z.boolean().default(false),
  headers: z.record(z.string()).optional(),
  cacheRetention: z.enum(['none', 'short', 'long']).optional(),
  sessionId: z.string().optional(),
  maxRetryDelayMs: z.number().int().min(0).optional(),
  metadata: z.record(z.unknown()).optional(),
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

const attachmentSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('image'),
    name: z.string().min(1),
    mimeType: z.string().min(1),
    data: z.string().min(1),
    size: z.number().int().nonnegative().optional(),
  }),
  z.object({
    kind: z.literal('file'),
    name: z.string().min(1),
    mimeType: z.string().min(1),
    text: z.string(),
    displayText: z.string().optional(),
    size: z.number().int().nonnegative().optional(),
    truncated: z.boolean().optional(),
  }),
])

const attachmentsSchema = z.array(attachmentSchema).superRefine((attachments, ctx) => {
  let totalBytes = 0

  attachments.forEach((attachment, index) => {
    if (attachment.kind === 'image') {
      totalBytes += attachment.data.length
      if (attachment.data.length > MAX_IMAGE_BYTES) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `图片附件 ${attachment.name} 超过上限：上限 ${MAX_IMAGE_BYTES}B，实际 ${attachment.data.length}B`,
          path: [index, 'data'],
          params: { code: 'ATTACHMENT_TOO_LARGE' },
        })
      }
      return
    }

    totalBytes += attachment.text.length
    if (attachment.text.length > MAX_FILE_TEXT_CHARS) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `文件附件 ${attachment.name} 超过上限：上限 ${MAX_FILE_TEXT_CHARS} 字符，实际 ${attachment.text.length} 字符`,
        path: [index, 'text'],
        params: { code: 'ATTACHMENT_TOO_LARGE' },
      })
    }
  })

  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `附件总大小超过上限：上限 ${MAX_TOTAL_ATTACHMENT_BYTES}B，实际 ${totalBytes}B`,
      path: [],
      params: { code: 'ATTACHMENT_TOO_LARGE' },
    })
  }
})

export const runStartSchema = sessionRouteSchema.extend({
  route: sessionRouteSchema.shape.route,
  input: z.string(),
  attachments: attachmentsSchema.optional(),
  mode: z.enum(['simple', 'plan']).default('simple'),
  sessionKey: z.string().optional(),
}).merge(modelOptionsSchema).refine(
  (value) => value.input.trim().length > 0 || (value.attachments?.length ?? 0) > 0,
  { message: '消息内容或附件至少提供一项' },
)

export const runResumeSchema = z.object({
  sessionKey: z.string().min(1, 'sessionKey 不能为空'),
  runId: z.string().min(1, 'runId 不能为空'),
  pauseId: z.string().min(1, 'pauseId 不能为空'),
  input: z.string(),
  attachments: attachmentsSchema.optional(),
}).merge(modelOptionsSchema).refine(
  (value) => value.input.trim().length > 0 || (value.attachments?.length ?? 0) > 0,
  { message: '消息内容或附件至少提供一项' },
)

export const runCancelSchema = z.object({
  sessionKey: z.string().min(1, 'sessionKey 不能为空'),
  runId: z.string().optional(),
})
