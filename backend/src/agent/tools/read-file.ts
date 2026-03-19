/**
 * ReadFile 工具 — 读取文件内容
 */

import { readFileSync } from 'node:fs'
import { Type } from '@sinclair/typebox'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { TOOL_OUTPUT_LIMIT } from '../types.js'
import { resolvePathWithinRoot, resolveWorkspaceRoot } from '../../core/runtime-paths.js'

/** 工作空间根目录 */
const PROJECT_ROOT = resolveWorkspaceRoot()

/** 确保路径保持在工作空间内 */
function safePath(p: string): string {
  return resolvePathWithinRoot(PROJECT_ROOT, p)
}

/** 创建 read_file 工具 */
export function createReadFileTool(): AgentTool<typeof parameters> {
  return {
    name: 'read_file',
    label: '读取文件',
    description: '读取文件内容。',
    parameters,
    execute: async (_toolCallId, params): Promise<AgentToolResult<Record<string, never>>> => {
      try {
        const fullPath = safePath(params.path)
        const content = readFileSync(fullPath, 'utf-8')
        const lines = content.split('\n')
        const outputLines = params.limit ? lines.slice(0, params.limit) : lines
        const text = outputLines.join('\n').slice(0, TOOL_OUTPUT_LIMIT)
        return { content: [{ type: 'text', text }], details: {} }
      } catch (error) {
        const text = `错误: ${error instanceof Error ? error.message : String(error)}`
        return { content: [{ type: 'text', text }], details: {} }
      }
    },
  }
}

const parameters = Type.Object({
  path: Type.String({ description: '文件路径（相对于工作目录）' }),
  limit: Type.Optional(Type.Number({ description: '读取行数限制' })),
})
