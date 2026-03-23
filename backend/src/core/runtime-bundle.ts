import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { getAsset, isSea } from 'node:sea'
import { resolveWorkspaceRoot } from './runtime-paths.js'

export interface BundledFrontendAsset {
  readonly contentType: string
  readonly contentBase64: string
  readonly etag?: string
}

export interface RuntimeBundle {
  readonly version: 1
  readonly generatedAt: string
  readonly frontend: Readonly<Record<string, BundledFrontendAsset>>
  readonly skills: Readonly<Record<string, string>>
}

const EMPTY_BUNDLE: RuntimeBundle = {
  version: 1,
  generatedAt: '',
  frontend: {},
  skills: {},
}

let cachedBundle: RuntimeBundle | null = null

function readSeaAssetText(assetName: string): string | null {
  if (!isSea()) return null
  const asset = getAsset(assetName)
  if (typeof asset === 'string') {
    return asset
  }
  return Buffer.from(asset as ArrayBuffer).toString('utf8')
}

function resolveBundleFilePath(): string | null {
  const overridePath = process.env.WEBCLAW_RUNTIME_BUNDLE?.trim()
  if (overridePath) {
    return path.resolve(overridePath)
  }
  const defaultBundlePath = path.join(resolveWorkspaceRoot(), 'backend', 'runtime-bundle.json')
  return existsSync(defaultBundlePath) ? defaultBundlePath : null
}

function loadBundle(): RuntimeBundle {
  try {
    const seaText = readSeaAssetText('runtime-bundle.json')
    if (seaText) {
      return validateBundle(JSON.parse(seaText))
    }

    const bundlePath = resolveBundleFilePath()
    if (!bundlePath) {
      return EMPTY_BUNDLE
    }

    const fileText = readFileSync(bundlePath, 'utf8')
    return validateBundle(JSON.parse(fileText))
  } catch {
    return EMPTY_BUNDLE
  }
}

function validateBundle(input: unknown): RuntimeBundle {
  if (!input || typeof input !== 'object') {
    return EMPTY_BUNDLE
  }

  const candidate = input as {
    version?: unknown
    generatedAt?: unknown
    frontend?: unknown
    skills?: unknown
  }

  const frontendEntries = Object.entries(candidate.frontend ?? {}).filter(
    (entry): entry is [string, BundledFrontendAsset] =>
      typeof entry[0] === 'string' &&
      !!entry[1] &&
      typeof entry[1] === 'object' &&
      typeof entry[1].contentType === 'string' &&
      typeof entry[1].contentBase64 === 'string',
  )

  const skillEntries = Object.entries(candidate.skills ?? {}).filter(
    (entry): entry is [string, string] => typeof entry[0] === 'string' && typeof entry[1] === 'string',
  )

  return {
    version: 1,
    generatedAt: typeof candidate.generatedAt === 'string' ? candidate.generatedAt : '',
    frontend: Object.fromEntries(frontendEntries),
    skills: Object.fromEntries(skillEntries),
  }
}

function normalizeFrontendAssetPath(filePath: string): string {
  const cleanPath = filePath.split('?')[0]?.split('#')[0] ?? filePath
  const normalized = cleanPath.replace(/\\/g, '/')
  if (normalized === '' || normalized === '/') {
    return '/index.html'
  }
  return normalized.startsWith('/') ? normalized : `/${normalized}`
}

export function getRuntimeBundle(): RuntimeBundle {
  if (cachedBundle === null) {
    cachedBundle = loadBundle()
  }
  return cachedBundle
}

export function resetRuntimeBundleCache(): void {
  cachedBundle = null
}

export function hasBundledFrontendAssets(): boolean {
  return Object.keys(getRuntimeBundle().frontend).length > 0
}

export function getBundledFrontendAsset(requestPath: string): BundledFrontendAsset | null {
  const bundle = getRuntimeBundle()
  const normalized = normalizeFrontendAssetPath(requestPath)
  const direct = bundle.frontend[normalized]
  if (direct) {
    return direct
  }

  if (!path.posix.extname(normalized)) {
    return bundle.frontend['/index.html'] ?? null
  }

  return null
}

export function listBundledSkillFiles(): Readonly<Record<string, string>> {
  return getRuntimeBundle().skills
}
