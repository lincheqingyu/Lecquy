/**
 * 环境变量校验与类型化
 * 使用 zod 进行运行时校验，确保所有必需配置存在
 */

import { z } from 'zod'

/** 环境变量 Schema */
const envSchema = z.object({
  /** 服务端口 */
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),

  /** Node 环境 */
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  /** LLM API Key */
  LLM_API_KEY: z.string().min(1, 'LLM_API_KEY 未配置'),

  /** LLM Base URL（支持自定义端点） */
  LLM_BASE_URL: z.string().url().default('https://open.bigmodel.cn/api/paas/v4/'),

  /** LLM 默认模型 */
  LLM_MODEL: z.string().default('glm-4-plus'),

  /** LLM 温度 */
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),

  /** LLM 最大 token 数 */
  LLM_MAX_TOKENS: z.coerce.number().int().default(8192),

  /** LLM 请求超时（毫秒） */
  LLM_TIMEOUT: z.coerce.number().int().default(120000),

  /** 日志级别 */
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

/** 校验后的环境变量类型 */
export type Env = z.infer<typeof envSchema>

/**
 * 校验环境变量
 * 启动时调用，校验失败会抛出详细错误信息
 */
export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env)

  if (!result.success) {
    const formatted = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n')
    throw new Error(`环境变量校验失败:\n${formatted}`)
  }

  return result.data
}
