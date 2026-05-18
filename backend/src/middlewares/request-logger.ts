// 中文：本文件（request-logger.ts）位于 backend/src/middlewares/request-logger.ts，属于backend链路中的backend 模块实现代码，连接上游调用方与下游执行逻辑。
// English: This file (request-logger.ts) belongs to the backend backend 模块实现 layer in backend/src/middlewares/request-logger.ts, wiring upstream callers with downstream runtime logic.

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
