/**
 * 请求日志中间件
 */

import type { Request, Response, NextFunction } from 'express'
import { logger } from '../utils/logger.js'

/**
 * 记录 HTTP 请求日志
 * 输出请求方法、路径和响应耗时
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const start = Date.now()

  res.on('finish', () => {
    const duration = Date.now() - start
    const status = res.statusCode
    logger.info(`${req.method} ${req.path} ${status} ${duration}ms`)
  })

  next()
}
