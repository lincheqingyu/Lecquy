/**
 * Bash 命令危险等级分类器
 *
 * 参考 Claude Code `utils/permissions/yoloClassifier.ts` 和 `bashClassifier.ts` 的设计。
 * Claude Code 泄露源码中 bashClassifier 是存根（调用内部 AI 分类器），
 * 本实现采用规则匹配作为 MVP，同时通过 `CommandClassifier` 接口预留 AI 升级通道。
 *
 * 规则来源：
 *   - Deny 级：绝对不允许执行的命令（即使用户确认也拒绝）
 *   - Ask  级：需要用户确认的命令（改变系统状态、网络出站、包管理）
 *   - 默认 Allow（但 checker 的 mode 层仍可收紧）
 *
 * 设计要点：
 *   1. 使用词边界 `\b` 匹配命令名，避免把 `myremove.sh` 误匹配为 `rm`
 *   2. 先剥离前缀变量定义、sudo、env，再匹配真正的命令名
 *   3. 多命令场景（`a && b`、`a ; b`、`a | b`）要逐个子命令检查
 *   4. 规则可加字段 `matchedPattern` 便于审计和调试
 */

import type { ClassifierResult, CommandClassifier } from './types.js'

/**
 * 拒绝级规则：命中即拒绝。
 * 顺序即优先级（先命中者返回）。
 *
 * 每条规则形如 `{ pattern, reason }`。`pattern` 使用 RegExp。
 */
interface ClassifierRule {
  pattern: RegExp
  reason: string
  name: string
}

/**
 * 绝对禁止的命令模式。
 *
 * 特别注意：
 *   - `rm -rf /` 及其变形（允许命令前面有其他参数）
 *   - `dd if=...` 向块设备写入
 *   - fork 炸弹（bash / python / perl 等多种变体）
 *   - 磁盘格式化 mkfs / fdisk
 *   - 直接写 /dev/{sd*,nvme*,disk*} 节点
 */
export const DENY_PATTERNS: readonly ClassifierRule[] = [
  {
    name: 'rm_root',
    pattern: /\brm\s+(?:-[rRfF]+\s+)+\/(?:\s*$|(?:usr|etc|var|bin|sbin|lib|lib64|boot|opt|root|home)\b)/,
    reason: '尝试递归删除根目录或系统目录',
  },
  {
    name: 'rm_rf_wildcard_home',
    pattern: /\brm\s+-[rRfF]+\s+(?:~|\$HOME)\/?(?:\s|$)/,
    reason: '尝试递归删除用户主目录',
  },
  {
    name: 'dd_to_device',
    pattern: /\bdd\s+(?:[^\s]+\s+)*of=\/dev\/(?:sd|nvme|disk|hd|mmc|xvd)/,
    reason: '直接向块设备写入数据 (dd)',
  },
  {
    name: 'mkfs',
    pattern: /\bmkfs(?:\.[a-z0-9]+)?\s/,
    reason: '尝试格式化文件系统',
  },
  {
    name: 'fdisk_destructive',
    pattern: /\bfdisk\s+(?:--wipe\b|-w\b)/,
    reason: '尝试修改分区表',
  },
  {
    name: 'fork_bomb_bash',
    pattern: /:\s*\(\s*\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/,
    reason: 'Bash fork 炸弹',
  },
  {
    name: 'fork_bomb_python',
    pattern: /\bpython\d*\s+-c\s+["'].*(?:os\.fork|multiprocessing\.Process).*while/,
    reason: 'Python fork 炸弹',
  },
  {
    name: 'cat_random_to_device',
    pattern: /\bcat\s+\/dev\/u?random\s*>\s*\/dev\/(?:sd|nvme|disk|hd)/,
    reason: '把随机数据写入磁盘设备',
  },
  {
    name: 'curl_pipe_shell',
    pattern: /\b(?:curl|wget)\s+[^|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh)\b/,
    reason: '管道执行远程脚本',
  },
  {
    name: 'rm_etc',
    pattern: /\brm\s+(?:-[rRfF]+\s+)*\/etc(?:\/|\s|$)/,
    reason: '删除 /etc 系统配置目录',
  },
]

/**
 * 需要用户确认的命令模式。
 */
export const ASK_PATTERNS: readonly ClassifierRule[] = [
  // 权限提升
  { name: 'sudo', pattern: /\bsudo\b/, reason: '使用 sudo 提权' },
  { name: 'su', pattern: /\bsu\s+(?:-|[A-Za-z_])/, reason: '切换用户 (su)' },
  // 删除类（温和版 rm、rmdir、find -delete）
  { name: 'rm', pattern: /\brm\s+(?:-[a-zA-Z]*\s+)?[^\s-]/, reason: '删除文件 (rm)' },
  { name: 'rmdir', pattern: /\brmdir\b/, reason: '删除目录 (rmdir)' },
  { name: 'find_delete', pattern: /\bfind\b[^|]*-delete\b/, reason: 'find -delete' },
  { name: 'find_exec_rm', pattern: /\bfind\b[^|]*-exec\s+rm\b/, reason: 'find -exec rm' },
  // 网络出站
  { name: 'curl', pattern: /\bcurl\b/, reason: '发起 HTTP 请求 (curl)' },
  { name: 'wget', pattern: /\bwget\b/, reason: '下载文件 (wget)' },
  { name: 'nc', pattern: /\bnc\b/, reason: 'Netcat 网络操作' },
  { name: 'telnet', pattern: /\btelnet\b/, reason: 'Telnet 连接' },
  { name: 'ssh', pattern: /\bssh\s+\S/, reason: 'SSH 连接' },
  { name: 'scp', pattern: /\bscp\b/, reason: 'SCP 传输' },
  { name: 'rsync_remote', pattern: /\brsync\s+[^|]*\S+:\S+/, reason: 'rsync 远程同步' },
  // 包管理
  {
    name: 'pkg_install',
    pattern: /\b(?:apt|apt-get|yum|dnf|brew|pacman|apk|zypper)\s+(?:install|remove|update|upgrade|purge)\b/,
    reason: '系统包管理',
  },
  {
    name: 'pip_install',
    pattern: /\bpip\d*\s+(?:install|uninstall)\b/,
    reason: 'Python 包安装',
  },
  {
    name: 'npm_global',
    pattern: /\bnpm\s+install\s+-g\b/,
    reason: 'npm 全局安装',
  },
  {
    name: 'npm_install',
    pattern: /\b(?:npm|pnpm|yarn)\s+(?:add|install|i)\b/,
    reason: '依赖安装',
  },
  // 系统服务
  {
    name: 'systemctl',
    pattern: /\bsystemctl\s+(?:start|stop|restart|enable|disable|mask|unmask)\b/,
    reason: '系统服务控制',
  },
  { name: 'service', pattern: /\bservice\s+\S+\s+(?:start|stop|restart)\b/, reason: '系统服务控制' },
  // 权限修改
  { name: 'chmod', pattern: /\bchmod\b/, reason: '修改文件权限' },
  { name: 'chown', pattern: /\bchown\b/, reason: '修改文件所有者' },
  { name: 'chgrp', pattern: /\bchgrp\b/, reason: '修改文件所属组' },
  // 进程控制
  { name: 'kill', pattern: /\bkill\s+(?:-9|-KILL)\b/, reason: '强制终止进程' },
  { name: 'pkill', pattern: /\bpkill\b/, reason: '按名终止进程' },
  // Git 发送类
  {
    name: 'git_push_force',
    pattern: /\bgit\s+push\s+(?:--force|-f)\b/,
    reason: 'git 强制推送',
  },
  { name: 'git_reset_hard', pattern: /\bgit\s+reset\s+--hard\b/, reason: 'git 硬重置' },
  // 数据库破坏
  { name: 'sql_drop', pattern: /\bdrop\s+(?:database|table|schema)\b/i, reason: 'SQL DROP' },
  { name: 'sql_truncate', pattern: /\btruncate\s+(?:table\s+)?\S/i, reason: 'SQL TRUNCATE' },
  { name: 'sql_delete_from', pattern: /\bdelete\s+from\s+\S+\s*(?:;|$)/i, reason: 'SQL DELETE FROM（无 WHERE）' },
  // 加密挂载 / 环境变量泄漏
  { name: 'crontab', pattern: /\bcrontab\s+(?:-r|-e|-i)\b/, reason: '修改计划任务' },
  { name: 'iptables', pattern: /\biptables\b/, reason: '修改防火墙规则' },
  { name: 'env_dump', pattern: /\bprintenv\s*$/, reason: '打印所有环境变量' },
]

/**
 * 基于规则的 Bash 分类器。
 *
 * 先把命令串拆成子命令（按 `&&`、`||`、`;`、`|` 分割），
 * 再对每个子命令逐条匹配 DENY / ASK 模式。
 * 任一子命令命中 deny 立即返回 deny；否则只要有 ask 命中就返回 ask。
 */
export class RuleBasedBashClassifier implements CommandClassifier {
  readonly name = 'rule-based-bash-classifier'

  async classify(input: { command: string; cwd?: string }): Promise<ClassifierResult> {
    return this.classifySync(input.command)
  }

  /**
   * 同步分类接口，供内部非 async 调用点使用。
   */
  classifySync(command: string): ClassifierResult {
    if (!command || !command.trim()) {
      return {
        level: 'allow',
        confidence: 'high',
        reason: '空命令',
      }
    }

    // 某些危险模式（curl | bash、fork 炸弹）横跨子命令，
    // 必须先在完整命令上扫描 DENY。
    for (const rule of DENY_PATTERNS) {
      if (rule.pattern.test(command)) {
        return {
          level: 'deny',
          confidence: 'high',
          reason: rule.reason,
          matchedPattern: rule.name,
        }
      }
    }

    const subCommands = splitCompoundCommand(command)

    // 再逐个子命令扫描 DENY（捕获 `echo hi && rm -rf /` 这类）
    for (const sub of subCommands) {
      for (const rule of DENY_PATTERNS) {
        if (rule.pattern.test(sub)) {
          return {
            level: 'deny',
            confidence: 'high',
            reason: rule.reason,
            matchedPattern: rule.name,
          }
        }
      }
    }

    // 最后跑 ask —— 命中任一子命令则返回 ask
    for (const sub of subCommands) {
      for (const rule of ASK_PATTERNS) {
        if (rule.pattern.test(sub)) {
          return {
            level: 'ask',
            confidence: 'high',
            reason: rule.reason,
            matchedPattern: rule.name,
          }
        }
      }
    }

    return {
      level: 'allow',
      confidence: 'medium',
      reason: '未匹配任何风险模式',
    }
  }
}

/**
 * 复合命令拆分。
 *
 * 简易实现：按 `&&` / `||` / `;` / `|` / `\n` 切分。
 * 不处理嵌套引号中的特殊字符——这对规则匹配精度的影响在 MVP 阶段可接受。
 * 一个已知限制：`"echo ; rm -rf /"` 也会被当作两个子命令，这在分类器里偏安全（会触发 deny）。
 */
export function splitCompoundCommand(command: string): string[] {
  return command
    .split(/(?:&&|\|\||;|\||\n|\r)+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * 方便直接使用的单例实例。
 */
export const defaultBashClassifier: CommandClassifier = new RuleBasedBashClassifier()

/**
 * 给定命令，返回简短的风险说明文字（UI 用）。
 */
export function describeBashRisk(result: ClassifierResult): string {
  const prefix = result.level === 'deny' ? '高风险' : result.level === 'ask' ? '中等风险' : '低风险'
  return `${prefix}：${result.reason}`
}
