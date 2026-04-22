/**
 * 沙箱适配器
 *
 * 参考 Claude Code `utils/sandbox/sandbox-adapter.ts` 的接口设计，
 * 但 Lecquy 的 MVP 版本不做 Linux namespace / seccomp，而是依赖：
 *   - child_process.spawn 提供进程级隔离
 *   - cwd 强制限定在工作区
 *   - 超时 (timeout) 和输出长度限制 (maxBuffer)
 *   - 环境变量白名单（避免继承宿主的 TOKEN / SECRET）
 *   - 信号 `AbortSignal` 支持，保证用户随时能终止
 *
 * 后续可通过实现同一 `SandboxAdapter` 接口接入 Firejail、bubblewrap、
 * Docker、gVisor 等真正的隔离方案，不修改调用方代码。
 */

import { spawn } from 'node:child_process'
import path from 'node:path'

import type { PermissionCheckContext } from './types.js'

export interface SandboxExecOptions {
  /** 要执行的 shell 命令字符串。 */
  command: string
  /** 工作目录（会被强制限定在工作区根内）。 */
  cwd: string
  /** 超时毫秒数，默认 120_000。 */
  timeoutMs?: number
  /** stdout/stderr 最大字节数，默认 1 MB。 */
  maxBuffer?: number
  /** 额外环境变量（在白名单基础上增补）。 */
  env?: Record<string, string>
  /** 中止信号。 */
  signal?: AbortSignal
}

export interface SandboxExecResult {
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  timedOut: boolean
  durationMs: number
}

/**
 * 沙箱执行接口。
 */
export interface SandboxAdapter {
  readonly name: string
  execute(options: SandboxExecOptions): Promise<SandboxExecResult>
  /**
   * 给上层一个机会在进入沙箱前再做一次决策验证（可选）。
   */
  verify?(context: PermissionCheckContext): Promise<void>
}

/**
 * 默认环境变量白名单。
 * AI 执行的命令不应该继承 DB_PASSWORD / API_KEY 这类秘密；
 * 只放行执行普通命令所需的最小集合。
 */
export const DEFAULT_ENV_WHITELIST: readonly string[] = [
  'PATH',
  'HOME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'SHELL',
  'USER',
  'LOGNAME',
  'PWD',
  'TMPDIR',
  'TEMP',
  'TMP',
  'SystemRoot', // Windows
  'SYSTEMROOT',
  'ComSpec',
  'PATHEXT',
]

/**
 * 在可用环境变量中过滤出白名单。
 */
export function buildSandboxedEnv(
  extra: Record<string, string> | undefined,
  whitelist: readonly string[] = DEFAULT_ENV_WHITELIST,
): NodeJS.ProcessEnv {
  const base = process.env
  const result: NodeJS.ProcessEnv = {}
  for (const key of whitelist) {
    if (base[key] !== undefined) result[key] = base[key]
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      result[key] = value
    }
  }
  return result
}

/**
 * 基于 child_process 的轻量沙箱实现。
 */
export class ChildProcessSandbox implements SandboxAdapter {
  readonly name = 'child-process-sandbox'

  private readonly workspaceDir: string
  private readonly envWhitelist: readonly string[]

  constructor(options: {
    workspaceDir: string
    envWhitelist?: readonly string[]
  }) {
    this.workspaceDir = path.resolve(options.workspaceDir)
    this.envWhitelist = options.envWhitelist ?? DEFAULT_ENV_WHITELIST
  }

  async execute(options: SandboxExecOptions): Promise<SandboxExecResult> {
    const {
      command,
      cwd,
      timeoutMs = 120_000,
      maxBuffer = 1024 * 1024,
      env,
      signal,
    } = options

    const resolvedCwd = this.resolveCwd(cwd)
    const env2 = buildSandboxedEnv(env, this.envWhitelist)
    const start = Date.now()

    return await new Promise<SandboxExecResult>((resolve, reject) => {
      const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh'
      const args = process.platform === 'win32' ? ['/c', command] : ['-c', command]

      const child = spawn(shell, args, {
        cwd: resolvedCwd,
        env: env2,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''
      let outLen = 0
      let errLen = 0
      let overflow = false
      let timedOut = false
      let aborted = false

      const onAbort = () => {
        aborted = true
        child.kill('SIGTERM')
      }
      if (signal) {
        if (signal.aborted) {
          child.kill('SIGKILL')
          return resolve({
            exitCode: null,
            signal: 'SIGKILL',
            stdout: '',
            stderr: '',
            timedOut: false,
            durationMs: Date.now() - start,
          })
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }

      const timer = setTimeout(() => {
        timedOut = true
        child.kill('SIGTERM')
        // 兜底：2 秒后仍未退出就 SIGKILL
        setTimeout(() => {
          if (!child.killed) child.kill('SIGKILL')
        }, 2000).unref()
      }, timeoutMs)

      child.stdout?.on('data', (chunk: Buffer) => {
        outLen += chunk.length
        if (outLen > maxBuffer) {
          overflow = true
          child.kill('SIGTERM')
          return
        }
        stdout += chunk.toString('utf-8')
      })
      child.stderr?.on('data', (chunk: Buffer) => {
        errLen += chunk.length
        if (errLen > maxBuffer) {
          overflow = true
          child.kill('SIGTERM')
          return
        }
        stderr += chunk.toString('utf-8')
      })

      child.on('error', (error) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        reject(error)
      })

      child.on('close', (exitCode, sig) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
        if (overflow) {
          stderr += '\n[sandbox] 输出超过 maxBuffer，进程已被终止'
        }
        if (aborted) {
          stderr += '\n[sandbox] 用户中止'
        }
        resolve({
          exitCode,
          signal: sig,
          stdout,
          stderr,
          timedOut,
          durationMs: Date.now() - start,
        })
      })
    })
  }

  /**
   * 强制 cwd 在 workspace 根内。
   */
  private resolveCwd(requested: string): string {
    const resolved = path.resolve(requested)
    if (resolved === this.workspaceDir || resolved.startsWith(`${this.workspaceDir}${path.sep}`)) {
      return resolved
    }
    return this.workspaceDir
  }
}

/**
 * 假沙箱：不做任何隔离，仅用于单元测试。
 */
export class NullSandbox implements SandboxAdapter {
  readonly name = 'null-sandbox'

  async execute(options: SandboxExecOptions): Promise<SandboxExecResult> {
    return {
      exitCode: 0,
      signal: null,
      stdout: `[null-sandbox] 将会执行: ${options.command}`,
      stderr: '',
      timedOut: false,
      durationMs: 0,
    }
  }
}
