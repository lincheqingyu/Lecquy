/**
 * HTTP 服务器启动入口
 * 加载配置 → 初始化 Provider → 启动服务
 */

import dotenv from 'dotenv'
import fs from 'node:fs'
import { resolve } from 'node:path'
import { resolveWorkspaceRoot } from './core/runtime-paths.js'

const workspaceRoot = resolveWorkspaceRoot()
const workspaceEnvPath = resolve(workspaceRoot, '.env')
const legacyBackendEnvPath = resolve(workspaceRoot, 'backend', '.env')

if (fs.existsSync(workspaceEnvPath)) {
  dotenv.config({ path: workspaceEnvPath })
}

if (legacyBackendEnvPath !== workspaceEnvPath && fs.existsSync(legacyBackendEnvPath)) {
  dotenv.config({ path: legacyBackendEnvPath, override: false })
}

import { loadConfig } from './config/index.js'
import { createServer } from 'node:http'
import { createApp } from './app.js'
import { logger } from './utils/logger.js'
import { initChatWebSocketServer } from './ws/chat-ws.js'
import { createSessionRuntimeService } from './runtime/index.js'
import { initializeSessionTools } from './agent/tools/index.js'
import { closePool, getPool } from './db/client.js'
import { runMigrations } from './db/migrate.js'
import { createMemoryCoordinator } from './memory/coordinator.js'

/** 优雅关闭超时（毫秒） */
const SHUTDOWN_TIMEOUT = 30_000

async function main(): Promise<void> {
  // 1. 加载并校验配置
  const config = loadConfig()

  // 2. 可选初始化 PostgreSQL 底座
  if (config.PG_ENABLED) {
    logger.info('PostgreSQL 已启用，正在执行 migration...')
    await runMigrations(getPool())
    logger.info('PostgreSQL 初始化完成')
  } else {
    logger.info('PostgreSQL 未启用，继续使用文件持久化链路')
  }

  const memoryCoordinator = config.PG_ENABLED
    ? await createMemoryCoordinator(config)
    : null

  // 3. 创建 Express 应用
  const app = createApp()
  const server = createServer(app)

  // 4. 创建会话服务并绑定 session tools
  const sessionRuntime = await createSessionRuntimeService()
  initializeSessionTools(sessionRuntime)

  // 5. 初始化 WebSocket（传入 registry）
  const wss = initChatWebSocketServer(server, sessionRuntime)

  server.on('error', (error) => {
    logger.error('HTTP 服务器监听失败', error)
    process.exit(1)
  })

  wss.on('error', (error) => {
    logger.error('WebSocket 服务器启动失败', error)
    process.exit(1)
  })

  // 6. 启动服务器
  const displayHost = config.HOST === '0.0.0.0' ? 'localhost' : config.HOST
  server.listen(config.BACKEND_PORT, config.HOST, () => {
    logger.info(`服务器已启动: http://${displayHost}:${config.BACKEND_PORT}`)
    logger.info(`环境: ${config.NODE_ENV}`)
    logger.info(`日志: ${config.LOG_LEVEL}`)
  })

  // 7. 优雅关闭
  let isShuttingDown = false

  const shutdown = async (signal: string) => {
    if (isShuttingDown) return
    isShuttingDown = true

    logger.info(`收到 ${signal}，正在优雅关闭...`)

    // 超时保护：强制退出
    const forceTimer = setTimeout(() => {
      logger.error('优雅关闭超时，强制退出')
      process.exit(1)
    }, SHUTDOWN_TIMEOUT)
    forceTimer.unref()

    // 关闭所有 WS 连接
    for (const client of wss.clients) {
      client.close(1001, '服务器关闭')
    }

    try {
      await sessionRuntime.shutdown()
      await memoryCoordinator?.shutdown()

      if (config.PG_ENABLED) {
        await closePool()
      }
    } catch (error) {
      clearTimeout(forceTimer)
      logger.error('优雅关闭失败', error)
      process.exit(1)
      return
    }

    server.close(() => {
      clearTimeout(forceTimer)
      logger.info('服务器已关闭')
      process.exit(0)
    })
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

void main().catch((error) => {
  logger.error('服务器启动失败', error)
  process.exit(1)
})
