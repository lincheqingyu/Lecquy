// 中文：本文件（models.ts）位于 backend/src/controllers/models.ts，属于backend链路中的HTTP 控制器代码，连接上游调用方与下游执行逻辑。
// English: This file (models.ts) belongs to the backend http 控制器 layer in backend/src/controllers/models.ts, wiring upstream callers with downstream runtime logic.

import { Router, type Router as RouterType } from 'express'
import { z } from 'zod'
import { createHttpError } from '../middlewares/error-handler.js'

const router: RouterType = Router()

const listModelsSchema = z.object({
  baseUrl: z.string().url('baseUrl 必须是合法 URL'),
  apiKey: z.string().optional(),
})

function buildModelsUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, '')
  if (normalized.endsWith('/v1')) {
    return `${normalized}/models`
  }
  return `${normalized}/v1/models`
}

router.post('/models/list', async (req, res, next) => {
  try {
    const parsed = listModelsSchema.safeParse(req.body)
    if (!parsed.success) {
      throw createHttpError(400, parsed.error.issues.map((i) => i.message).join('; '))
    }

    const { baseUrl, apiKey } = parsed.data
    const target = buildModelsUrl(baseUrl)

    const headers: Record<string, string> = {}
    if (apiKey && apiKey.trim()) {
      headers.Authorization = `Bearer ${apiKey.trim()}`
    }

    const response = await fetch(target, { method: 'GET', headers })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw createHttpError(502, `上游模型服务请求失败: ${response.status} ${text}`)
    }

    const json = await response.json()

    res.json({
      success: true,
      data: json,
    })
  } catch (error) {
    next(error)
  }
})

export { router as modelsRouter }
