// 中文：本文件（context.ts）位于 backend/src/controllers/context.ts，属于backend链路中的HTTP 控制器代码，连接上游调用方与下游执行逻辑。
// English: This file (context.ts) belongs to the backend http 控制器 layer in backend/src/controllers/context.ts, wiring upstream callers with downstream runtime logic.

import { Router, type Router as RouterType } from 'express'
import { z } from 'zod'
import {
  ALL_CONTEXT_FILE_NAMES,
  EDITABLE_CONTEXT_FILE_NAMES,
  listPromptContextFiles,
  readPromptContextFile,
  writePromptContextFile,
} from '../core/prompts/context-files.js'
import { createHttpError } from '../middlewares/error-handler.js'

const router: RouterType = Router()

const contextFileNameSchema = z.enum(ALL_CONTEXT_FILE_NAMES)
const editableContextFileNameSchema = z.enum(EDITABLE_CONTEXT_FILE_NAMES)

const updateContextFileSchema = z.object({
  content: z.string(),
})

router.get('/context/files', async (_req, res, next) => {
  try {
    const files = await listPromptContextFiles()
    res.json({ success: true, data: { files } })
  } catch (error) {
    next(error)
  }
})

router.get('/context/files/:name', async (req, res, next) => {
  try {
    const parsed = contextFileNameSchema.safeParse(req.params.name)
    if (!parsed.success) {
      throw createHttpError(400, parsed.error.issues.map((issue) => issue.message).join('; '))
    }

    const file = await readPromptContextFile(parsed.data)
    res.json({ success: true, data: { file } })
  } catch (error) {
    next(error)
  }
})

router.put('/context/files/:name', async (req, res, next) => {
  try {
    const parsedName = editableContextFileNameSchema.safeParse(req.params.name)
    if (!parsedName.success) {
      throw createHttpError(400, '该上下文文件不支持编辑')
    }

    const parsedBody = updateContextFileSchema.safeParse(req.body)
    if (!parsedBody.success) {
      throw createHttpError(400, parsedBody.error.issues.map((issue) => issue.message).join('; '))
    }

    const file = await writePromptContextFile(parsedName.data, parsedBody.data.content)
    res.json({ success: true, data: { file } })
  } catch (error) {
    next(error)
  }
})

export { router as contextRouter }
