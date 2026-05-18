// 中文：本文件（dev-pg.mjs）位于 scripts/dev-pg.mjs，提供本地 PostgreSQL 开发实例的 start/stop/status 命令。
// English: This file (dev-pg.mjs) provides start/stop/status commands for the local PostgreSQL dev instance.

import { printLocalPostgresStatus, resolvePostgresDevConfig, startLocalPostgres, stopLocalPostgres } from './lib/postgres-dev.mjs'

const command = process.argv[2]

function printUsage() {
  console.error('usage: node scripts/dev-pg.mjs <start|stop|status>')
}

if (!command) {
  printUsage()
  process.exit(1)
}

try {
  const config = await resolvePostgresDevConfig({ bootstrapIfMissing: command === 'start' })

  if (command === 'start') {
    startLocalPostgres(config)
    process.exit(0)
  }

  if (command === 'stop') {
    process.exit(stopLocalPostgres(config))
  }

  if (command === 'status') {
    process.exit(printLocalPostgresStatus(config))
  }

  printUsage()
  process.exit(1)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
