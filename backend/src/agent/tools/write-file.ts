/**
 * WriteFile 工具 — 写入/创建文件
 */

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname } from 'node:path'
import { Type } from '@sinclair/typebox'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import type { GeneratedFileArtifact } from '@webclaw/shared'
import { TOOL_OUTPUT_LIMIT } from '../types.js'
import {
  GENERATED_ARTIFACT_DOCS_DIR,
  normalizeWorkspaceRelativePath,
  resolvePathWithinRoot,
  resolveWorkspaceRoot,
} from '../../core/runtime-paths.js'

/** 工作空间根目录 */
const PROJECT_ROOT = resolveWorkspaceRoot()
const DEFAULT_ARTIFACT_EXTENSIONS = new Set([
  '.html',
  '.htm',
  '.md',
  '.markdown',
  '.txt',
  '.json',
  '.csv',
])

/** 确保路径保持在工作空间内 */
function safePath(p: string): string {
  return resolvePathWithinRoot(PROJECT_ROOT, p)
}

function resolveOutputPath(filePath: string): { outputPath: string; defaulted: boolean } {
  const normalized = normalizeWorkspaceRelativePath(filePath)
  if (!normalized) {
    throw new Error('file_path 不能为空')
  }

  const hasExplicitDirectory = normalized.includes('/')
  const extension = extname(normalized).toLowerCase()
  if (!hasExplicitDirectory && DEFAULT_ARTIFACT_EXTENSIONS.has(extension)) {
    return {
      outputPath: `${GENERATED_ARTIFACT_DOCS_DIR}/${basename(normalized)}`,
      defaulted: true,
    }
  }

  return {
    outputPath: normalized,
    defaulted: false,
  }
}

function isDisplayableArtifact(filePath: string): boolean {
  const normalized = normalizeWorkspaceRelativePath(filePath)
  return normalized === GENERATED_ARTIFACT_DOCS_DIR || normalized.startsWith(`${GENERATED_ARTIFACT_DOCS_DIR}/`)
}

function inferMimeType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.html':
    case '.htm':
      return 'text/html'
    case '.md':
    case '.markdown':
      return 'text/markdown'
    case '.json':
      return 'application/json'
    case '.csv':
      return 'text/csv'
    case '.xml':
      return 'application/xml'
    case '.css':
      return 'text/css'
    case '.js':
      return 'text/javascript'
    default:
      return 'text/plain'
  }
}

function createGeneratedFileArtifact(filePath: string, fullPath: string, timestamp: number): GeneratedFileArtifact {
  const stats = statSync(fullPath)
  return {
    artifactId: `artifact_${timestamp}_${randomUUID().slice(0, 8)}`,
    filePath,
    name: basename(filePath),
    mimeType: inferMimeType(filePath),
    size: stats.size,
    createdAt: timestamp,
    updatedAt: stats.mtimeMs || timestamp,
  }
}

export function createWriteFileTool(): AgentTool<typeof parameters> {
  return {
    name: 'write_file',
    label: '写入文件',
    description: '写入或创建文件内容（覆盖写入）。生成给用户查看的文档默认应写入 .ZxhClaw/artifacts/docs/。',
    parameters,
    execute: async (_toolCallId, params): Promise<AgentToolResult<Record<string, unknown>>> => {
      try {
        const target = resolveOutputPath(params.file_path)
        const fullPath = safePath(target.outputPath)
        const existedBeforeWrite = existsSync(fullPath)
        mkdirSync(dirname(fullPath), { recursive: true })
        writeFileSync(fullPath, params.content ?? '', 'utf-8')

        const timestamp = Date.now()
        const generatedFiles = isDisplayableArtifact(target.outputPath)
          ? [createGeneratedFileArtifact(target.outputPath, fullPath, timestamp)]
          : []
        const writeMode = existedBeforeWrite ? 'updated' : 'created'
        const summary = `${target.defaulted ? '已按默认产物策略写入' : '已写入'} ${target.outputPath}（${(params.content ?? '').length} 字符）`
        return {
          content: [{ type: 'text', text: summary.slice(0, TOOL_OUTPUT_LIMIT) }],
          details: {
            requestedPath: normalizeWorkspaceRelativePath(params.file_path),
            outputPath: target.outputPath,
            outputStrategy: target.defaulted ? 'default_artifact_docs' : 'explicit_path',
            writeMode,
            generatedFiles,
          },
        }
      } catch (error) {
        const text = `错误: ${error instanceof Error ? error.message : String(error)}`
        return { content: [{ type: 'text', text: text.slice(0, TOOL_OUTPUT_LIMIT) }], details: {} }
      }
    },
  }
}

const parameters = Type.Object({
  file_path: Type.String({ description: '目标文件路径（相对于工作目录）' }),
  content: Type.String({ description: '文件内容（覆盖写入）' }),
})
