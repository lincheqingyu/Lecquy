/**
 * 环境变量校验与类型化
 * 使用 zod 进行运行时校验，确保所有必需配置存在
 */

import { z } from 'zod'

const portSchema = z.coerce.number().int().min(1).max(65535)

/** 环境变量 Schema */
const envSchema = z.object({
  /** 后端服务端口 */
  BACKEND_PORT: portSchema.optional(),
  /** 兼容旧配置 */
  PORT: portSchema.optional(),

  /** 服务监听地址 */
  HOST: z.string().min(1).default('0.0.0.0'),

  /** Node 环境 */
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  /** LLM API Key */
  LLM_API_KEY: z.string().min(1, 'LLM_API_KEY 未配置'),

  /** LLM Base URL（支持自定义端点） */
  LLM_BASE_URL: z.string().url().default('https://open.bigmodel.cn/api/paas/v4/'),

  /** LLM 默认模型 */
  LLM_MODEL: z.string().default('glm-4.7'),

  /** LLM 温度 */
  LLM_TEMPERATURE: z.coerce.number().min(0).max(2).default(0.7),

  /** LLM 最大 token 数 */
  LLM_MAX_TOKENS: z.coerce.number().int().default(8192),

  /** LLM 请求超时（毫秒） */
  LLM_TIMEOUT: z.coerce.number().int().default(120000),

  /** 日志级别 */
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  /** Session 主键 */
  SESSION_MAIN_KEY: z.string().default('main'),
  /** Session 重置模式 */
  SESSION_RESET_MODE: z.enum(['daily', 'idle']).default('daily'),
  /** Session 每日重置小时（本地时区） */
  SESSION_RESET_AT_HOUR: z.coerce.number().int().min(0).max(23).default(4),
  /** Session 空闲重置分钟 */
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).default(120),
  /** Session 存储目录 */
  SESSION_STORE_DIR: z.string().default('.ZxhClaw/sessions/v3'),
  /** 上下文修剪模式 */
  SESSION_PRUNING_MODE: z.enum(['off', 'cache-ttl']).default('cache-ttl'),
  /** 修剪 TTL */
  SESSION_PRUNING_TTL: z.string().default('5m'),
  /** 保留最后 N 条 assistant 消息 */
  SESSION_PRUNING_KEEP_LAST_ASSISTANTS: z.coerce.number().int().min(0).default(3),
  /** 软裁剪阈值（上下文窗口比例） */
  SESSION_PRUNING_SOFT_RATIO: z.coerce.number().min(0).max(1).default(0.3),
  /** 硬清除阈值（上下文窗口比例） */
  SESSION_PRUNING_HARD_RATIO: z.coerce.number().min(0).max(1).default(0.5),
  /** 可裁剪工具结果最小字符数 */
  SESSION_PRUNING_MIN_TOOL_CHARS: z.coerce.number().int().min(1).default(50000),

  /** 是否启用 PostgreSQL 底座 */
  PG_ENABLED: z.enum(['true', 'false']).default('false'),
  /** PostgreSQL 主机 */
  PG_HOST: z.string().default('localhost'),
  /** PostgreSQL 端口 */
  PG_PORT: portSchema.default(5432),
  /** PostgreSQL 数据库名 */
  PG_DATABASE: z.string().default('webclaw'),
  /** PostgreSQL 用户名 */
  PG_USER: z.string().default('postgres'),
  /** PostgreSQL 密码（可选） */
  PG_PASSWORD: z.string().optional(),
  /** 连接池最大连接数 */
  PG_POOL_MAX: z.coerce.number().int().min(1).default(10),
  /** SSL 模式：false（默认本地开发）、true（启用）、require（强制，跳过证书验证） */
  PG_SSL: z.enum(['false', 'true', 'require']).default('false'),

  /** 达梦数据库连接字符串（可选，扩展工具 execute_sql） */
  DM_CONNECT_STRING: z.string().optional(),

  /** 档案 API 基础地址（可选，扩展工具 get_ai_archive_data） */
  ARCHIVE_API_BASE_URL: z.string().url().optional(),

  /** 档案 API 认证 Token（可选） */
  ARCHIVE_API_TOKEN: z.string().optional(),
}).transform(({ BACKEND_PORT, PORT, PG_ENABLED, ...rest }) => ({
  ...rest,
  BACKEND_PORT: BACKEND_PORT ?? PORT ?? 3000,
  PG_ENABLED: PG_ENABLED === 'true',
}))

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
