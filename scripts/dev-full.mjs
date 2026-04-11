import { spawn } from 'node:child_process'
import { getPostgresDevConfig, isLocalPostgresRunning, resolveWorkspaceRoot, startLocalPostgres, stopLocalPostgres } from './lib/postgres-dev.mjs'

const workspaceRoot = resolveWorkspaceRoot()
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

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

const pgConfig = getPostgresDevConfig({ workspaceRoot })
const pgWasRunning = isLocalPostgresRunning(pgConfig)

if (pgWasRunning) {
  console.log('reusing existing local PostgreSQL acceptance instance')
} else {
  console.log('starting local PostgreSQL acceptance instance')
}

startLocalPostgres(pgConfig)

const child = spawn(pnpmCommand, ['dev'], {
  cwd: workspaceRoot,
  env: process.env,
  stdio: 'inherit',
})

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
