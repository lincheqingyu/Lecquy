import { Router, type Router as RouterType } from 'express'
import { z } from 'zod'
import { getSessionRuntimeService } from '../runtime/index.js'
import { createHttpError } from '../middlewares/error-handler.js'

const router: RouterType = Router()

const listSessionsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  activeMinutes: z.coerce.number().int().min(1).optional(),
  messageLimit: z.coerce.number().int().min(0).max(50).optional(),
})

const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

const detailQuerySchema = z.object({
  recentMessagesLimit: z.coerce.number().int().min(0).max(50).optional(),
})

const updateSessionSchema = z.object({
  title: z.string().trim().min(1, '标题不能为空').max(80, '标题不能超过 80 个字符'),
})

router.get('/sessions', async (req, res, next) => {
  try {
    const parsed = listSessionsQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      throw createHttpError(400, parsed.error.issues.map((i) => i.message).join('; '))
    }

    const rows = await getSessionRuntimeService().listSessions(parsed.data)
    res.json({ success: true, data: { sessions: rows } })
  } catch (error) {
    next(error)
  }
})

router.get('/sessions/:sessionKey/history', async (req, res, next) => {
  try {
    const parsed = historyQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      throw createHttpError(400, parsed.error.issues.map((i) => i.message).join('; '))
    }

    const rows = await getSessionRuntimeService().history(req.params.sessionKey, parsed.data.limit)
    res.json({ success: true, data: { sessionKey: req.params.sessionKey, messages: rows } })
  } catch (error) {
    next(error)
  }
})

router.get('/sessions/:sessionKey', async (req, res, next) => {
  try {
    const parsed = detailQuerySchema.safeParse(req.query)
    if (!parsed.success) {
      throw createHttpError(400, parsed.error.issues.map((i) => i.message).join('; '))
    }

    const service = getSessionRuntimeService()
    const detail = await service.getSession(req.params.sessionKey)
    if (!detail) {
      throw createHttpError(404, `会话不存在: ${req.params.sessionKey}`)
    }

    const recentMessages = parsed.data.recentMessagesLimit && parsed.data.recentMessagesLimit > 0
      ? await service.history(req.params.sessionKey, parsed.data.recentMessagesLimit)
      : undefined

    res.json({
      success: true,
      data: {
        ...detail,
        recentMessages,
      },
    })
  } catch (error) {
    next(error)
  }
})

router.patch('/sessions/:sessionKey', async (req, res, next) => {
  try {
    const parsed = updateSessionSchema.safeParse(req.body)
    if (!parsed.success) {
      throw createHttpError(400, parsed.error.issues.map((i) => i.message).join('; '))
    }

    const updated = await getSessionRuntimeService().updateSessionTitle(req.params.sessionKey, parsed.data.title)
    if (!updated) {
      throw createHttpError(404, `会话不存在: ${req.params.sessionKey}`)
    }

    res.json({
      success: true,
      data: {
        session: updated,
      },
    })
  } catch (error) {
    next(error)
  }
})

router.delete('/sessions/:sessionKey', async (req, res, next) => {
  try {
    const deleted = await getSessionRuntimeService().deleteSession(req.params.sessionKey)
    if (!deleted) {
      throw createHttpError(404, `会话不存在: ${req.params.sessionKey}`)
    }
    res.json({ success: true, data: { deleted: true, sessionKey: req.params.sessionKey } })
  } catch (error) {
    next(error)
  }
})

export { router as sessionsRouter }
