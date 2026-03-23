#!/usr/bin/env node

import { execFileSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const RELEASE_DIR = path.join(ROOT_DIR, 'release', 'portable')
const BACKEND_RELEASE_DIR = path.join(RELEASE_DIR, 'backend')
const RUNTIME_BUNDLE_FILE = path.join(ROOT_DIR, 'backend', 'runtime-bundle.json')

async function removeIfExists(targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true })
}

async function stripDeploymentArtifacts(distDir) {
  const entries = await fs.readdir(distDir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(distDir, entry.name)
    if (entry.isDirectory()) {
      await stripDeploymentArtifacts(fullPath)
      continue
    }
    if (entry.name.endsWith('.map') || entry.name.endsWith('.d.ts')) {
      await fs.rm(fullPath, { force: true })
    }
  }
}

async function writeExecutableFile(filePath, content) {
  await fs.writeFile(filePath, content, 'utf8')
  await fs.chmod(filePath, 0o755)
}

async function main() {
  await fs.rm(RELEASE_DIR, { recursive: true, force: true })
  await fs.mkdir(RELEASE_DIR, { recursive: true })

  execFileSync(
    'pnpm',
    ['--filter', '@webclaw/backend', '--prod', 'deploy', '--legacy', BACKEND_RELEASE_DIR],
    { cwd: ROOT_DIR, stdio: 'inherit' },
  )

  await fs.copyFile(RUNTIME_BUNDLE_FILE, path.join(BACKEND_RELEASE_DIR, 'runtime-bundle.json'))
  await fs.copyFile(path.join(ROOT_DIR, '.env.example'), path.join(RELEASE_DIR, '.env.example'))
  await fs.copyFile(path.join(ROOT_DIR, 'deploy', 'PORTABLE-RELEASE.md'), path.join(RELEASE_DIR, 'README.md'))
  await fs.mkdir(path.join(RELEASE_DIR, '.ZxhClaw', 'skills'), { recursive: true })
  await stripDeploymentArtifacts(path.join(BACKEND_RELEASE_DIR, 'dist'))
  await removeIfExists(path.join(BACKEND_RELEASE_DIR, 'src'))
  await removeIfExists(path.join(BACKEND_RELEASE_DIR, 'skills'))
  await removeIfExists(path.join(BACKEND_RELEASE_DIR, '.env'))
  await removeIfExists(path.join(BACKEND_RELEASE_DIR, 'AGENTS.md'))
  await removeIfExists(path.join(BACKEND_RELEASE_DIR, 'tsconfig.json'))

  await writeExecutableFile(
    path.join(RELEASE_DIR, 'start.sh'),
    [
      '#!/usr/bin/env sh',
      'set -eu',
      'SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"',
      'cd "$SCRIPT_DIR"',
      'exec node backend/dist/server.js',
      '',
    ].join('\n'),
  )

  await fs.writeFile(
    path.join(RELEASE_DIR, 'start.bat'),
    [
      '@echo off',
      'setlocal',
      'cd /d "%~dp0"',
      'node backend\\dist\\server.js',
      '',
    ].join('\r\n'),
    'utf8',
  )

  console.log(`[portable] release prepared at ${path.relative(ROOT_DIR, RELEASE_DIR)}`)
}

await main()
