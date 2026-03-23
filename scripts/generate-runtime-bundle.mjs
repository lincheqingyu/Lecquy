#!/usr/bin/env node

import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT_DIR = path.resolve(__dirname, '..')
const FRONTEND_DIST_DIR = path.join(ROOT_DIR, 'frontend', 'dist')
const SKILLS_DIR = path.join(ROOT_DIR, 'backend', 'skills')
const OUTPUT_FILE = path.join(ROOT_DIR, 'backend', 'runtime-bundle.json')

const TEXT_FILE_EXTENSIONS = new Set([
  '.md',
  '.txt',
  '.json',
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.jsx',
  '.css',
  '.html',
  '.htm',
  '.svg',
  '.sh',
  '.py',
  '.yaml',
  '.yml',
])

const CONTENT_TYPE_BY_EXTENSION = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
} 

async function walkFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(fullPath)))
      continue
    }
    if (entry.isFile()) {
      files.push(fullPath)
    }
  }

  return files.sort()
}

function getContentType(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  return CONTENT_TYPE_BY_EXTENSION[extension] ?? 'application/octet-stream'
}

function toFrontendAssetPath(fullPath) {
  const relative = path.relative(FRONTEND_DIST_DIR, fullPath).replace(/\\/g, '/')
  return `/${relative}`
}

function toSkillBundlePath(fullPath) {
  return path.relative(SKILLS_DIR, fullPath).replace(/\\/g, '/')
}

function toTextAsset(buffer, filePath) {
  const extension = path.extname(filePath).toLowerCase()
  if (TEXT_FILE_EXTENSIONS.has(extension) || path.basename(filePath) === 'SKILL.md') {
    return buffer.toString('utf8')
  }
  return ''
}

async function buildFrontendBundle() {
  const files = await walkFiles(FRONTEND_DIST_DIR)
  const frontend = {}

  for (const fullPath of files) {
    const buffer = await fs.readFile(fullPath)
    const hash = crypto.createHash('sha256').update(buffer).digest('hex').slice(0, 16)
    frontend[toFrontendAssetPath(fullPath)] = {
      contentType: getContentType(fullPath),
      contentBase64: buffer.toString('base64'),
      etag: `"${hash}"`,
    }
  }

  return { files, frontend }
}

async function buildSkillsBundle() {
  try {
    const files = await walkFiles(SKILLS_DIR)
    const skills = {}

    for (const fullPath of files) {
      skills[toSkillBundlePath(fullPath)] = toTextAsset(await fs.readFile(fullPath), fullPath)
    }

    return { files, skills }
  } catch {
    return { files: [], skills: {} }
  }
}

async function main() {
  try {
    await fs.access(FRONTEND_DIST_DIR)
  } catch {
    console.error(`[bundle] missing frontend dist: ${FRONTEND_DIST_DIR}`)
    process.exit(1)
  }

  const [{ files: frontendFiles, frontend }, { files: skillFiles, skills }] = await Promise.all([
    buildFrontendBundle(),
    buildSkillsBundle(),
  ])

  const bundle = {
    version: 1,
    generatedAt: new Date().toISOString(),
    frontend,
    skills,
  }

  await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true })
  await fs.writeFile(OUTPUT_FILE, `${JSON.stringify(bundle)}\n`, 'utf8')

  console.log(
    `[bundle] wrote ${path.relative(ROOT_DIR, OUTPUT_FILE)} with ${frontendFiles.length} frontend files and ${skillFiles.length} skill files`,
  )
}

await main()
