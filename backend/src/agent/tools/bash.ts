/**
 * Bash 工具 — 运行 shell 命令
 */

import { execSync } from 'node:child_process'
import { Type } from '@sinclair/typebox'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { TOOL_OUTPUT_LIMIT } from '../types.js'

/** 工作空间根目录 */
const PROJECT_ROOT = process.cwd()

/** 创建 bash 工具 */
export function createBashTool(): AgentTool<typeof parameters> {
  return {
    name: 'bash',
    label: '运行 Shell 命令',
    description: '运行 shell 命令。',
    parameters,
    execute: async (_toolCallId, params): Promise<AgentToolResult<Record<string, never>>> => {
      try {
        const output = execSync(params.command, {
          cwd: PROJECT_ROOT,
          timeout: 120_000,
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        const text = (output || '(无输出)').slice(0, TOOL_OUTPUT_LIMIT)
        return { content: [{ type: 'text', text }], details: {} }
      } catch (error) {
        const isTimeout = error instanceof Error && 'killed' in error && (error as { killed?: boolean }).killed
        const text = isTimeout
          ? '错误: 命令执行超时（120秒）'
          : `错误: ${error instanceof Error ? error.message : String(error)}`
        return { content: [{ type: 'text', text }], details: {} }
      }
    },
  }
}

const parameters = Type.Object({
  command: Type.String({ description: '要执行的 shell 命令' }),
})
