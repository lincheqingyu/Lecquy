// 中文：本文件（postgres-dev.mjs）位于 scripts/lib/postgres-dev.mjs，封装本地 PostgreSQL 开发实例的路径解析、启动和状态检查。
// English: This file (postgres-dev.mjs) wraps path resolution, startup, and status checks for the local PostgreSQL dev instance.

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
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

const REQUIRED_POSTGRES_BINS = ['initdb', 'pg_ctl', 'psql', 'createdb']
const WINDOWS_EMBEDDED_POSTGRES = {
  version: '16.13',
  build: '1',
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

function escapePowerShellString(value) {
  return value.replaceAll("'", "''")
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

function runCommand(command, args, { allowFailure = false, capture = false } = {}) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  })

  if (result.error) {
    throw result.error
  }

  if (!allowFailure && result.status !== 0) {
    const stderr = result.stderr?.trim()
    throw new Error(stderr || `${command} exited with code ${result.status ?? 1}`)
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

function hasRequiredBinariesInDir(dirPath) {
  return REQUIRED_POSTGRES_BINS.every((name) => Boolean(findBinaryInDir(dirPath, name)))
}

function getEmbeddedPostgresRuntime(workspaceRoot) {
  const rootDir = process.env.LECQUY_PG_RUNTIME_DIR ?? path.join(workspaceRoot, '.lecquy', 'pg')
  const version = process.env.LECQUY_PG_RUNTIME_VERSION?.trim() || WINDOWS_EMBEDDED_POSTGRES.version
  const build = process.env.LECQUY_PG_RUNTIME_BUILD?.trim() || WINDOWS_EMBEDDED_POSTGRES.build
  const tag = `${version}-${build}`
  const archiveBaseName = `postgresql-${version}-${build}-windows-x64-binaries`
  const installDir = path.join(rootDir, tag)

  return {
    rootDir,
    version,
    build,
    tag,
    archiveFileName: `${archiveBaseName}.zip`,
    archivePath: path.join(rootDir, 'cache', `${archiveBaseName}.zip`),
    tempArchivePath: path.join(rootDir, 'cache', `${archiveBaseName}.zip.tmp`),
    installDir,
    tempInstallDir: `${installDir}.tmp`,
    downloadUrl: process.env.LECQUY_PG_RUNTIME_URL?.trim()
      || `https://get.enterprisedb.com/postgresql/${archiveBaseName}.zip`,
  }
}

function findEmbeddedPostgresBinDir(installDir) {
  const candidates = [
    path.join(installDir, 'pgsql', 'bin'),
    path.join(installDir, 'bin'),
  ]

  return candidates.find((dirPath) => hasRequiredBinariesInDir(dirPath)) ?? null
}

function getEmbeddedPostgresBinDir(workspaceRoot) {
  if (process.platform !== 'win32') {
    return null
  }

  const runtime = getEmbeddedPostgresRuntime(workspaceRoot)
  return findEmbeddedPostgresBinDir(runtime.installDir)
}

export function resolvePostgresBin(name, { workspaceRoot = resolveWorkspaceRoot() } = {}) {
  const customBinDir = process.env.LECQUY_PG_BIN_DIR
  if (customBinDir) {
    return findBinaryInDir(customBinDir, name) ?? path.join(customBinDir, getBinaryNames(name)[0] ?? name)
  }

  const embeddedBinDir = getEmbeddedPostgresBinDir(workspaceRoot)
  if (embeddedBinDir) {
    return findBinaryInDir(embeddedBinDir, name) ?? path.join(embeddedBinDir, getBinaryNames(name)[0] ?? name)
  }

  return findBinaryInPath(name)
    ?? FALLBACK_BIN_DIRS[process.platform]?.map((dirPath) => findBinaryInDir(dirPath, name)).find(Boolean)
    ?? buildFallbackBinaryPath(name)
}

export function getPostgresDevConfig({ workspaceRoot = resolveWorkspaceRoot() } = {}) {
  const pgHome = process.env.LECQUY_PG_HOME ?? path.join(workspaceRoot, '.lecquy', 'dev-postgres')
  const embeddedRuntime = getEmbeddedPostgresRuntime(workspaceRoot)
  const embeddedBinDir = getEmbeddedPostgresBinDir(workspaceRoot)

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
    embeddedRuntime,
    embeddedBinDir,
    initdbBin: resolvePostgresBin('initdb', { workspaceRoot }),
    pgCtlBin: resolvePostgresBin('pg_ctl', { workspaceRoot }),
    psqlBin: resolvePostgresBin('psql', { workspaceRoot }),
    createdbBin: resolvePostgresBin('createdb', { workspaceRoot }),
  }
}

function hasRequiredBinaries(config) {
  return [
    config.initdbBin,
    config.pgCtlBin,
    config.psqlBin,
    config.createdbBin,
  ].every((binaryPath) => isExecutableFile(binaryPath))
}

async function downloadFile(url, destinationPath) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`failed to download PostgreSQL runtime: ${response.status} ${response.statusText}`)
  }

  await fsp.mkdir(path.dirname(destinationPath), { recursive: true })

  if (!response.body) {
    await fsp.writeFile(destinationPath, Buffer.from(await response.arrayBuffer()))
    return
  }

  await pipeline(
    Readable.fromWeb(response.body),
    fs.createWriteStream(destinationPath),
  )
}

function extractWindowsZip(archivePath, destinationPath) {
  const command = `Expand-Archive -LiteralPath '${escapePowerShellString(archivePath)}' -DestinationPath '${escapePowerShellString(destinationPath)}' -Force`
  runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command])
}

function shouldAutoBootstrapEmbeddedPostgres(config) {
  return process.platform === 'win32'
    && process.arch === 'x64'
    && !process.env.LECQUY_PG_BIN_DIR
}

async function bootstrapEmbeddedPostgres(config) {
  if (!shouldAutoBootstrapEmbeddedPostgres(config)) {
    return config
  }

  const runtime = config.embeddedRuntime
  const existingBinDir = findEmbeddedPostgresBinDir(runtime.installDir)
  if (existingBinDir) {
    process.env.LECQUY_PG_BIN_DIR = existingBinDir
    return getPostgresDevConfig({ workspaceRoot: config.workspaceRoot })
  }

  console.log(`PostgreSQL binaries not found, bootstrapping local runtime into ${path.relative(config.workspaceRoot, runtime.rootDir)}`)

  await fsp.mkdir(path.dirname(runtime.archivePath), { recursive: true })
  await fsp.mkdir(runtime.rootDir, { recursive: true })

  if (!fs.existsSync(runtime.archivePath)) {
    console.log(`downloading PostgreSQL runtime from ${runtime.downloadUrl}`)
    await fsp.rm(runtime.tempArchivePath, { force: true })
    await downloadFile(runtime.downloadUrl, runtime.tempArchivePath)
    await fsp.rename(runtime.tempArchivePath, runtime.archivePath)
  } else {
    console.log(`reusing cached PostgreSQL runtime archive ${path.relative(config.workspaceRoot, runtime.archivePath)}`)
  }

  await fsp.rm(runtime.tempInstallDir, { recursive: true, force: true })
  await fsp.mkdir(runtime.tempInstallDir, { recursive: true })
  extractWindowsZip(runtime.archivePath, runtime.tempInstallDir)

  const extractedBinDir = findEmbeddedPostgresBinDir(runtime.tempInstallDir)
  if (!extractedBinDir) {
    throw new Error(`downloaded PostgreSQL runtime is missing required binaries under ${runtime.tempInstallDir}`)
  }

  await fsp.rm(runtime.installDir, { recursive: true, force: true })
  await fsp.rename(runtime.tempInstallDir, runtime.installDir)

  const finalBinDir = findEmbeddedPostgresBinDir(runtime.installDir)
  if (!finalBinDir) {
    throw new Error(`bootstrapped PostgreSQL runtime is missing required binaries under ${runtime.installDir}`)
  }

  process.env.LECQUY_PG_BIN_DIR = finalBinDir
  return getPostgresDevConfig({ workspaceRoot: config.workspaceRoot })
}

export async function resolvePostgresDevConfig({ workspaceRoot = resolveWorkspaceRoot(), bootstrapIfMissing = false } = {}) {
  let config = getPostgresDevConfig({ workspaceRoot })

  if (hasRequiredBinaries(config) || !bootstrapIfMissing) {
    return config
  }

  config = await bootstrapEmbeddedPostgres(config)
  return config
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
