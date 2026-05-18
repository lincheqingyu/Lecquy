// 中文：本文件（project-id.ts）位于 backend/src/memory/project-id.ts，属于backend链路中的memory 记忆链路代码，连接上游调用方与下游执行逻辑。
// English: This file (project-id.ts) belongs to the backend memory 记忆链路 layer in backend/src/memory/project-id.ts, wiring upstream callers with downstream runtime logic.

import { execSync } from 'node:child_process'
import { accessSync, constants } from 'node:fs'
import { resolve } from 'node:path'

function normalizeGitRemoteUrl(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\.git$/, '')
    .replace(/^https?:\/\//, '')
    .replace(/^ssh:\/\/git@/, '')
    .replace(/^git@([^:]+):/, '$1/')
}

export function deriveProjectId(cwd: string): string {
  if (!cwd.trim()) return 'unknown'

  const resolvedCwd = resolve(cwd)
  try {
    accessSync(resolvedCwd, constants.R_OK)
  } catch {
    return 'unknown'
  }

  try {
    const url = execSync('git config --get remote.origin.url', {
      cwd: resolvedCwd,
      encoding: 'utf-8',
      timeout: 1000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()

    const normalized = normalizeGitRemoteUrl(url)
    if (normalized) return normalized
  } catch {
    // 非 git 目录或没有 origin 时回退到本地路径。
  }

  return resolvedCwd
}
