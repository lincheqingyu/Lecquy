/**
 * Express 应用配置
 * 注册中间件和路由
 */

import express from 'express'
import cors from 'cors'
import { requestLogger } from './middlewares/request-logger.js'
import { errorHandler } from './middlewares/error-handler.js'
import { healthRouter } from './controllers/health.js'
import { chatRouter } from './controllers/chat.js'

export function createApp(): express.Express {
  const app = express()

  // 基础中间件
  app.use(cors())
  app.use(express.json())
  app.use(requestLogger)

  // 路由
  app.use(healthRouter)
  app.use("/api/v1",chatRouter)

  // 全局错误处理（必须在路由之后）
  app.use(errorHandler)

  return app
}
