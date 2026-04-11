import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const FALLBACK_BIN_DIRS = {
  darwin: [
    '/opt/homebrew/opt/postgresql@16/bin',
    '/usr/local/opt/postgresql@16/bin',
  ],
  linux: [
    '/usr/lib/postgresql/16/bin',
    '/usr/pgsql-16/bin',
  ],
  win32: [
    'C:\\Program Files\\PostgreSQL\\16\\bin',
    'C:\\Program Files\\PostgreSQL\\15\\bin',
  ],
}

function getBinaryNames(name) {
  return process.platform === 'win32' ? [`${name}.exe`, name] : [name]
}

function isExecutableFile(filePath) {
  if (!filePath) return false

  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return false

    if (process.platform !== 'win32') {
      fs.accessSync(filePath, fs.constants.X_OK)
    }

    return true
  } catch {
    return false
  }
}

function findBinaryInDir(dirPath, name) {
  for (const candidateName of getBinaryNames(name)) {
    const candidatePath = path.join(dirPath, candidateName)
    if (isExecutableFile(candidatePath)) {
      return candidatePath
    }
  }

  return null
}

function findBinaryInPath(name) {
  const pathEntries = (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)

  for (const dirPath of pathEntries) {
    const candidatePath = findBinaryInDir(dirPath, name)
    if (candidatePath) {
      return candidatePath
    }
  }

  return null
}

function buildFallbackBinaryPath(name) {
  const fallbackDir = FALLBACK_BIN_DIRS[process.platform]?.[0]
  const fallbackName = getBinaryNames(name)[0] ?? name

  return fallbackDir ? path.join(fallbackDir, fallbackName) : fallbackName
}

function runBinary(binaryPath, args, { allowFailure = false, capture = false, env } = {}) {
  const result = spawnSync(binaryPath, args, {
    env: env ?? process.env,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })

  if (result.error) {
    throw result.error
  }

  if (!allowFailure && result.status !== 0) {
    const stderr = result.stderr?.trim()
    throw new Error(stderr || `${path.basename(binaryPath)} exited with code ${result.status ?? 1}`)
  }

  return result
}

function ensureBinary(binaryPath) {
  if (isExecutableFile(binaryPath)) {
    return
  }

  throw new Error(
    `missing PostgreSQL binary: ${binaryPath}\n` +
    'tip: add PostgreSQL bin to PATH, or override LECQUY_PG_BIN_DIR',
  )
}

function buildPostgresEnv(config) {
  if (!config.password) {
    return process.env
  }

  return {
    ...process.env,
    PGPASSWORD: config.password,
  }
}

export function resolveWorkspaceRoot() {
  return path.resolve(__dirname, '..', '..')
}

export function resolvePostgresBin(name) {
  const customBinDir = process.env.LECQUY_PG_BIN_DIR
  if (customBinDir) {
    return findBinaryInDir(customBinDir, name) ?? path.join(customBinDir, getBinaryNames(name)[0] ?? name)
  }

  return findBinaryInPath(name)
    ?? FALLBACK_BIN_DIRS[process.platform]?.map((dirPath) => findBinaryInDir(dirPath, name)).find(Boolean)
    ?? buildFallbackBinaryPath(name)
}

export function getPostgresDevConfig({ workspaceRoot = resolveWorkspaceRoot() } = {}) {
  const pgHome = process.env.LECQUY_PG_HOME ?? path.join(workspaceRoot, '.lecquy', 'dev-postgres')

  return {
    workspaceRoot,
    host: process.env.LECQUY_PG_HOST ?? '127.0.0.1',
    port: process.env.LECQUY_PG_PORT ?? '5432',
    dbName: process.env.LECQUY_PG_DATABASE ?? 'lecquy',
    user: process.env.LECQUY_PG_USER ?? 'postgres',
    password: process.env.LECQUY_PG_PASSWORD ?? '',
    pgHome,
    dataDir: process.env.LECQUY_PG_DATA_DIR ?? path.join(pgHome, 'data'),
    logDir: process.env.LECQUY_PG_LOG_DIR ?? path.join(pgHome, 'logs'),
    runDir: process.env.LECQUY_PG_RUN_DIR ?? path.join(pgHome, 'run'),
    logFile: process.env.LECQUY_PG_LOG_FILE ?? path.join(pgHome, 'logs', 'postgres.log'),
    initdbBin: resolvePostgresBin('initdb'),
    pgCtlBin: resolvePostgresBin('pg_ctl'),
    psqlBin: resolvePostgresBin('psql'),
    createdbBin: resolvePostgresBin('createdb'),
  }
}

export function isLocalPostgresRunning(config) {
  ensureBinary(config.pgCtlBin)

  if (!fs.existsSync(config.dataDir)) {
    return false
  }

  const result = runBinary(config.pgCtlBin, ['-D', config.dataDir, 'status'], {
    allowFailure: true,
    capture: true,
  })

  return result.status === 0
}

export function printLocalPostgresStatus(config) {
  ensureBinary(config.pgCtlBin)

  if (!fs.existsSync(config.dataDir)) {
    console.error(`PostgreSQL data dir not found: ${config.dataDir}`)
    return 1
  }

  const result = runBinary(config.pgCtlBin, ['-D', config.dataDir, 'status'], {
    allowFailure: true,
  })

  return result.status ?? 1
}

function initializeCluster(config) {
  if (fs.existsSync(path.join(config.dataDir, 'base'))) {
    return
  }

  console.log(`initializing PostgreSQL cluster in ${config.dataDir}`)
  fs.mkdirSync(config.dataDir, { recursive: true })

  runBinary(config.initdbBin, [
    `--pgdata=${config.dataDir}`,
    `--username=${config.user}`,
    '--auth-local=trust',
    '--auth-host=trust',
    '--encoding=UTF8',
  ])
}

function startServer(config) {
  if (isLocalPostgresRunning(config)) {
    console.log('PostgreSQL already running')
    return
  }

  console.log(`starting PostgreSQL on ${config.host}:${config.port}`)

  runBinary(config.pgCtlBin, [
    '-D', config.dataDir,
    '-l', config.logFile,
    '-o', `-h ${config.host} -p ${config.port}`,
    'start',
  ])
}

function escapeSqlLiteral(value) {
  return value.replaceAll("'", "''")
}

function databaseExists(config) {
  const result = runBinary(config.psqlBin, [
    `--host=${config.host}`,
    `--port=${config.port}`,
    `--username=${config.user}`,
    '--dbname=postgres',
    '--tuples-only',
    '--no-align',
    `--command=SELECT 1 FROM pg_database WHERE datname = '${escapeSqlLiteral(config.dbName)}' LIMIT 1;`,
  ], {
    capture: true,
    env: buildPostgresEnv(config),
  })

  return result.stdout.trim() === '1'
}

function ensureDatabase(config) {
  if (databaseExists(config)) {
    return
  }

  console.log(`creating database ${config.dbName}`)

  runBinary(config.createdbBin, [
    `--host=${config.host}`,
    `--port=${config.port}`,
    `--username=${config.user}`,
    config.dbName,
  ], {
    env: buildPostgresEnv(config),
  })
}

function printReadySummary(config) {
  console.log(`PostgreSQL local acceptance env is ready.

Connection:
  host=${config.host}
  port=${config.port}
  database=${config.dbName}
  user=${config.user}
  password=<empty>

Suggested backend env:
  PG_ENABLED=true
  PG_HOST=${config.host}
  PG_PORT=${config.port}
  PG_DATABASE=${config.dbName}
  PG_USER=${config.user}
  PG_PASSWORD=`)
}

export function startLocalPostgres(config) {
  ensureBinary(config.initdbBin)
  ensureBinary(config.pgCtlBin)
  ensureBinary(config.psqlBin)
  ensureBinary(config.createdbBin)

  fs.mkdirSync(config.logDir, { recursive: true })
  fs.mkdirSync(config.runDir, { recursive: true })

  initializeCluster(config)
  startServer(config)
  ensureDatabase(config)
  printReadySummary(config)
}

export function stopLocalPostgres(config) {
  ensureBinary(config.pgCtlBin)

  if (!fs.existsSync(config.dataDir)) {
    console.log(`PostgreSQL data dir not found: ${config.dataDir}`)
    return 0
  }

  if (!isLocalPostgresRunning(config)) {
    console.log('PostgreSQL is not running')
    return 0
  }

  runBinary(config.pgCtlBin, ['-D', config.dataDir, 'stop', '-m', 'fast'])
  console.log('PostgreSQL stopped')
  return 0
}
