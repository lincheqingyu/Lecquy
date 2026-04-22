/**
 * 路径验证
 *
 * 参考 Claude Code `utils/permissions/pathValidation.ts`。
 * 职责：
 *   1. 检测路径遍历攻击（../../etc/passwd）
 *   2. 检测 Windows UNC / 设备路径（\\?\..., \\.\...）
 *   3. 把相对路径安全地解析到工作区根目录之内
 *   4. 规范化路径，避免上层规则匹配时因分隔符或大小写出错
 *
 * 注意：本模块只做**结构层面的校验**，不去跟踪 symlink 的真实目标。
 * symlink 防护在 file-operations.ts 中完成（需要 fs 访问）。
 */

import path from 'node:path'

/**
 * 检测路径遍历攻击。
 *
 * 命中条件：
 *   - 原始路径中出现 `..`（任何分隔符前后的 `..` 段）
 *   - 规范化后路径仍然包含 `..`（极少见，但兼容某些伪装形式）
 *   - URL 编码形式 `%2e%2e` / `%2E%2E`
 */
export function containsPathTraversal(rawPath: string): boolean {
  if (!rawPath) return false

  const lowered = rawPath.toLowerCase()
  if (lowered.includes('%2e%2e')) return true

  const normalized = rawPath.replace(/\\/g, '/')
  // 以段为单位检查 .. 而不是字符串包含，否则会把 ..foo 这类文件名误伤
  const segments = normalized.split('/')
  if (segments.includes('..')) return true

  return false
}

/**
 * 检测 Windows 上的危险 UNC / 设备路径。
 *
 * 常见攻击形态：
 *   - \\?\GlobalRoot\...        直接访问内核对象命名空间
 *   - \\.\PhysicalDrive0        直接操作物理磁盘
 *   - \\server\share\...        任意网络共享
 */
export function containsVulnerableUncPath(rawPath: string): boolean {
  if (!rawPath) return false
  const trimmed = rawPath.trim()
  if (trimmed.startsWith('\\\\?\\') || trimmed.startsWith('//?/')) return true
  if (trimmed.startsWith('\\\\.\\') || trimmed.startsWith('//./')) return true
  // 以 \\server 开头：所有以两个反斜杠开头的路径都当作网络共享处理
  if (/^\\\\[^\\?.]/.test(trimmed)) return true
  return false
}

/**
 * 规范化路径：把 Windows 分隔符转为 POSIX，折叠冗余分隔符。
 * 不做解析，不触碰文件系统。
 */
export function normalizePath(rawPath: string): string {
  if (!rawPath) return ''
  // 保留前导 `//`（POSIX 允许实现自定义含义），其余折叠
  const normalized = rawPath.replace(/\\/g, '/').replace(/\/{2,}/g, '/')
  return normalized
}

/**
 * 把相对路径解析到工作区根之内；若解析后落出根目录则抛错。
 *
 * 与 `runtime-paths.ts` 中的 `resolvePathWithinRoot` 语义一致，但不要求
 * 调用方引入那份实现，权限模块可独立使用。
 */
export function resolveWithinWorkspace(params: {
  filePath: string
  workspaceDir: string
}): string {
  const { filePath, workspaceDir } = params
  const workspace = path.resolve(workspaceDir)
  const resolved = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(workspace, filePath)

  if (resolved !== workspace && !resolved.startsWith(`${workspace}${path.sep}`)) {
    throw new PathOutsideWorkspaceError(filePath, workspace)
  }
  return resolved
}

/**
 * 判断路径是否落在工作区根内（不抛错版本）。
 */
export function isWithinWorkspace(filePath: string, workspaceDir: string): boolean {
  try {
    resolveWithinWorkspace({ filePath, workspaceDir })
    return true
  } catch {
    return false
  }
}

/**
 * 综合验证：给上层一个一次性的入口。
 *
 * 返回：
 *   - `{ ok: true, resolved }`       表示路径安全，已解析到绝对路径
 *   - `{ ok: false, reason }`        表示路径不安全
 */
export function validatePath(params: {
  filePath: string
  workspaceDir: string
  allowOutsideWorkspace?: boolean
}):
  | { ok: true; resolved: string }
  | { ok: false; reason: string } {
  const { filePath, workspaceDir, allowOutsideWorkspace = false } = params

  if (!filePath) {
    return { ok: false, reason: '路径为空' }
  }

  if (containsPathTraversal(filePath)) {
    return { ok: false, reason: '检测到路径遍历 (..)' }
  }

  if (containsVulnerableUncPath(filePath)) {
    return { ok: false, reason: '检测到危险的 UNC / 设备路径' }
  }

  try {
    const resolved = allowOutsideWorkspace
      ? path.resolve(path.isAbsolute(filePath) ? filePath : path.join(workspaceDir, filePath))
      : resolveWithinWorkspace({ filePath, workspaceDir })
    return { ok: true, resolved }
  } catch (error) {
    if (error instanceof PathOutsideWorkspaceError) {
      return { ok: false, reason: error.message }
    }
    return { ok: false, reason: (error as Error).message || '路径解析失败' }
  }
}

/**
 * 路径越界错误。
 */
export class PathOutsideWorkspaceError extends Error {
  readonly filePath: string
  readonly workspaceDir: string

  constructor(filePath: string, workspaceDir: string) {
    super(`路径 "${filePath}" 超出工作区根目录 "${workspaceDir}"`)
    this.name = 'PathOutsideWorkspaceError'
    this.filePath = filePath
    this.workspaceDir = workspaceDir
  }
}

/**
 * 简单 glob 匹配（仅支持 `*`、`**`、`?`，不支持字符类和否定）。
 * 用于规则 content 匹配，不引入 micromatch 之类的重依赖。
 *
 * 语义：
 *   - `*`   匹配同一段内任意字符（不跨越 '/'）
 *   - `**`  匹配任意段（可跨越 '/'）
 *   - `?`   匹配单个非 '/' 字符
 *   - 其他字符按字面量处理
 */
export function matchGlob(pattern: string, input: string): boolean {
  if (!pattern) return !input
  const normalizedInput = input.replace(/\\/g, '/')
  const regex = globToRegExp(pattern)
  return regex.test(normalizedInput)
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, '/')
  let re = '^'
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i]
    if (ch === '*') {
      if (normalized[i + 1] === '*') {
        re += '.*'
        i++
        // 吃掉紧跟的 '/'，让 '**/foo' 也能匹配 'foo'
        if (normalized[i + 1] === '/') i++
      } else {
        re += '[^/]*'
      }
    } else if (ch === '?') {
      re += '[^/]'
    } else if ('.+^$()|{}[]\\'.includes(ch)) {
      re += `\\${ch}`
    } else {
      re += ch
    }
  }
  re += '$'
  return new RegExp(re)
}
