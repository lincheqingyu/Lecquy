/**
 * 权限检查核心引擎
 *
 * 参考 Claude Code `utils/permissions/permissions.ts`（1486 行）的决策流程，
 * Lecquy 简化版目标：单个 `checkPermission` 函数覆盖所有工具。
 *
 * 决策流程（优先级从高到低）：
 *
 *   ┌────────────────────────────┐
 *   │ 1. 调用前置 hooks          │
 *   │    - 文件类：file-operations │
 *   │    - bash：bash-classifier │
 *   │   hook 返回 deny 立即退出   │
 *   └────────────┬───────────────┘
 *                │
 *   ┌────────────▼───────────────┐
 *   │ 2. 遍历规则（已排序）       │
 *   │    - 找到 deny → deny      │
 *   │    - 找到 allow → allow    │
 *   │    - 找到 ask   → 记下      │
 *   └────────────┬───────────────┘
 *                │
 *   ┌────────────▼───────────────┐
 *   │ 3. mode 决策矩阵            │
 *   │    - bypassPermissions → allow │
 *   │    - plan                → plan │
 *   │    - acceptEdits + 编辑类 → allow │
 *   │    - dontAsk   → deny (严格) │
 *   │    - default   → ask         │
 *   └────────────────────────────┘
 */

import type {
  CommandClassifier,
  PermissionCheckContext,
  PermissionDecision,
  PermissionMode,
  PermissionResult,
  PermissionRule,
} from './types.js'
import { defaultBashClassifier } from './bash-classifier.js'
import { canDeleteFile, canEditFile, canReadFile } from './file-operations.js'
import { matchGlob } from './path-validation.js'

/**
 * 已知的编辑类工具名。
 * `acceptEdits` 模式下这些工具命中 ask 时会被放宽为 allow。
 */
const EDIT_TOOL_NAMES = new Set<string>(['edit_file', 'write_file'])

/**
 * 已知的只读类工具名。
 */
const READ_TOOL_NAMES = new Set<string>(['read_file'])

export interface CheckPermissionOptions {
  /** 规则列表（已排序）。 */
  rules: PermissionRule[]
  /** 当前权限模式。 */
  mode: PermissionMode
  /** 检查上下文。 */
  context: PermissionCheckContext
  /** Bash 命令分类器（可选，默认用规则版）。 */
  bashClassifier?: CommandClassifier
}

/**
 * 主权限检查函数。
 *
 * 永远返回一个 `PermissionResult`，不会抛错。
 * 任何内部异常都会被翻译成 `deny`，保证调用方总能拿到确定的决策。
 */
export async function checkPermission(
  options: CheckPermissionOptions,
): Promise<PermissionResult> {
  const { rules, mode, context } = options
  const classifier = options.bashClassifier ?? defaultBashClassifier
  const timestamp = Date.now()

  try {
    // 1. 工具特定的前置检查
    const preCheck = await runPreCheck(context, classifier)
    if (preCheck && preCheck.behavior === 'deny') {
      return { decision: preCheck, timestamp }
    }

    // 2. 规则匹配
    const matched = findMatchingRule(context, rules)
    if (matched) {
      if (matched.behavior === 'deny') {
        return {
          decision: {
            behavior: 'deny',
            reason: matched.description || `规则 (${matched.source}) 拒绝 ${matched.toolName}`,
            source: matched.source,
          },
          matchedRule: matched,
          timestamp,
        }
      }
      if (matched.behavior === 'allow') {
        // allow 规则仍要让 preCheck 的 ask/deny 有机会覆盖
        if (preCheck && preCheck.behavior === 'ask') {
          // 这里的语义是：规则显式允许 > preCheck 的默认 ask
          return {
            decision: {
              behavior: 'allow',
              reason: matched.description || `规则 (${matched.source}) 允许 ${matched.toolName}`,
              source: matched.source,
            },
            matchedRule: matched,
            timestamp,
          }
        }
        return {
          decision: {
            behavior: 'allow',
            reason: matched.description || `规则 (${matched.source}) 允许 ${matched.toolName}`,
            source: matched.source,
          },
          matchedRule: matched,
          timestamp,
        }
      }
      // matched.behavior === 'ask'，落到 mode 决策
    }

    // 3. mode 决策矩阵
    const byMode = resolveByMode({
      mode,
      toolName: context.toolName,
      preCheck,
      matched,
    })
    return {
      decision: byMode,
      matchedRule: matched,
      timestamp,
    }
  } catch (error) {
    return {
      decision: {
        behavior: 'deny',
        reason: `权限检查异常：${(error as Error).message}`,
      },
      timestamp,
    }
  }
}

/**
 * 运行工具特定的前置检查（Bash 分类、文件操作安全）。
 * 返回 deny 或 ask 决策，或 null（无前置检查）。
 */
async function runPreCheck(
  context: PermissionCheckContext,
  classifier: CommandClassifier,
): Promise<PermissionDecision | null> {
  const { toolName, args, workspaceDir } = context

  if (toolName === 'bash') {
    const command = typeof args.command === 'string' ? args.command : ''
    if (!command) return null
    const result = await classifier.classify({ command, cwd: workspaceDir })
    if (result.level === 'deny') {
      return { behavior: 'deny', reason: `Bash 分类器拒绝：${result.reason}` }
    }
    if (result.level === 'ask') {
      return { behavior: 'ask', reason: `Bash 命令需要确认：${result.reason}` }
    }
    return { behavior: 'allow', reason: 'Bash 分类器允许' }
  }

  if (toolName === 'edit_file' || toolName === 'write_file') {
    const filePath = getFilePathArg(args)
    if (!filePath) {
      return { behavior: 'deny', reason: '缺少 file_path/path 参数' }
    }
    return canEditFile({ filePath, workspaceDir })
  }

  if (toolName === 'read_file') {
    const filePath = getFilePathArg(args)
    if (!filePath) {
      return { behavior: 'deny', reason: '缺少 file_path/path 参数' }
    }
    return canReadFile({ filePath, workspaceDir })
  }

  // 有些工具可能会同时处理 delete 动作，这里留了钩子但未注册
  if (toolName === 'delete_file') {
    const filePath = getFilePathArg(args)
    if (!filePath) {
      return { behavior: 'deny', reason: '缺少 file_path/path 参数' }
    }
    return canDeleteFile({ filePath, workspaceDir })
  }

  return null
}

/**
 * 从 args 中提取 file_path / path。
 * 与 tool-permission.ts 中的 `getFilePathArg` 保持一致。
 */
function getFilePathArg(args: Record<string, unknown>): string | null {
  if (typeof args.path === 'string' && args.path.trim()) return args.path
  if (typeof args.file_path === 'string' && args.file_path.trim()) return args.file_path
  return null
}

/**
 * 在规则列表中查找最合适的匹配。
 * 规则列表应已排序（sortRulesByPriority），
 * 这里做**第一条命中即返回**。
 */
export function findMatchingRule(
  context: PermissionCheckContext,
  rules: PermissionRule[],
): PermissionRule | undefined {
  const { toolName, args } = context

  for (const rule of rules) {
    if (!toolNameMatches(rule.toolName, toolName)) continue
    if (!contentMatches(rule, toolName, args)) continue
    return rule
  }
  return undefined
}

/**
 * 工具名匹配：精确相等，或规则为 `*` 时匹配所有。
 */
function toolNameMatches(ruleToolName: string, actualToolName: string): boolean {
  return ruleToolName === '*' || ruleToolName === actualToolName
}

/**
 * 内容匹配：
 *   - 规则无 content → 匹配任何内容
 *   - bash 工具：前缀匹配（允许 `*` glob）
 *   - 文件类工具：路径 glob
 */
function contentMatches(
  rule: PermissionRule,
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  if (!rule.content) return true

  if (toolName === 'bash') {
    const command = typeof args.command === 'string' ? args.command : ''
    // 简单前缀匹配，且支持 glob 形式（比如 `git *`）
    if (rule.content.includes('*') || rule.content.includes('?')) {
      return matchGlob(rule.content, command)
    }
    return command.startsWith(rule.content)
  }

  // 文件类工具
  const filePath = getFilePathArg(args)
  if (filePath === null) return false
  return matchGlob(rule.content, filePath)
}

/**
 * mode 决策矩阵。
 *
 * 矩阵（行=mode，列=(preCheck, matched)）：
 *
 *   mode \\ 情况            | preCheck=ask + 无规则 | preCheck=ask + matched=ask | preCheck=allow/null
 *   ─────────────────────── | ─────────────── | ────────────────────── | ────────────────────
 *   bypassPermissions       | allow           | allow                  | allow
 *   plan                    | plan            | plan                   | plan
 *   acceptEdits (编辑类工具) | allow           | allow                  | allow
 *   acceptEdits (其他工具)   | ask             | ask                    | allow
 *   dontAsk                  | deny (未批准)   | deny                    | allow
 *   default                  | ask             | ask                    | allow
 */
function resolveByMode(params: {
  mode: PermissionMode
  toolName: string
  preCheck: PermissionDecision | null
  matched: PermissionRule | undefined
}): PermissionDecision {
  const { mode, toolName, preCheck, matched } = params

  // bypass 最高优先
  if (mode === 'bypassPermissions') {
    return { behavior: 'allow', reason: '权限模式：bypassPermissions' }
  }

  // plan 模式：不论规则如何，都是 preview
  if (mode === 'plan') {
    return { behavior: 'plan', reason: '权限模式：plan（仅预览）' }
  }

  const needsUserInput = preCheck?.behavior === 'ask' || matched?.behavior === 'ask'

  if (!needsUserInput) {
    // 既没有 preCheck 的 ask 也没有规则的 ask，默认放行
    return {
      behavior: 'allow',
      reason: preCheck?.reason || '无需用户确认',
    }
  }

  // 需要用户确认的情况下，根据 mode 做最终决策
  if (mode === 'acceptEdits') {
    if (EDIT_TOOL_NAMES.has(toolName) || READ_TOOL_NAMES.has(toolName)) {
      return {
        behavior: 'allow',
        reason: 'acceptEdits 模式自动接受编辑/读取',
      }
    }
    return {
      behavior: 'ask',
      reason: preCheck?.reason || '需要用户确认',
    }
  }

  if (mode === 'dontAsk') {
    return {
      behavior: 'deny',
      reason: 'dontAsk 模式下未批准的操作被拒绝',
    }
  }

  // default
  return {
    behavior: 'ask',
    reason: preCheck?.reason || matched?.description || '需要用户确认',
  }
}
