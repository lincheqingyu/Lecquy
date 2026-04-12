#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const RELEASE_ROOT = path.join(ROOT_DIR, 'release', 'sea')
const BUILD_ROOT = path.join(RELEASE_ROOT, '.build')
const CACHE_ROOT = path.join(RELEASE_ROOT, '.cache')
const RUNTIME_BUNDLE_PATH = path.join(ROOT_DIR, 'backend', 'runtime-bundle.json')
const README_PATH = path.join(ROOT_DIR, 'deploy', 'PORTABLE-RELEASE.md')
const ENV_EXAMPLE_PATH = path.join(ROOT_DIR, '.env.example')
const POSTJECT_CLI_PATH = path.join(ROOT_DIR, 'node_modules', 'postject', 'dist', 'cli.js')
const NODE_VERSION = process.env.LECQUY_SEA_NODE_VERSION?.trim() || process.version.replace(/^v/, '')
const NODE_MAJOR = NODE_VERSION.split('.')[0] ?? '22'
const NODE_DIST_BASE_URL = process.env.LECQUY_SEA_NODE_DIST_BASE_URL?.trim() || 'https://nodejs.org/dist'
const SEA_FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2'

const TARGETS = {
  'macos-arm64': {
    archiveName: `node-v${NODE_VERSION}-darwin-arm64.tar.xz`,
    extractedExecutablePath: path.join(`node-v${NODE_VERSION}-darwin-arm64`, 'bin', 'node'),
    outputFileName: 'lecquy-macos-arm64',
    postjectArgs: ['--macho-segment-name', 'NODE_SEA'],
    executableLabel: 'macOS arm64',
    isWindows: false,
    isMacos: true,
  },
  'linux-arm64': {
    archiveName: `node-v${NODE_VERSION}-linux-arm64.tar.xz`,
    extractedExecutablePath: path.join(`node-v${NODE_VERSION}-linux-arm64`, 'bin', 'node'),
    outputFileName: 'lecquy-linux-arm64',
    postjectArgs: [],
    executableLabel: 'Linux arm64',
    isWindows: false,
    isMacos: false,
  },
  'windows-x64': {
    archiveName: `node-v${NODE_VERSION}-win-x64.zip`,
    extractedExecutablePath: path.join(`node-v${NODE_VERSION}-win-x64`, 'node.exe'),
    outputFileName: 'lecquy-server.exe',
    postjectArgs: [],
    executableLabel: 'Windows x64',
    isWindows: true,
    isMacos: false,
  },
}

function resolveRequestedTargets(argv) {
  const aliases = {
    macos: 'macos-arm64',
    linux: 'linux-arm64',
    windows: 'windows-x64',
  }

  const requested = argv.flatMap((value) => value.split(',')).map((value) => value.trim()).filter(Boolean)
  if (requested.length === 0) {
    console.error('用法: node scripts/build-sea.mjs <macos-arm64|linux-arm64|windows-x64>')
    process.exit(1)
  }

  const normalized = requested.map((value) => aliases[value] ?? value)
  const invalid = normalized.filter((value) => !(value in TARGETS))
  if (invalid.length > 0) {
    console.error(`不支持的目标: ${invalid.join(', ')}`)
    process.exit(1)
  }

  return [...new Set(normalized)]
}

async function ensureFile(filePath, label) {
  try {
    await fs.access(filePath)
  } catch {
    throw new Error(`${label} 不存在: ${filePath}`)
  }
}

async function removeIfExists(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true })
}

async function writeExecutableFile(filePath, content) {
  await fs.writeFile(filePath, content, 'utf8')
  await fs.chmod(filePath, 0o755)
}

function buildReleaseEnvContent(template) {
  const productionLine = 'NODE_ENV=production'
  const normalized = template.replace(/\r\n/g, '\n')

  if (/^NODE_ENV=/m.test(normalized)) {
    return normalized.replace(/^NODE_ENV=.*$/m, productionLine)
  }

  if (/^#\s*NODE_ENV=.*$/m.test(normalized)) {
    return normalized.replace(/^#\s*NODE_ENV=.*$/m, productionLine)
  }

  return `${normalized.trimEnd()}\n${productionLine}\n`
}

async function bundleServer(outFile) {
  await build({
    entryPoints: [path.join(ROOT_DIR, 'backend', 'src', 'server.ts')],
    outfile: outFile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: [`node${NODE_MAJOR}`],
    legalComments: 'none',
    sourcemap: false,
    minify: false,
    tsconfig: path.join(ROOT_DIR, 'backend', 'tsconfig.json'),
  })
}

async function writeSeaConfig(configPath, mainPath, blobPath) {
  const config = {
    main: mainPath,
    output: blobPath,
    disableExperimentalSEAWarning: true,
    useSnapshot: false,
    useCodeCache: false,
    assets: {
      'runtime-bundle.json': RUNTIME_BUNDLE_PATH,
    },
  }

  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

function buildNodeDistUrl(archiveName) {
  return `${NODE_DIST_BASE_URL}/v${NODE_VERSION}/${archiveName}`
}

function escapePowerShellString(value) {
  return value.replaceAll("'", "''")
}

async function downloadIfNeeded(targetKey, archiveName) {
  const archivePath = path.join(CACHE_ROOT, archiveName)
  if (existsSync(archivePath)) {
    return archivePath
  }

  await fs.mkdir(CACHE_ROOT, { recursive: true })
  const url = buildNodeDistUrl(archiveName)
  console.log(`[sea:${targetKey}] downloading ${url}`)

  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`下载 Node 二进制失败: ${response.status} ${response.statusText}`)
  }

  const body = Buffer.from(await response.arrayBuffer())
  await fs.writeFile(archivePath, body)
  return archivePath
}

async function extractArchive(archivePath, targetDir) {
  if (archivePath.endsWith('.zip')) {
    // Windows 使用 PowerShell 解压，其他平台使用 unzip。
    if (process.platform === 'win32') {
      const command = `Expand-Archive -LiteralPath '${escapePowerShellString(archivePath)}' -DestinationPath '${escapePowerShellString(targetDir)}' -Force`
      execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          command,
        ],
        {
          cwd: ROOT_DIR,
          stdio: 'inherit',
        },
      )
    } else {
      execFileSync('unzip', ['-oq', archivePath, '-d', targetDir], {
        cwd: ROOT_DIR,
        stdio: 'inherit',
      })
    }
    return
  }

  execFileSync('tar', ['-xf', archivePath, '-C', targetDir], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  })
}

async function prepareBaseExecutable(targetKey, target, buildDir, releaseDir) {
  const archivePath = await downloadIfNeeded(targetKey, target.archiveName)
  const extractDir = path.join(buildDir, 'node-dist')
  await removeIfExists(extractDir)
  await fs.mkdir(extractDir, { recursive: true })
  await extractArchive(archivePath, extractDir)

  const sourceExecutable = path.join(extractDir, target.extractedExecutablePath)
  const outputExecutable = path.join(releaseDir, target.outputFileName)
  await fs.copyFile(sourceExecutable, outputExecutable)

  if (!target.isWindows) {
    await fs.chmod(outputExecutable, 0o755)
  }

  return outputExecutable
}

function runSeaConfig(configPath) {
  execFileSync(process.execPath, [`--experimental-sea-config=${configPath}`], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  })
}

function tryRemoveMacosSignature(executablePath) {
  try {
    execFileSync('codesign', ['--remove-signature', executablePath], {
      cwd: ROOT_DIR,
      stdio: 'ignore',
    })
  } catch {
    // 下载的 Node 可执行可能已经无签名，忽略即可。
  }
}

function signMacosExecutable(executablePath) {
  execFileSync('codesign', ['--sign', '-', '--force', executablePath], {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  })
}

function injectSeaBlob(target, executablePath, blobPath) {
  const args = [
    POSTJECT_CLI_PATH,
    executablePath,
    'NODE_SEA_BLOB',
    blobPath,
    '--sentinel-fuse',
    SEA_FUSE,
    '--overwrite',
    ...target.postjectArgs,
  ]

  if (target.isMacos) {
    tryRemoveMacosSignature(executablePath)
  }

  if (!existsSync(POSTJECT_CLI_PATH)) {
    throw new Error(`postject CLI 不存在: ${POSTJECT_CLI_PATH}`)
  }

  execFileSync(process.execPath, args, {
    cwd: ROOT_DIR,
    stdio: 'inherit',
  })

  if (target.isMacos) {
    signMacosExecutable(executablePath)
  }
}

async function prepareReleaseDir(releaseDir) {
  await removeIfExists(releaseDir)
  await fs.mkdir(path.join(releaseDir, '.lecquy', 'skills'), { recursive: true })
  const envExampleText = await fs.readFile(ENV_EXAMPLE_PATH, 'utf8')
  const releaseEnvText = buildReleaseEnvContent(envExampleText)
  await fs.writeFile(path.join(releaseDir, '.env'), releaseEnvText, 'utf8')
  await fs.copyFile(ENV_EXAMPLE_PATH, path.join(releaseDir, '.env.example'))
  await fs.copyFile(README_PATH, path.join(releaseDir, 'README.md'))

  await writeExecutableFile(
    path.join(releaseDir, 'start.sh'),
    [
      '#!/usr/bin/env sh',
      'set -eu',
      'SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
      'cd "$SCRIPT_DIR"',
      'if [ -x ./lecquy-macos-arm64 ]; then',
      '  exec ./lecquy-macos-arm64 "$@"',
      'fi',
      'if [ -x ./lecquy-linux-arm64 ]; then',
      '  exec ./lecquy-linux-arm64 "$@"',
      'fi',
      'echo "No Lecquy executable found in this directory." >&2',
      'exit 1',
      '',
    ].join('\n'),
  )

  await fs.writeFile(
    path.join(releaseDir, 'start.bat'),
    [
      '@echo off',
      'setlocal',
      'cd /d "%~dp0"',
      'lecquy-server.exe %*',
      'if errorlevel 1 pause',
      '',
    ].join('\r\n'),
    'utf8',
  )
}

async function prepareTarget(targetKey) {
  const target = TARGETS[targetKey]
  const buildDir = path.join(BUILD_ROOT, targetKey)
  const releaseDir = path.join(RELEASE_ROOT, targetKey)
  const bundledEntryPath = path.join(buildDir, 'server.cjs')
  const seaConfigPath = path.join(buildDir, 'sea-config.json')
  const seaBlobPath = path.join(buildDir, 'sea-prep.blob')

  await removeIfExists(buildDir)
  await fs.mkdir(buildDir, { recursive: true })
  await prepareReleaseDir(releaseDir)

  await bundleServer(bundledEntryPath)
  await writeSeaConfig(seaConfigPath, bundledEntryPath, seaBlobPath)
  runSeaConfig(seaConfigPath)

  const executablePath = await prepareBaseExecutable(targetKey, target, buildDir, releaseDir)
  injectSeaBlob(target, executablePath, seaBlobPath)

  const startupScriptPath = target.isWindows ? path.join(releaseDir, 'start.bat') : path.join(releaseDir, 'start.sh')
  if (target.isWindows) {
    await fs.rm(path.join(releaseDir, 'start.sh'), { force: true })
  } else {
    await fs.rm(path.join(releaseDir, 'start.bat'), { force: true })
  }

  console.log(
    `[sea:${targetKey}] ready at ${path.relative(ROOT_DIR, executablePath)} (${target.executableLabel}, launcher: ${path.relative(ROOT_DIR, startupScriptPath)})`,
  )
}

async function main() {
  const targets = resolveRequestedTargets(process.argv.slice(2))
  await ensureFile(RUNTIME_BUNDLE_PATH, 'runtime bundle')
  await ensureFile(ENV_EXAMPLE_PATH, '.env.example')
  await ensureFile(README_PATH, 'deploy README')

  console.log(`[sea] Node ${NODE_VERSION} on ${os.platform()} ${os.arch()}`)
  for (const targetKey of targets) {
    await prepareTarget(targetKey)
  }
}

await main()
