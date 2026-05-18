// 中文：本文件（bash.ts）位于 backend/src/agent/tools/bash.ts，属于backend链路中的agent 编排与工具链代码，连接上游调用方与下游执行逻辑。
// English: This file (bash.ts) belongs to the backend agent 编排与工具链 layer in backend/src/agent/tools/bash.ts, wiring upstream callers with downstream runtime logic.

/**
 * Bash 工具 — 运行 shell 命令
 */

import { Type } from '@sinclair/typebox'
import type { AgentTool, AgentToolResult } from '@mariozechner/pi-agent-core'
import { TOOL_OUTPUT_LIMIT } from '../types.js'
import { resolveWorkspaceRoot } from '../../core/runtime-paths.js'
import { ChildProcessSandbox } from '../../runtime/permissions/sandbox-adapter.js'

/** 工作空间根目录 */
const PROJECT_ROOT = resolveWorkspaceRoot()
const DEFAULT_TIMEOUT_MS = 120_000

interface BashToolOptions {
  timeoutMs?: number
}

function formatTimeout(timeoutMs: number): string {
  return timeoutMs % 1000 === 0 ? `${timeoutMs / 1000}秒` : `${timeoutMs}ms`
}

function truncate(text: string): string {
  return text.slice(0, TOOL_OUTPUT_LIMIT)
}

/** 创建 bash 工具 */
export function createBashTool(options: BashToolOptions = {}): AgentTool<typeof parameters> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const sandbox = new ChildProcessSandbox({ workspaceDir: PROJECT_ROOT })

  return {
    name: 'bash',
    label: '运行 Shell 命令',
    description: '运行 shell 命令。',
    parameters,
    execute: async (_toolCallId, params, signal): Promise<AgentToolResult<Record<string, never>>> => {
      try {
        const result = await sandbox.execute({
          command: params.command,
          cwd: PROJECT_ROOT,
          timeoutMs,
          signal,
        })

        if (result.timedOut) {
          const text = `错误: 命令执行超时（${formatTimeout(timeoutMs)}）`
          return { content: [{ type: 'text', text }], details: {} }
        }

        if (result.exitCode !== 0) {
          const reason = result.exitCode === null
            ? `信号 ${result.signal ?? 'unknown'}`
            : `退出码 ${result.exitCode}`
          const stderr = result.stderr.trim()
          const stdout = result.stdout.trim()
          const output = [
            `错误: 命令执行失败（${reason}）`,
            stderr ? `stderr:\n${stderr}` : '',
            stdout ? `stdout:\n${stdout}` : '',
          ].filter(Boolean).join('\n\n')
          return { content: [{ type: 'text', text: truncate(output) }], details: {} }
        }

        const text = truncate(result.stdout || '(无输出)')
        return { content: [{ type: 'text', text }], details: {} }
      } catch (error) {
        const text = `错误: ${error instanceof Error ? error.message : String(error)}`
        return { content: [{ type: 'text', text: truncate(text) }], details: {} }
      }
    },
  }
}

const parameters = Type.Object({
  command: Type.String({ description: '要执行的 shell 命令' }),
})
