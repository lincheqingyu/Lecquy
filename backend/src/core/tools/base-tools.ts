/**
 * 基础工具定义
 * 对应源码: core/tools/base_tools.py
 */

import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { tool } from '@langchain/core/tools'
import { z } from 'zod'

/** 工作空间根目录 */
const PROJECT_ROOT = process.cwd()

/** 确保路径保持在工作空间内 */
export function safePath(p: string): string {
  const resolved = resolve(PROJECT_ROOT, p)
  if (!resolved.startsWith(PROJECT_ROOT)) {
    throw new Error(`路径逃逸工作空间: ${p}`)
  }
  return resolved
}

/** 运行 shell 命令 */
export const bash = tool(
  async ({ command }: { command: string }): Promise<string> => {
    try {
      const output = execSync(command, {
        cwd: PROJECT_ROOT,
        timeout: 120_000,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      return output.slice(0, 50_000) || '(无输出)'
    } catch (error) {
      if (error instanceof Error && 'killed' in error) {
        return '错误: 命令执行超时（120秒）'
      }
      return `错误: ${error instanceof Error ? error.message : String(error)}`
    }
  },
  {
    name: 'bash',
    description: '运行 shell 命令。',
    schema: z.object({
      command: z.string().describe('要执行的 shell 命令'),
    }),
  },
)

/** 读取文件内容 */
export const readFile = tool(
  async ({ path, limit }: { path: string; limit?: number }): Promise<string> => {
    try {
      const fullPath = safePath(path)
      const content = readFileSync(fullPath, 'utf-8')
      const lines = content.split('\n')
      const outputLines = limit ? lines.slice(0, limit) : lines
      return outputLines.join('\n').slice(0, 50_000)
    } catch (error) {
      return `错误: ${error instanceof Error ? error.message : String(error)}`
    }
  },
  {
    name: 'read_file',
    description: '读取文件内容。',
    schema: z.object({
      path: z.string().describe('文件路径（相对于工作目录）'),
      limit: z.number().int().optional().describe('读取行数限制'),
    }),
  },
)
