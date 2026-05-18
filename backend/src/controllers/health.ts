// 中文：本文件（health.ts）位于 backend/src/controllers/health.ts，属于backend链路中的HTTP 控制器代码，连接上游调用方与下游执行逻辑。
// English: This file (health.ts) belongs to the backend http 控制器 layer in backend/src/controllers/health.ts, wiring upstream callers with downstream runtime logic.

/**
 * 健康检查路由
 */

import { Router, type Router as RouterType } from 'express'
import type { HealthResponse } from '../types/index.js'

const router: RouterType = Router()

/** GET /health - 健康检查 */
router.get('/health', (_req, res) => {
  const response: HealthResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
  }
  res.json(response)
})

export { router as healthRouter }
