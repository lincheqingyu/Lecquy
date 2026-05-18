// 中文：本文件（memory.ts）位于 backend/src/controllers/memory.ts，属于backend链路中的HTTP 控制器代码，连接上游调用方与下游执行逻辑。
// English: This file (memory.ts) belongs to the backend http 控制器 layer in backend/src/controllers/memory.ts, wiring upstream callers with downstream runtime logic.

import { Router, type Router as RouterType } from 'express'
import { z } from 'zod'
import { createHttpError } from '../middlewares/error-handler.js'
import { getMemoryConfig, saveMemoryConfig } from '../core/memory/index.js'
import { listMemoryFiles, readMemoryFile } from '../memory/store.js'

const router: RouterType = Router()

const updateConfigSchema = z.object({
  flushTurns: z.number().int().min(1).optional(),
  embeddingBaseUrl: z.string().url().or(z.literal('')).optional(),
})

const readFileQuerySchema = z.object({
  name: z.string().min(1),
})

router.get('/memory/config', async (_req, res, next) => {
  try {
    const config = await getMemoryConfig()
    res.json({ success: true, data: config })
  } catch (error) {
    next(error)
  }
})

router.put('/memory/config', async (req, res, next) => {
  try {
    const parsed = updateConfigSchema.safeParse(req.body)
    if (!parsed.success) {
      throw createHttpError(400, parsed.error.issues.map((i) => i.message).join('; '))
    }
    const config = await saveMemoryConfig(parsed.data)
    res.json({ success: true, data: config })
  } catch (error) {
    next(error)
  }
})

router.get('/memory/files', async (_req, res, next) => {
  try {
    const files = await listMemoryFiles()
    res.json({ success: true, data: { files } })
  } catch (error) {
    next(error)
  }
})

router.get('/memory/file', async (req, res, next) => {
  try {
    const parsed = readFileQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      throw createHttpError(400, parsed.error.issues.map((i) => i.message).join('; '))
    }
    const content = await readMemoryFile(parsed.data.name)
    res.json({ success: true, data: { name: parsed.data.name, content } })
  } catch (error) {
    next(error)
  }
})

export { router as memoryRouter }
