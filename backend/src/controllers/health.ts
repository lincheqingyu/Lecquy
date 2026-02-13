/**
 * 健康检查路由
 */

import { Router, type Router as RouterType } from 'express'
import type { HealthResponse } from '../types/index.js'
import { listProviders } from '../providers/registry.js'

const router: RouterType = Router()

/** GET /health - 健康检查 */
router.get('/health', (_req, res) => {
  const response: HealthResponse = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    providers: listProviders(),
  }
  res.json(response)
})

export { router as healthRouter }
