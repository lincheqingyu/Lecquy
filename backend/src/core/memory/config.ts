// 中文：本文件（config.ts）位于 backend/src/core/memory/config.ts，属于backend链路中的核心运行时与配置代码，连接上游调用方与下游执行逻辑。
// English: This file (config.ts) belongs to the backend 核心运行时与配置 layer in backend/src/core/memory/config.ts, wiring upstream callers with downstream runtime logic.

import path from 'node:path'
import { promises as fs } from 'node:fs'
import { ensureMemoryConfigLocation, resolvePromptContextPaths } from '../prompts/context-files.js'

export interface MemoryConfig {
  flushTurns: number
  embeddingBaseUrl: string
}

const DEFAULT_MEMORY_CONFIG: MemoryConfig = {
  flushTurns: 20,
  embeddingBaseUrl: '',
}

let cachedConfig: MemoryConfig | null = null

function normalizeConfig(input: Partial<MemoryConfig> | null | undefined): MemoryConfig {
  return {
    flushTurns:
      typeof input?.flushTurns === 'number' && Number.isFinite(input.flushTurns) && input.flushTurns > 0
        ? Math.floor(input.flushTurns)
        : DEFAULT_MEMORY_CONFIG.flushTurns,
    embeddingBaseUrl: typeof input?.embeddingBaseUrl === 'string' ? input.embeddingBaseUrl.trim() : '',
  }
}

async function ensureMemoryDir(): Promise<void> {
  const paths = await ensureMemoryConfigLocation()
  await fs.mkdir(path.dirname(paths.memoryConfigFile), { recursive: true })
}

export async function getMemoryConfig(): Promise<MemoryConfig> {
  if (cachedConfig) return cachedConfig
  const { memoryConfigFile } = await ensureMemoryConfigLocation()
  try {
    const raw = await fs.readFile(memoryConfigFile, 'utf8')
    const parsed = JSON.parse(raw) as Partial<MemoryConfig>
    cachedConfig = normalizeConfig(parsed)
    return cachedConfig
  } catch {
    cachedConfig = { ...DEFAULT_MEMORY_CONFIG }
    return cachedConfig
  }
}

export async function saveMemoryConfig(patch: Partial<MemoryConfig>): Promise<MemoryConfig> {
  const current = await getMemoryConfig()
  const next = normalizeConfig({ ...current, ...patch })
  await ensureMemoryDir()
  const { memoryConfigFile } = resolvePromptContextPaths()
  await fs.writeFile(memoryConfigFile, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  cachedConfig = next
  return next
}

export function resetMemoryConfigCache(): void {
  cachedConfig = null
}
