/**
 * Express 应用配置
 * 注册中间件和路由
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import express from 'express'
import cors from 'cors'
import { requestLogger } from './middlewares/request-logger.js'
import { errorHandler } from './middlewares/error-handler.js'
import { healthRouter } from './controllers/health.js'
import { modelsRouter } from './controllers/models.js'
import { memoryRouter } from './controllers/memory.js'
import { sessionsRouter } from './controllers/sessions.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export function createApp(): express.Express {
  const app = express()

  // 基础中间件
  app.use(cors())
  app.use(express.json())
  app.use(requestLogger)

  // 路由
  app.use(healthRouter)
  app.use('/api/v1', modelsRouter)
  app.use('/api/v1', memoryRouter)
  app.use('/api/v1', sessionsRouter)

  // 全局错误处理（必须在路由之后）
  app.use(errorHandler)

  // 生产环境：托管前端静态文件（与 API 同端口，无需 nginx）
  const frontendDist = path.resolve(__dirname, '../../frontend/dist')
  if (process.env.NODE_ENV === 'production' && fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist))
    // SPA 回退：非 API 路由都返回 index.html
    app.get('*', (_req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'))
    })
  }

  return app
}
