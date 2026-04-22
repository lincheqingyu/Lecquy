/**
 * PermissionManager — 权限系统的对外门面
 *
 * 聚合：
 *   - 规则集合（已排序）
 *   - 当前权限模式
 *   - Bash 分类器（可插拔）
 *   - 审计日志后端（可选）
 *
 * 设计目标：
 *   1. 调用方只需要持有一个 `PermissionManager` 实例
 *   2. 所有动态操作（addRule、setMode、persist）都在这一层暴露
 *   3. 发生变化时通过订阅机制通知 UI / 其他模块
 */

import {
  BUILTIN_RULES,
  loadPermissionRules,
  type LoadPermissionRulesResult,
} from './loader.js'
import { checkPermission } from './checker.js'
import { defaultBashClassifier } from './bash-classifier.js'
import { InMemoryAuditSink, type AuditSink } from './audit-log.js'
import { applyUpdate, applyUpdates, persistRules } from './updater.js'
import type {
  CommandClassifier,
  PermissionAuditRecord,
  PermissionCheckContext,
  PermissionMode,
  PermissionResult,
  PermissionRule,
  PermissionUpdate,
  PermissionUpdateDestination,
} from './types.js'
import { DEFAULT_PERMISSION_MODE } from './types.js'
import { sortRulesByPriority } from './loader.js'

/**
 * 变更事件。
 */
export type PermissionManagerEvent =
  | { type: 'rulesChanged'; rules: PermissionRule[] }
  | { type: 'modeChanged'; mode: PermissionMode }
  | { type: 'decision'; result: PermissionResult; context: PermissionCheckContext }

export type PermissionManagerListener = (event: PermissionManagerEvent) => void

export interface PermissionManagerOptions {
  workspaceDir: string
  /** 启动时加载哪些源（默认 builtin + userSettings + projectSettings）。 */
  loadOptions?: {
    includeBuiltin?: boolean
    includeUserSettings?: boolean
    includeProjectSettings?: boolean
    cliRules?: PermissionRule[]
    sessionRules?: PermissionRule[]
  }
  /** 初始模式（会被配置文件的 defaultMode 覆盖）。 */
  initialMode?: PermissionMode
  /** Bash 分类器，默认为规则驱动。 */
  bashClassifier?: CommandClassifier
  /** 审计后端（默认内存）。 */
  auditSink?: AuditSink
}

export class PermissionManager {
  private readonly workspaceDir: string
  private rules: PermissionRule[] = []
  private mode: PermissionMode
  private classifier: CommandClassifier
  private sink: AuditSink
  private readonly listeners = new Set<PermissionManagerListener>()

  constructor(options: PermissionManagerOptions) {
    this.workspaceDir = options.workspaceDir
    this.mode = options.initialMode ?? DEFAULT_PERMISSION_MODE
    this.explicitModeSet = options.initialMode !== undefined
    this.classifier = options.bashClassifier ?? defaultBashClassifier
    this.sink = options.auditSink ?? new InMemoryAuditSink()
    this.constructorLoadOptions = options.loadOptions
    // 启动时挂载 builtin，等 load() 补全
    this.rules = sortRulesByPriority([...BUILTIN_RULES])
  }

  /**
   * 创建并加载规则。常用工厂方法。
   */
  static async create(options: PermissionManagerOptions): Promise<PermissionManager> {
    const mgr = new PermissionManager(options)
    await mgr.load()
    return mgr
  }

  /**
   * 从磁盘（和内存）加载所有规则。
   */
  async load(): Promise<LoadPermissionRulesResult> {
    const result = await loadPermissionRules({
      workspaceDir: this.workspaceDir,
      includeBuiltin: true,
      ...(this.constructorLoadOptions ?? {}),
    })
    this.rules = result.rules
    if (result.defaultMode && !this.explicitModeSet) {
      this.mode = result.defaultMode
    }
    this.emit({ type: 'rulesChanged', rules: this.rules })
    return result
  }

  /**
   * 记录用户显式设过 mode，避免 load() 覆盖。
   */
  private explicitModeSet = false
  private constructorLoadOptions?: PermissionManagerOptions['loadOptions']

  /**
   * 执行一次权限检查。
   */
  async check(context: PermissionCheckContext): Promise<PermissionResult> {
    const result = await checkPermission({
      rules: this.rules,
      mode: this.mode,
      context,
      bashClassifier: this.classifier,
    })

    // 审计
    const record: PermissionAuditRecord = {
      timestamp: result.timestamp,
      toolName: context.toolName,
      args: sanitizeArgsForAudit(context.args),
      decision: result.decision,
      matchedSource: result.matchedRule?.source,
      mode: this.mode,
    }
    // 不阻塞业务路径
    void this.sink.write(record).catch(() => {
      /* 审计失败不应影响主流程 */
    })

    this.emit({ type: 'decision', result, context })
    return result
  }

  getRules(): readonly PermissionRule[] {
    return this.rules
  }

  getMode(): PermissionMode {
    return this.mode
  }

  setMode(mode: PermissionMode): void {
    this.mode = mode
    this.explicitModeSet = true
    this.emit({ type: 'modeChanged', mode })
  }

  setClassifier(classifier: CommandClassifier): void {
    this.classifier = classifier
  }

  setAuditSink(sink: AuditSink): void {
    this.sink = sink
  }

  getAuditSink(): AuditSink {
    return this.sink
  }

  /**
   * 应用一条更新（内存），发出事件。
   */
  applyUpdate(update: PermissionUpdate): void {
    this.rules = sortRulesByPriority(applyUpdate(this.rules, update))
    this.emit({ type: 'rulesChanged', rules: this.rules })
  }

  /**
   * 批量更新（内存）。
   */
  applyUpdates(updates: PermissionUpdate[]): void {
    this.rules = sortRulesByPriority(applyUpdates(this.rules, updates))
    this.emit({ type: 'rulesChanged', rules: this.rules })
  }

  /**
   * 持久化某个来源的全部规则。
   */
  async persist(destination: PermissionUpdateDestination): Promise<string> {
    return await persistRules({
      destination,
      rules: this.rules,
      workspaceDir: this.workspaceDir,
    })
  }

  /**
   * 订阅变更。
   */
  subscribe(listener: PermissionManagerListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(event: PermissionManagerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // 订阅方抛错不影响 manager
      }
    }
  }
}

/**
 * 审计前清洗 args，避免记录过大或包含敏感内容。
 *   - 把 string 超过 512 的裁剪
 *   - 把 Buffer / 二进制替换为占位符
 */
function sanitizeArgsForAudit(args: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') {
      result[key] = value.length > 512 ? `${value.slice(0, 512)}…(truncated)` : value
    } else if (value instanceof Uint8Array || (typeof Buffer !== 'undefined' && value instanceof Buffer)) {
      result[key] = `<Buffer ${value.length} bytes>`
    } else if (value === null || typeof value === 'undefined') {
      result[key] = value
    } else if (typeof value === 'object') {
      try {
        const json = JSON.stringify(value)
        result[key] = json.length > 1024 ? `${json.slice(0, 1024)}…(truncated)` : JSON.parse(json)
      } catch {
        result[key] = '<unserializable>'
      }
    } else {
      result[key] = value
    }
  }
  return result
}
