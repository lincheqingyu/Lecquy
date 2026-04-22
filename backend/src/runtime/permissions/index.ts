/**
 * 权限系统统一对外出口
 *
 * 上游模块（agent、server、ws、cli）只需要从这里引入。
 * 不要直接依赖子文件，以便后续内部重构时保留稳定接口。
 */

// 类型
export type {
  PermissionMode,
  PermissionBehavior,
  PermissionRule,
  PermissionRuleSource,
  PermissionDecision,
  PermissionResult,
  PermissionUpdate,
  PermissionUpdateDestination,
  PermissionCheckContext,
  PermissionAuditRecord,
  ClassifierResult,
  CommandClassifier,
} from './types.js'
export {
  PERMISSION_MODES,
  PERMISSION_RULE_SOURCES,
  DEFAULT_PERMISSION_MODE,
  RULE_SOURCE_PRIORITY,
  isPermissionMode,
} from './types.js'

// 危险路径 & 路径验证
export {
  DANGEROUS_FILES,
  DANGEROUS_DIRECTORIES,
  PROTECTED_SYSTEM_PREFIXES,
  isDangerousFile,
  isInDangerousDirectory,
  isProtectedSystemPath,
  isDangerousPath,
} from './dangerous-paths.js'
export {
  containsPathTraversal,
  containsVulnerableUncPath,
  normalizePath,
  resolveWithinWorkspace,
  isWithinWorkspace,
  validatePath,
  matchGlob,
  PathOutsideWorkspaceError,
} from './path-validation.js'

// Bash 分类器
export {
  DENY_PATTERNS,
  ASK_PATTERNS,
  RuleBasedBashClassifier,
  defaultBashClassifier,
  splitCompoundCommand,
  describeBashRisk,
} from './bash-classifier.js'

// 文件操作检查
export {
  canReadFile,
  canEditFile,
  canDeleteFile,
  canExecuteFile,
  type FileOpCheckInput,
} from './file-operations.js'

// 加载器 / 更新器
export {
  BUILTIN_RULES,
  loadPermissionRules,
  loadConfigFile,
  loadConfigFileSync,
  getConfigPath,
  normalizeRule,
  sortRulesByPriority,
  detectShadowedRules,
  parseCliRule,
  PermissionConfigError,
  type LoadPermissionRulesOptions,
  type LoadPermissionRulesResult,
  type PermissionConfigFile,
} from './loader.js'
export {
  applyUpdate,
  applyUpdates,
  persistRules,
  applyAndPersist,
} from './updater.js'

// 审计
export {
  InMemoryAuditSink,
  JsonFileAuditSink,
  CompositeAuditSink,
  NullAuditSink,
  type AuditSink,
} from './audit-log.js'

// 核心检查与 Manager
export { checkPermission, findMatchingRule, type CheckPermissionOptions } from './checker.js'
export {
  PermissionManager,
  type PermissionManagerEvent,
  type PermissionManagerListener,
  type PermissionManagerOptions,
} from './manager.js'

// 沙箱
export {
  ChildProcessSandbox,
  NullSandbox,
  DEFAULT_ENV_WHITELIST,
  buildSandboxedEnv,
  type SandboxAdapter,
  type SandboxExecOptions,
  type SandboxExecResult,
} from './sandbox-adapter.js'

// 与旧 PermissionTier 的桥接
export {
  decisionToTier,
  isHardDeny,
  shouldUsePreamble,
  bridgeResult,
  type BridgedTier,
} from './tier-bridge.js'
