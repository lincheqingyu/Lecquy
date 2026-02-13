/**
 * 全局错误处理中间件
 */

import type { Request, Response, NextFunction } from 'express'
import type { ErrorResponse } from '../types/index.js'
import { logger } from '../utils/logger.js'

/**
 * Express 全局错误处理中间件
 * 必须有 4 个参数，Express 才会识别为错误处理中间件
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  logger.error(`请求处理错误: ${err.message}`, err.stack)

  const statusCode = isHttpError(err) ? err.statusCode : 500

  const response: ErrorResponse = {
    success: false,
    error: statusCode === 500 ? '服务器内部错误' : err.message,
  }

  res.status(statusCode).json(response)
}

/** HTTP 错误类型守卫 */
function isHttpError(err: unknown): err is Error & { statusCode: number } {
  return typeof (err as Record<string, unknown>).statusCode === 'number'
}

/** 创建带状态码的 HTTP 错误 */
export function createHttpError(statusCode: number, message: string): Error & { statusCode: number } {
  const error = new Error(message) as Error & { statusCode: number }
  error.statusCode = statusCode
  return error
}
