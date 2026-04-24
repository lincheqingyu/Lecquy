/**
 * 文件操作权限检查
 *
 * 参考 Claude Code `utils/permissions/filesystem.ts` 的 canEdit / canDelete / canExecute 思路。
 * 对外暴露 4 个原子检查函数，返回 `PermissionDecision`（allow/deny/ask）。
 *
 * 设计原则：
 *   1. 路径验证先行（遍历攻击、UNC 路径）—— 这类问题 *永远* 返回 deny。
 *   2. 系统保护路径（/etc, /var/..., C:/Windows/...）返回 deny。
 *   3. 危险文件（.env, .bashrc, id_rsa...）：编辑返回 ask；删除直接 deny。
 *   4. 危险目录内容（.git, .ssh, .claude...）：编辑返回 ask；删除直接 deny。
 *   5. 其他情况返回 allow（最终还要经过 checker 的规则匹配和模式决策）。
 *
 * 注意：symlink 追踪依赖 `fs.lstatSync`/`fs.realpathSync`。
 * 对于**不存在**的路径（例如将要新建的文件），只做结构层检查。
 */

import fs from 'node:fs'
import path from 'node:path'

import {
  isDangerousFile,
  isInDangerousDirectory,
  isProtectedSystemPath,
} from './dangerous-paths.js'
import {
  containsPathTraversal,
  containsVulnerableUncPath,
  resolveWithinWorkspace,
} from './path-validation.js'
import type { PermissionDecision } from './types.js'

/**
 * 文件操作检查的入参。
 */
export interface FileOpCheckInput {
  filePath: string
  workspaceDir: string
  /** 是否允许工作区外的路径（默认 false）。 */
  allowOutsideWorkspace?: boolean
  /** 是否跟踪符号链接检查（默认 true）。 */
  followSymlinks?: boolean
}

/**
 * 所有文件操作共用的前置检查。
 * 命中的话直接返回 deny；否则返回解析后的绝对路径。
 */
function baseValidate(input: FileOpCheckInput):
  | { ok: true; resolved: string }
  | { ok: false; decision: PermissionDecision } {
  const { filePath, workspaceDir, allowOutsideWorkspace = false } = input

  if (!filePath) {
    return {
      ok: false,
      decision: { behavior: 'deny', reason: '文件路径为空' },
    }
  }

  if (containsPathTraversal(filePath)) {
    return {
      ok: false,
      decision: { behavior: 'deny', reason: '检测到路径遍历攻击 (..)' },
    }
  }

  if (containsVulnerableUncPath(filePath)) {
    return {
      ok: false,
      decision: { behavior: 'deny', reason: '检测到危险 UNC / 设备路径' },
    }
  }

  let resolved: string
  try {
    resolved = allowOutsideWorkspace
      ? path.resolve(path.isAbsolute(filePath) ? filePath : path.join(workspaceDir, filePath))
      : resolveWithinWorkspace({ filePath, workspaceDir })
  } catch (error) {
    return {
      ok: false,
      decision: {
        behavior: 'deny',
        reason: error instanceof Error ? error.message : '路径解析失败',
      },
    }
  }

  const workspace = path.resolve(workspaceDir)
  const insideWorkspace = resolved === workspace || resolved.startsWith(`${workspace}${path.sep}`)
  if (!insideWorkspace && isProtectedSystemPath(resolved)) {
    return {
      ok: false,
      decision: { behavior: 'deny', reason: '命中系统保护路径' },
    }
  }

  return { ok: true, resolved }
}

function inspectDangerousWorkspacePath(filePath: string): { dangerous: boolean; reason?: string } {
  if (isDangerousFile(filePath)) {
    return { dangerous: true, reason: '命中危险文件黑名单' }
  }
  if (isInDangerousDirectory(filePath)) {
    return { dangerous: true, reason: '位于危险目录' }
  }
  return { dangerous: false }
}

/**
 * 追踪 symlink 是否指向工作区外/系统保护路径。
 * 若路径不存在则跳过（新建文件场景）。
 */
function checkSymlinkEscape(resolved: string, workspaceDir: string): PermissionDecision | null {
  try {
    if (!fs.existsSync(resolved)) return null
    const lstat = fs.lstatSync(resolved)
    if (!lstat.isSymbolicLink()) return null
    const target = fs.realpathSync(resolved)
    const targetNormalized = target.replace(/\\/g, '/')
    const workspaceNormalized = fs.realpathSync(workspaceDir).replace(/\\/g, '/')
    if (
      !targetNormalized.startsWith(`${workspaceNormalized}/`) &&
      targetNormalized !== workspaceNormalized
    ) {
      return {
        behavior: 'deny',
        reason: `符号链接指向工作区外：${target}`,
      }
    }
    if (isProtectedSystemPath(target)) {
      return {
        behavior: 'deny',
        reason: `符号链接指向系统保护路径：${target}`,
      }
    }
    return null
  } catch {
    // 对 realpath 失败静默（竞态或权限问题）。下游工具自己会报错。
    return null
  }
}

/**
 * 检查文件读取权限。
 *
 * 读操作相对宽松：默认允许，只在三种情况下 ask：
 *   1. 危险文件（`.env`、`id_rsa`…） —— 可能泄漏凭证
 *   2. 危险目录内（`.ssh/`、`.claude/`…）
 *   3. 不在工作区内但要求放行（allowOutsideWorkspace=true）
 */
export function canReadFile(input: FileOpCheckInput): PermissionDecision {
  const base = baseValidate(input)
  if (!base.ok) return base.decision

  if (input.followSymlinks !== false) {
    const symlinkIssue = checkSymlinkEscape(base.resolved, input.workspaceDir)
    if (symlinkIssue) return symlinkIssue
  }

  if (isDangerousFile(base.resolved)) {
    return {
      behavior: 'ask',
      reason: '读取敏感凭证类文件需要用户确认',
    }
  }
  if (isInDangerousDirectory(base.resolved)) {
    return {
      behavior: 'ask',
      reason: '读取受保护目录内文件需要用户确认',
    }
  }

  return { behavior: 'allow', reason: '读取检查通过' }
}

/**
 * 检查文件编辑权限（写入、修改）。
 *
 * 比读严格：危险文件 / 目录一律 ask；系统路径一律 deny。
 */
export function canEditFile(input: FileOpCheckInput): PermissionDecision {
  const base = baseValidate(input)
  if (!base.ok) return base.decision

  if (input.followSymlinks !== false) {
    const symlinkIssue = checkSymlinkEscape(base.resolved, input.workspaceDir)
    if (symlinkIssue) return symlinkIssue
  }

  const danger = inspectDangerousWorkspacePath(base.resolved)
  if (danger.dangerous) {
    return { behavior: 'ask', reason: `编辑受保护文件：${danger.reason}` }
  }

  return { behavior: 'allow', reason: '编辑检查通过' }
}

/**
 * 检查文件删除权限。
 *
 * 比编辑更严格：危险文件 / 目录 / 系统路径直接 deny，不给 ask 机会。
 */
export function canDeleteFile(input: FileOpCheckInput): PermissionDecision {
  const base = baseValidate(input)
  if (!base.ok) return base.decision

  if (input.followSymlinks !== false) {
    const symlinkIssue = checkSymlinkEscape(base.resolved, input.workspaceDir)
    if (symlinkIssue) return symlinkIssue
  }

  const danger = inspectDangerousWorkspacePath(base.resolved)
  if (danger.dangerous) {
    return { behavior: 'deny', reason: `禁止删除受保护文件：${danger.reason}` }
  }

  return { behavior: 'allow', reason: '删除检查通过' }
}

/**
 * 检查文件执行权限（chmod +x 后执行、或 `./script.sh`）。
 * 语义：任何"执行文件"的场景都需要用户确认（AI 执行未知脚本风险高）。
 *
 * @returns 总是 `ask`（除非路径本身越界或命中系统保护）
 */
export function canExecuteFile(input: FileOpCheckInput): PermissionDecision {
  const base = baseValidate(input)
  if (!base.ok) return base.decision

  if (input.followSymlinks !== false) {
    const symlinkIssue = checkSymlinkEscape(base.resolved, input.workspaceDir)
    if (symlinkIssue) return symlinkIssue
  }

  return {
    behavior: 'ask',
    reason: 'AI 执行脚本文件需要用户确认',
  }
}
