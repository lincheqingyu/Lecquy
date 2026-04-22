/**
 * 权限规则加载器
 *
 * 从多个源加载规则，合并后按优先级排序。
 * 参考 Claude Code `utils/permissions/permissionsLoader.ts` 的多源逻辑，
 * Lecquy 版本简化为：
 *   - cliArg          命令行参数或程序内注入
 *   - session         会话级（内存，不持久化）
 *   - projectSettings 项目级：<workspace>/.lecquy/permissions.json
 *   - userSettings    用户级：~/.lecquy/permissions.json
 *   - builtin         内置默认
 */

import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {
  PermissionBehavior,
  PermissionMode,
  PermissionRule,
  PermissionRuleSource,
} from './types.js'
import { PERMISSION_MODES, RULE_SOURCE_PRIORITY } from './types.js'

/**
 * 规则配置文件的磁盘结构。
 *
 * @example
 *   {
 *     "version": "1.0",
 *     "defaultMode": "default",
 *     "rules": [
 *       { "behavior": "deny", "toolName": "bash", "content": "rm -rf *" },
 *       { "behavior": "allow", "toolName": "read_file" }
 *     ]
 *   }
 */
export interface PermissionConfigFile {
  version: string
  defaultMode?: PermissionMode
  rules?: PermissionRule[]
}

/**
 * 内置默认规则集。
 * 保守策略：只声明几条"最小必要"的规则，避免把策略写死在代码里。
 */
export const BUILTIN_RULES: readonly PermissionRule[] = [
  { source: 'builtin', behavior: 'allow', toolName: 'read_file' },
  { source: 'builtin', behavior: 'allow', toolName: 'skill' },
  { source: 'builtin', behavior: 'allow', toolName: 'todo_write' },
  { source: 'builtin', behavior: 'allow', toolName: 'sessions_list' },
  { source: 'builtin', behavior: 'allow', toolName: 'sessions_history' },
  { source: 'builtin', behavior: 'allow', toolName: 'request_user_input' },
  // bash 默认 ask（由分类器进一步细化）
  { source: 'builtin', behavior: 'ask', toolName: 'bash' },
  // 写类默认 ask（file-operations 会细化）
  { source: 'builtin', behavior: 'ask', toolName: 'write_file' },
  { source: 'builtin', behavior: 'ask', toolName: 'edit_file' },
]

/**
 * 规则来源到磁盘路径的映射。
 */
export function getConfigPath(source: PermissionRuleSource, workspaceDir: string): string | null {
  switch (source) {
    case 'projectSettings':
      return path.join(workspaceDir, '.lecquy', 'permissions.json')
    case 'userSettings':
      return path.join(os.homedir(), '.lecquy', 'permissions.json')
    // 其他来源无持久化路径
    case 'cliArg':
    case 'session':
    case 'builtin':
      return null
  }
}

/**
 * 加载单个配置文件，返回规则和声明的默认模式。
 * 文件不存在返回空；解析错误直接抛错，交给上层决定如何显示。
 */
export async function loadConfigFile(
  filePath: string,
  source: PermissionRuleSource,
): Promise<{ rules: PermissionRule[]; defaultMode?: PermissionMode }> {
  try {
    const raw = await fsp.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as PermissionConfigFile
    return {
      rules: (parsed.rules || []).map((rule) => normalizeRule({ ...rule, source })),
      defaultMode:
        parsed.defaultMode && (PERMISSION_MODES as readonly string[]).includes(parsed.defaultMode)
          ? parsed.defaultMode
          : undefined,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { rules: [] }
    }
    throw new PermissionConfigError(filePath, error as Error)
  }
}

/**
 * 规则归一化：去除前后空白、过滤非法字段、强制打上 source 标签。
 */
export function normalizeRule(rule: PermissionRule): PermissionRule {
  return {
    source: rule.source,
    behavior: rule.behavior,
    toolName: rule.toolName.trim(),
    content: rule.content?.trim() || undefined,
    description: rule.description?.trim() || undefined,
  }
}

/**
 * 按规则源优先级排序（稳定）。
 * 高优先级排在前面；同优先级按原始顺序。
 */
export function sortRulesByPriority(rules: PermissionRule[]): PermissionRule[] {
  return [...rules]
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => {
      const pa = RULE_SOURCE_PRIORITY[a.rule.source]
      const pb = RULE_SOURCE_PRIORITY[b.rule.source]
      if (pa !== pb) return pb - pa
      return a.index - b.index
    })
    .map(({ rule }) => rule)
}

/**
 * 检测被遮蔽的规则：低优先级规则（toolName + content）已被高优先级规则覆盖。
 * 返回所有被遮蔽的规则，供上层在启动时输出警告。
 */
export function detectShadowedRules(rules: PermissionRule[]): Array<{
  shadowed: PermissionRule
  shadowedBy: PermissionRule
}> {
  const sorted = sortRulesByPriority(rules)
  const reports: Array<{ shadowed: PermissionRule; shadowedBy: PermissionRule }> = []

  for (let i = 0; i < sorted.length; i++) {
    const rule = sorted[i]
    // 往前找是否有更高优先级的规则覆盖这条
    for (let j = 0; j < i; j++) {
      const higher = sorted[j]
      if (
        higher.toolName === rule.toolName &&
        (higher.content ?? '') === (rule.content ?? '')
      ) {
        reports.push({ shadowed: rule, shadowedBy: higher })
        break
      }
    }
  }
  return reports
}

/**
 * 加载权限规则的完整入口。
 */
export interface LoadPermissionRulesOptions {
  /** 工作区根目录，用来找 projectSettings。 */
  workspaceDir: string
  /** 是否加载用户级规则（默认 true）。 */
  includeUserSettings?: boolean
  /** 是否加载项目级规则（默认 true）。 */
  includeProjectSettings?: boolean
  /** 程序注入的临时规则（cliArg 源）。 */
  cliRules?: PermissionRule[]
  /** 会话级规则（session 源，一般由 PermissionManager 管理）。 */
  sessionRules?: PermissionRule[]
  /** 是否附加内置规则（默认 true）。 */
  includeBuiltin?: boolean
}

export interface LoadPermissionRulesResult {
  /** 合并、归一、排序后的规则列表。 */
  rules: PermissionRule[]
  /** 加载到的默认权限模式（取优先级最高的配置文件的值）。 */
  defaultMode?: PermissionMode
  /** 被遮蔽的规则报告（可用于 UI 警告）。 */
  shadowed: Array<{ shadowed: PermissionRule; shadowedBy: PermissionRule }>
  /** 每个源各自加载到的规则数（用于调试）。 */
  sourceCounts: Partial<Record<PermissionRuleSource, number>>
}

export async function loadPermissionRules(
  options: LoadPermissionRulesOptions,
): Promise<LoadPermissionRulesResult> {
  const {
    workspaceDir,
    includeUserSettings = true,
    includeProjectSettings = true,
    cliRules = [],
    sessionRules = [],
    includeBuiltin = true,
  } = options

  const all: PermissionRule[] = []
  const sourceCounts: Partial<Record<PermissionRuleSource, number>> = {}
  let defaultMode: PermissionMode | undefined

  if (includeBuiltin) {
    all.push(...BUILTIN_RULES)
    sourceCounts.builtin = BUILTIN_RULES.length
  }

  if (includeUserSettings) {
    const p = getConfigPath('userSettings', workspaceDir)
    if (p) {
      const loaded = await loadConfigFile(p, 'userSettings')
      all.push(...loaded.rules)
      sourceCounts.userSettings = loaded.rules.length
      if (loaded.defaultMode) defaultMode = loaded.defaultMode
    }
  }

  if (includeProjectSettings) {
    const p = getConfigPath('projectSettings', workspaceDir)
    if (p) {
      const loaded = await loadConfigFile(p, 'projectSettings')
      all.push(...loaded.rules)
      sourceCounts.projectSettings = loaded.rules.length
      // 项目级优先级更高，覆盖用户级的 defaultMode
      if (loaded.defaultMode) defaultMode = loaded.defaultMode
    }
  }

  if (sessionRules.length) {
    all.push(...sessionRules.map((rule) => normalizeRule({ ...rule, source: 'session' })))
    sourceCounts.session = sessionRules.length
  }

  if (cliRules.length) {
    all.push(...cliRules.map((rule) => normalizeRule({ ...rule, source: 'cliArg' })))
    sourceCounts.cliArg = cliRules.length
  }

  const sorted = sortRulesByPriority(all)
  const shadowed = detectShadowedRules(sorted)

  return { rules: sorted, defaultMode, shadowed, sourceCounts }
}

/**
 * 从 `--allow bash:ls`、`--deny bash:rm` 这类字符串解析出规则（cliArg 源）。
 *
 * 格式：`<behavior>:<toolName>[:<content>]`
 * 例子：
 *   - `allow:read_file`
 *   - `deny:bash:rm -rf`
 *   - `ask:edit_file:.env`
 */
export function parseCliRule(raw: string): PermissionRule | null {
  const match = /^(allow|deny|ask):([^:]+)(?::(.+))?$/.exec(raw.trim())
  if (!match) return null
  const [, behavior, toolName, content] = match
  return normalizeRule({
    source: 'cliArg',
    behavior: behavior as PermissionBehavior,
    toolName: toolName.trim(),
    content: content?.trim(),
  })
}

/**
 * 同步版的配置文件加载（用于启动时）。
 */
export function loadConfigFileSync(
  filePath: string,
  source: PermissionRuleSource,
): { rules: PermissionRule[]; defaultMode?: PermissionMode } {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as PermissionConfigFile
    return {
      rules: (parsed.rules || []).map((rule) => normalizeRule({ ...rule, source })),
      defaultMode:
        parsed.defaultMode && (PERMISSION_MODES as readonly string[]).includes(parsed.defaultMode)
          ? parsed.defaultMode
          : undefined,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { rules: [] }
    }
    throw new PermissionConfigError(filePath, error as Error)
  }
}

/**
 * 读取配置失败时抛出的错误。
 */
export class PermissionConfigError extends Error {
  readonly filePath: string
  readonly cause: Error

  constructor(filePath: string, cause: Error) {
    super(`解析权限配置失败 ${filePath}: ${cause.message}`)
    this.name = 'PermissionConfigError'
    this.filePath = filePath
    this.cause = cause
  }
}
