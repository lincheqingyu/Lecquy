import path from 'node:path'
import { promises as fs } from 'node:fs'
import { STARTUP_BUDGETS } from '../core/prompts/prompt-layer-types.js'
import { estimateTokens } from '../core/prompts/prompt-serializer.js'
import { logger } from '../utils/logger.js'
import {
  ensurePromptContextFiles,
  getMemoryFileDisplayName,
  resolvePromptContextPaths,
} from '../core/prompts/context-files.js'

export function getMemoryDir(workspaceDir?: string): string {
  return resolvePromptContextPaths(workspaceDir).memoryDir
}

export function getMainMemoryFilePath(workspaceDir?: string): string {
  return resolvePromptContextPaths(workspaceDir).memoryFile
}

function formatDate(date = new Date()): string {
  const yyyy = String(date.getFullYear())
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export function getDailyMemoryFilePath(date = new Date()): string {
  return path.join(getMemoryDir(), `memory-${formatDate(date)}.md`)
}

function isMemoryFileName(name: string): boolean {
  return name === 'MEMORY.md' || /^memory\/memory-\d{4}-\d{2}-\d{2}\.md$/.test(name)
}

async function readTextIfExists(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return ''
  }
}

function truncateToBudget(content: string, tokenBudget: number): string {
  const normalized = content
  if (!normalized || estimateTokens(normalized) <= tokenBudget) {
    return normalized
  }

  const maxChars = Math.floor(tokenBudget * 3.5)
  let truncated = normalized.slice(0, maxChars)
  while (truncated && estimateTokens(truncated) > tokenBudget) {
    truncated = truncated.slice(0, -1)
  }
  return truncated
}

export async function ensureMemoryFiles(workspaceDir?: string): Promise<void> {
  const paths = await ensurePromptContextFiles(workspaceDir)
  await fs.mkdir(paths.memoryDir, { recursive: true })
  try {
    await fs.access(paths.memoryFile)
  } catch {
    await fs.writeFile(paths.memoryFile, '', 'utf8')
  }
}

export async function appendDailyMemoryEntry(entry: string): Promise<void> {
  if (!entry.trim()) return
  await ensureMemoryFiles()
  const dailyPath = getDailyMemoryFilePath()
  const timestamp = new Date().toISOString()
  const block = `\n## ${timestamp}\n\n${entry.trim()}\n`
  await fs.appendFile(dailyPath, block, 'utf8')
}

export async function loadMemorySummary(workspaceDir: string): Promise<string> {
  const summaryPath = resolvePromptContextPaths(workspaceDir).memorySummaryFile
  const content = await readTextIfExists(summaryPath)
  if (!content) {
    return ''
  }

  return truncateToBudget(content, STARTUP_BUDGETS.memorySummary)
}

export async function loadMemoryInjectionText(workspaceDir?: string): Promise<string> {
  await ensureMemoryFiles(workspaceDir)

  const mainText = await readTextIfExists(getMainMemoryFilePath(workspaceDir))
  const memoryDir = getMemoryDir(workspaceDir)
  const todayPath = path.join(memoryDir, `memory-${formatDate(new Date())}.md`)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayPath = path.join(memoryDir, `memory-${formatDate(yesterday)}.md`)

  const todayText = await readTextIfExists(todayPath)
  const yesterdayText = await readTextIfExists(yesterdayPath)

  const sections: string[] = []
  if (mainText.trim()) {
    sections.push(`## MEMORY.md\n\n${mainText.trim()}`)
  }
  if (todayText.trim()) {
    sections.push(`## ${path.basename(todayPath)}\n\n${todayText.trim()}`)
  }
  if (yesterdayText.trim()) {
    sections.push(`## ${path.basename(yesterdayPath)}\n\n${yesterdayText.trim()}`)
  }

  if (sections.length === 0) return ''

  const text = [
    '## Memory Recall',
    '以下是可用于回答的已保存记忆，请优先保持一致性：',
    '',
    ...sections,
  ].join('\n')

  logger.debug(`memory 注入完成: sections=${sections.length}`)
  return text
}

export interface MemoryFileMeta {
  name: string
  size: number
  updatedAt: string
}

export async function listMemoryFiles(): Promise<MemoryFileMeta[]> {
  await ensureMemoryFiles()
  const paths = resolvePromptContextPaths()
  const files: MemoryFileMeta[] = []

  const mainStat = await fs.stat(paths.memoryFile).catch(() => null)
  if (mainStat) {
    files.push({
      name: 'MEMORY.md',
      size: mainStat.size,
      updatedAt: mainStat.mtime.toISOString(),
    })
  }

  const entries = await fs.readdir(paths.memoryDir, { withFileTypes: true }).catch(() => [])
  const dailyFiles = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && /^memory-\d{4}-\d{2}-\d{2}\.md$/.test(entry.name))
      .map(async (entry) => {
        const fullPath = path.join(paths.memoryDir, entry.name)
        const stat = await fs.stat(fullPath)
        return {
          name: getMemoryFileDisplayName(fullPath),
          size: stat.size,
          updatedAt: stat.mtime.toISOString(),
        }
      }),
  )

  files.push(...dailyFiles)

  return files.sort((a, b) => {
    if (a.name === 'MEMORY.md') return -1
    if (b.name === 'MEMORY.md') return 1
    return b.name.localeCompare(a.name)
  })
}

export async function readMemoryFile(name: string): Promise<string> {
  await ensureMemoryFiles()
  if (!isMemoryFileName(name)) {
    throw new Error('非法记忆文件名')
  }
  const paths = resolvePromptContextPaths()
  const fullPath = name === 'MEMORY.md'
    ? paths.memoryFile
    : path.join(paths.rootDir, name)
  const normalized = path.normalize(fullPath)
  if (!normalized.startsWith(path.normalize(paths.rootDir))) {
    throw new Error('非法文件路径')
  }
  return await fs.readFile(normalized, 'utf8')
}
