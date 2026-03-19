/**
 * EditFile 工具 — 精确替换文件内容
 */

import { readFileSync, writeFileSync } from 'node:fs'
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

export function createEditFileTool(): AgentTool<typeof parameters> {
  return {
    name: 'edit_file',
    label: '编辑文件',
    description: '精确替换文件中唯一匹配的文本片段。',
    parameters,
    execute: async (_toolCallId, params): Promise<AgentToolResult<Record<string, never>>> => {
      try {
        if (!params.old_string) {
          throw new Error('old_string 不能为空')
        }

        const fullPath = safePath(params.file_path)
        const content = readFileSync(fullPath, 'utf-8')
        const occurrences = content.split(params.old_string).length - 1

        if (occurrences === 0) {
          throw new Error('未找到要替换的原文本')
        }
        if (occurrences > 1) {
          throw new Error(`原文本匹配到 ${occurrences} 处，请提供更精确的 old_string`)
        }

        const updated = content.replace(params.old_string, params.new_string)
        writeFileSync(fullPath, updated, 'utf-8')

        const summary = `已更新 ${params.file_path}（替换 1 处）`
        return { content: [{ type: 'text', text: summary.slice(0, TOOL_OUTPUT_LIMIT) }], details: {} }
      } catch (error) {
        const text = `错误: ${error instanceof Error ? error.message : String(error)}`
        return { content: [{ type: 'text', text: text.slice(0, TOOL_OUTPUT_LIMIT) }], details: {} }
      }
    },
  }
}

const parameters = Type.Object({
  file_path: Type.String({ description: '目标文件路径（相对于工作目录）' }),
  old_string: Type.String({ description: '要替换的原文本（需唯一匹配）' }),
  new_string: Type.String({ description: '替换后的新文本' }),
})
