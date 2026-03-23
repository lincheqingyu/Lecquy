/**
 * Express 应用配置
 * 注册中间件和路由
 */

import path from 'node:path'
import fs from 'node:fs'
import express from 'express'
import cors from 'cors'
import { requestLogger } from './middlewares/request-logger.js'
import { errorHandler } from './middlewares/error-handler.js'
import { healthRouter } from './controllers/health.js'
import { modelsRouter } from './controllers/models.js'
import { memoryRouter } from './controllers/memory.js'
import { contextRouter } from './controllers/context.js'
import { sessionsRouter } from './controllers/sessions.js'
import { getBundledFrontendAsset, hasBundledFrontendAssets } from './core/runtime-bundle.js'
import { resolveWorkspaceRoot } from './core/runtime-paths.js'

export function createApp(): express.Express {
  const app = express()

  // 基础中间件
  app.use(cors())
  app.use(express.json())
  app.use(requestLogger)

  // 路由
  app.use(healthRouter)
  app.use('/api/v1', modelsRouter)
  app.use('/api/v1', contextRouter)
  app.use('/api/v1', memoryRouter)
  app.use('/api/v1', sessionsRouter)

  // 全局错误处理（必须在路由之后）
  app.use(errorHandler)

  // 生产环境：托管前端静态文件（与 API 同端口，无需 nginx）
  const frontendDist = path.join(resolveWorkspaceRoot(), 'frontend', 'dist')
  if (process.env.NODE_ENV === 'production' && fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist))
    // SPA 回退：非 API 路由都返回 index.html
    app.get('*', (_req, res) => {
      res.sendFile(path.join(frontendDist, 'index.html'))
    })
  } else if (process.env.NODE_ENV === 'production' && hasBundledFrontendAssets()) {
    app.get('*', (req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        next()
        return
      }

      const asset = getBundledFrontendAsset(req.path)
      if (!asset) {
        next()
        return
      }

      const body = Buffer.from(asset.contentBase64, 'base64')
      res.type(asset.contentType)
      if (asset.etag) {
        res.setHeader('ETag', asset.etag)
      }
      if (req.path === '/' || req.path === '/index.html') {
        res.setHeader('Cache-Control', 'no-cache')
      } else {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      }
      res.send(body)
    })
  }

  return app
}
