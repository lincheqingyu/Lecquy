/**
 * 危险文件与目录黑名单
 *
 * 参考 Claude Code `utils/permissions/filesystem.ts` 的保护清单。
 * 这些文件/目录可能包含敏感配置、凭证，或是代码执行入口。
 * 对它们的编辑或删除默认需要用户确认（`ask`）或直接拒绝（`deny`）。
 */

import path from 'node:path'

/**
 * 被保护的危险文件（按文件名匹配，忽略所在目录）。
 *
 * 分类：
 *   - Shell 启动脚本：可能被植入恶意命令，下次开 shell 即执行
 *   - Git 配置：可改变 remote、hook 行为，进而执行任意命令
 *   - IDE / 工具配置：可能包含凭证或自动执行任务
 *   - MCP / Lecquy 配置：影响 AI 自身的权限
 *   - 环境变量文件：包含密钥
 */
export const DANGEROUS_FILES: readonly string[] = [
  // Shell 启动脚本
  '.bashrc',
  '.bash_profile',
  '.bash_logout',
  '.zshrc',
  '.zprofile',
  '.zshenv',
  '.profile',
  '.cshrc',
  '.tcshrc',
  // Git 相关
  '.gitconfig',
  '.gitmodules',
  // 工具配置
  '.ripgreprc',
  '.npmrc',
  '.yarnrc',
  '.pnpmrc',
  // MCP / AI 工具配置
  '.mcp.json',
  '.claude.json',
  '.lecquy.json',
  // 敏感凭证
  '.env',
  '.env.local',
  '.env.production',
  '.env.development',
  'credentials.json',
  'credentials',
  // SSH
  'authorized_keys',
  'id_rsa',
  'id_ed25519',
  'id_ecdsa',
  'id_dsa',
  'known_hosts',
  // 系统入口（Linux / Mac）
  'sudoers',
  'passwd',
  'shadow',
  'hosts',
]

/**
 * 危险目录：路径中一旦命中这些目录片段，就视为敏感位置。
 */
export const DANGEROUS_DIRECTORIES: readonly string[] = [
  '.git',
  '.github',
  '.vscode',
  '.idea',
  '.claude',
  '.lecquy',
  '.ssh',
  '.gnupg',
  'node_modules', // 纯写入/删除意义上算危险；读取无所谓
]

/**
 * 系统级路径前缀：AI 无论如何不应该去动。
 * 用 `startsWith` 校验，路径已规范化（POSIX 形式）。
 */
export const PROTECTED_SYSTEM_PREFIXES: readonly string[] = [
  '/etc/',
  '/var/',
  '/usr/',
  '/boot/',
  '/bin/',
  '/sbin/',
  '/lib/',
  '/lib64/',
  '/proc/',
  '/sys/',
  '/dev/',
  // Windows
  'C:/Windows/',
  'C:/Program Files/',
  'C:/Program Files (x86)/',
]

/**
 * 判断给定路径是否为危险文件（按文件名匹配）。
 *
 * @param filePath 原始路径，可为相对或绝对
 */
export function isDangerousFile(filePath: string): boolean {
  if (!filePath) return false
  // 跨平台：先把反斜杠统一为斜杠，再取最后一段
  const normalized = filePath.replace(/\\/g, '/')
  const base = (normalized.split('/').pop() ?? '').toLowerCase()
  if (!base) return false
  return DANGEROUS_FILES.some((name) => name.toLowerCase() === base)
}

/**
 * 判断路径是否位于某个危险目录下。
 *
 * 会做跨平台归一：把 `\` 统一为 `/`，并且以 `/xxx/` 或 `/xxx$` 形式匹配，
 * 避免把 `foo.git-ignore` 这类误判。
 */
export function isInDangerousDirectory(filePath: string): boolean {
  if (!filePath) return false
  const normalized = filePath.replace(/\\/g, '/')
  // 使用 `/xxx/` 或者以 `/xxx` 结尾的形式匹配
  for (const dir of DANGEROUS_DIRECTORIES) {
    const bracket = `/${dir}/`
    const tail = `/${dir}`
    if (normalized.includes(bracket)) return true
    if (normalized.endsWith(tail)) return true
    // 也支持路径本身就是 .git、.lecquy 这类裸名
    if (normalized === dir) return true
  }
  return false
}

/**
 * 判断路径是否落在系统保护前缀下。
 *
 * 跨平台：把 `\` 统一为 `/` 再比较；Windows 盘符忽略大小写。
 */
export function isProtectedSystemPath(filePath: string): boolean {
  if (!filePath) return false
  const normalized = filePath.replace(/\\/g, '/')
  const lower = normalized.toLowerCase()
  for (const prefix of PROTECTED_SYSTEM_PREFIXES) {
    if (lower.startsWith(prefix.toLowerCase())) {
      return true
    }
  }
  return false
}

/**
 * 综合判断一条路径是否属于"危险"。
 * 用于给上层一个统一的入口。
 */
export function isDangerousPath(filePath: string): {
  dangerous: boolean
  reason?: string
} {
  if (isProtectedSystemPath(filePath)) {
    return { dangerous: true, reason: '位于系统保护路径' }
  }
  if (isDangerousFile(filePath)) {
    return { dangerous: true, reason: '命中危险文件黑名单' }
  }
  if (isInDangerousDirectory(filePath)) {
    return { dangerous: true, reason: '位于危险目录' }
  }
  return { dangerous: false }
}
