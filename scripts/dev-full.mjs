// 中文：本文件（dev-full.mjs）位于 scripts/dev-full.mjs，负责启动前后端联调和本地 PostgreSQL 开发实例。
// English: This file (dev-full.mjs) starts the full-stack dev loop and local PostgreSQL dev instance.

import { spawn } from 'node:child_process'
import { isLocalPostgresRunning, resolvePostgresDevConfig, resolveWorkspaceRoot, startLocalPostgres, stopLocalPostgres } from './lib/postgres-dev.mjs'

const workspaceRoot = resolveWorkspaceRoot()

process.env.PG_ENABLED ??= 'true'
process.env.PG_HOST ??= '127.0.0.1'
process.env.PG_PORT ??= '5432'
process.env.PG_DATABASE ??= 'lecquy'
process.env.PG_USER ??= 'postgres'
process.env.PG_PASSWORD ??= ''
process.env.PG_SSL ??= 'false'

process.env.LECQUY_PG_HOST ??= process.env.PG_HOST
process.env.LECQUY_PG_PORT ??= process.env.PG_PORT
process.env.LECQUY_PG_DATABASE ??= process.env.PG_DATABASE
process.env.LECQUY_PG_USER ??= process.env.PG_USER
process.env.LECQUY_PG_PASSWORD ??= process.env.PG_PASSWORD

const pgConfig = await resolvePostgresDevConfig({ workspaceRoot, bootstrapIfMissing: true })
const pgWasRunning = isLocalPostgresRunning(pgConfig)

if (pgWasRunning) {
  console.log('reusing existing local PostgreSQL acceptance instance')
} else {
  console.log('starting local PostgreSQL acceptance instance')
}

startLocalPostgres(pgConfig)

function spawnDevProcess() {
  if (process.platform === 'win32') {
    return spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'pnpm dev'], {
      cwd: workspaceRoot,
      env: process.env,
      stdio: 'inherit',
    })
  }

  return spawn('pnpm', ['dev'], {
    cwd: workspaceRoot,
    env: process.env,
    stdio: 'inherit',
  })
}

const child = spawnDevProcess()

let finalized = false

function finalize(exitCode) {
  if (finalized) return
  finalized = true

  try {
    if (!pgWasRunning) {
      console.log('\nstopping local PostgreSQL acceptance instance')
      stopLocalPostgres(pgConfig)
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(exitCode === 0 ? 1 : exitCode)
  }

  process.exit(exitCode)
}

function forwardSignal(signal, fallbackExitCode) {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill(signal)
    return
  }

  finalize(fallbackExitCode)
}

child.on('error', (error) => {
  console.error(error instanceof Error ? error.message : String(error))
  finalize(1)
})

child.on('exit', (code, signal) => {
  if (signal === 'SIGINT') {
    finalize(130)
    return
  }

  if (signal === 'SIGTERM') {
    finalize(143)
    return
  }

  finalize(code ?? 1)
})

process.on('SIGINT', () => forwardSignal('SIGINT', 130))
process.on('SIGTERM', () => forwardSignal('SIGTERM', 143))
