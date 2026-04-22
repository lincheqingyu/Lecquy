# Claude Code 权限系统源代码导航

**文档目的**：为 Opus 深度分析提供代码导航地图  
**参考项目**：`/sessions/fervent-inspiring-pasteur/mnt/Kuberwastaken-src`  
**生成日期**：2026-04-20

---

## 1. 核心权限系统文件地图

### 1.1 权限类型定义（入口点）

**文件**：`types/permissions.ts` (100+ 行)

```typescript
// 权限模式定义
EXTERNAL_PERMISSION_MODES = [
  'acceptEdits',
  'bypassPermissions', 
  'default',
  'dontAsk',
  'plan'
]

// 内部模式
InternalPermissionMode = ExternalPermissionMode | 'auto' | 'bubble'

// 权限行为
PermissionBehavior = 'allow' | 'deny' | 'ask'

// 规则来源
PermissionRuleSource = 
  | 'userSettings'
  | 'projectSettings'
  | 'localSettings'
  | 'flagSettings'
  | 'policySettings'
  | 'cliArg'
  | 'command'
  | 'session'

// 规则结构
PermissionRule = {
  source: PermissionRuleSource
  ruleBehavior: PermissionBehavior
  ruleValue: {
    toolName: string
    ruleContent?: string
  }
}
```

**关键代码特征**：
- 使用 TypeScript `as const` 确保类型安全
- 通过 `feature('TRANSCRIPT_CLASSIFIER')` 条件编译控制功能
- 导出分离以避免循环引用

---

### 1.2 权限决策结果

**文件**：`utils/permissions/PermissionResult.ts`

```typescript
type PermissionDecision = 
  | PermissionAllowDecision
  | PermissionDenyDecision
  | PermissionAskDecision
  | PermissionPlanDecision

type PermissionAllowDecision = {
  behavior: 'allow'
  reason: string
  source?: PermissionRuleSource
}

type PermissionDenyDecision = {
  behavior: 'deny'
  reason: string
  source?: PermissionRuleSource
}

// 用于返回给 AI 的完整结果
type PermissionResult = {
  decision: PermissionDecision
  // 可用的建议规则更新
  suggestedUpdates?: PermissionUpdate[]
  // 权限追踪信息
  denyalTrackingState?: DenialTrackingState
}
```

**关键关联**：
- 与 `denialTracking.ts` 关联（权限拒绝追踪）
- 与 `permissions.ts` 的检查流程绑定

---

## 2. 规则管理系统

### 2.1 权限规则解析和验证

**文件**：`utils/permissions/PermissionRule.ts` (80+ 行)

```typescript
// 使用 Zod 进行运行时验证
const permissionBehaviorSchema = z.enum(['allow', 'deny', 'ask'])

const permissionRuleValueSchema = z.object({
  toolName: z.string(),
  ruleContent: z.string().optional(),
})
```

**特点**：
- 延迟加载 schema（`lazySchema`）避免循环依赖
- 支持规则内容的自定义处理

---

### 2.2 权限规则更新机制

**文件**：`utils/permissions/PermissionUpdate.ts` (389 行)

**核心操作**：
```typescript
type PermissionUpdate = 
  | { type: 'addRules', rules: PermissionRule[] }
  | { type: 'removeRules', rules: PermissionRule[] }
  | { type: 'replaceRules', rules: PermissionRule[] }

// 应用规则更新到内存
function applyPermissionUpdate(
  current: PermissionRule[],
  update: PermissionUpdate
): PermissionRule[]

// 持久化到文件系统
function persistPermissionUpdates(
  updates: PermissionUpdate[],
  destination: PermissionUpdateDestination
): Promise<void>
```

**关键特性**：
- 支持将更新保存到不同源（用户/项目/本地/会话）
- 规则冲突检测（`shadowedRuleDetection.ts`）
- 版本管理和审计日志

---

### 2.3 权限配置加载

**文件**：`utils/permissions/permissionsLoader.ts` (296 行)

```typescript
// 从多个源加载规则
async function loadPermissionRules(
  sources: PermissionRuleSource[]
): Promise<PermissionRule[]>

// 优先级排序
function sortRulesByPriority(rules: PermissionRule[]): PermissionRule[]

// 检测被遮蔽的规则
function detectShadowedRules(
  rules: PermissionRule[]
): ShadowedRuleReport
```

**优先级顺序**（高到低）：
1. `cliArg` - 命令行参数最优先
2. `session` - 当前会话
3. `command` - 命令级
4. `flagSettings` - 特性标志
5. `policySettings` - 企业政策
6. `localSettings` - 本地设置
7. `projectSettings` - 项目设置
8. `userSettings` - 用户设置

---

## 3. 命令分类系统

### 3.1 YOLO 分类器主实现

**文件**：`utils/permissions/yoloClassifier.ts` (1495 行)

这是整个权限系统中**最复杂**的模块。

**核心流程**：
```typescript
type YoloClassifierResult = {
  decision: 'allow' | 'deny' | 'ask'
  confidence: 'high' | 'medium' | 'low'
  reason: string
  matchedDescription?: string
}

async function classifyWithYolo(
  command: string,
  context: ToolPermissionContext
): Promise<YoloClassifierResult>
```

**关键子系统**：
- **缓存机制**：避免对相同命令重复分类
- **侧查询** (`sideQuery`)：调用 Claude API 进行分类
- **提示工程**：使用动态提示词优化分类准确率
- **令牌计算**：估算提示成本

**分类提示来源**：
```
- Bash Deny 描述：明确禁止的命令模式
- Bash Ask 描述：需要用户确认的操作
- Bash Allow 描述：允许自动执行的操作
```

### 3.2 分类器决策

**文件**：`utils/permissions/classifierDecision.ts`

```typescript
// 基于分类结果做决策
function makeDecisionFromClassification(
  classificationResult: YoloClassifierResult,
  permissionMode: PermissionMode
): PermissionDecision
```

**决策矩阵**：

| 分类结果 | 权限模式 | 最终决策 |
|---------|---------|---------|
| high deny | any | DENY |
| high allow | acceptEdits | ALLOW |
| high allow | other | ALLOW |
| medium/low | auto | ASK |
| - | bypassPermissions | ALLOW |

### 3.3 Bash 特定分类

**文件**：`utils/permissions/bashClassifier.ts` (存根实现)

在泄露的源码中，这是一个存根：
```typescript
// 存根实现 - Anthropic 的内部版本更复杂
async function classifyBashCommand(
  command: string,
  cwd: string,
  descriptions: string[],
  behavior: ClassifierBehavior
): Promise<ClassifierResult> {
  return {
    matches: false,
    confidence: 'high',
    reason: 'This feature is disabled'
  }
}
```

**预期的完整实现应包含**：
- 命令语法解析
- 危险操作识别（rm, dd, fork 炸弹等）
- 权限提升检测（sudo, su）
- 网络操作检测（curl, wget, nc）
- 系统修改检测（apt, yum, brew）

---

## 4. 文件系统权限

### 4.1 文件系统保护主模块

**文件**：`utils/permissions/filesystem.ts` (1777 行)

这是代码量最大的权限模块。

**核心常量**：
```typescript
const DANGEROUS_FILES = [
  '.gitconfig',
  '.bashrc',
  '.zshrc',
  '.mcp.json',
  '.claude.json',
  // ... 10+ 个文件
]

const DANGEROUS_DIRECTORIES = [
  '.git',
  '.vscode',
  '.idea',
  '.claude',
]
```

**文件权限检查函数**：
```typescript
// 检查是否可以编辑文件
function canEditFile(
  filePath: string,
  context: ToolPermissionContext
): PermissionResult

// 检查是否可以删除文件
function canDeleteFile(
  filePath: string,
  context: ToolPermissionContext
): PermissionResult

// 检查是否可以执行文件
function canExecuteFile(
  filePath: string,
  context: ToolPermissionContext
): PermissionResult
```

**安全检查清单**：
- ✅ 危险文件名检测
- ✅ 危险目录保护
- ✅ 路径遍历检测
- ✅ 符号链接跟踪
- ✅ UNC 路径检查（Windows）
- ✅ 特殊权限检查

### 4.2 路径验证

**文件**：`utils/permissions/pathValidation.ts` (485 行)

```typescript
// 路径遍历检测
function containsPathTraversal(path: string): boolean
  // 检查 '../' 等遍历序列

// UNC 路径风险检测
function containsVulnerableUncPath(path: string): boolean
  // 检查 \\?\GlobalRoot 等 Windows 特殊路径

// 路径规范化
function normalizePath(path: string): string
  // 统一分隔符和格式

// 路径扩展
function expandPath(path: string, baseDir: string): string
  // 处理 ~, $HOME 等变量
```

---

## 5. 权限模式管理

### 5.1 权限模式转换

**文件**：`utils/permissions/getNextPermissionMode.ts`

```typescript
// 用户可以在权限模式之间切换
function getNextPermissionMode(
  current: PermissionMode
): PermissionMode

// 用户友好的模式标题
function permissionModeTitle(mode: PermissionMode): string
```

**模式循环**：
```
default → dontAsk → plan → bypassPermissions → acceptEdits → default
```

### 5.2 自动模式状态

**文件**：`utils/permissions/autoModeState.ts`

```typescript
// 自动模式的状态管理
type AutoModeState = {
  seenCommands: Set<string>
  confidenceBatches: Map<string, 'high' | 'medium' | 'low'>
  timestamp: number
}
```

---

## 6. 权限拒绝追踪

### 6.1 拒绝记录系统

**文件**：`utils/permissions/denialTracking.ts`

```typescript
type DenialTrackingState = {
  deniedAt: number
  reason: string
  source: PermissionRuleSource
  attemptCount: number
  suggestedActions: string[]
}
```

**用途**：
- 记录被拒绝的操作
- 为用户提供故障排除建议
- 累计拒绝次数以检测滥用

---

## 7. 沙箱管理

### 7.1 沙箱适配器

**文件**：`utils/sandbox/sandbox-adapter.ts`

```typescript
class SandboxManager {
  // 初始化沙箱
  async initialize(): Promise<void>
  
  // 在沙箱中执行命令
  async executeInSandbox(
    command: string,
    options: SandboxExecOptions
  ): Promise<SandboxResult>
  
  // 沙箱资源限制
  setResourceLimits(limits: {
    timeout?: number
    maxMemory?: number
    maxCpuTime?: number
  }): void
  
  // 清理沙箱
  async cleanup(): Promise<void>
}
```

**隔离机制**：
- 进程级隔离（Linux: cgroups, seccomp）
- 文件系统视图隔离
- 网络隔离
- 资源限制

---

## 8. 权限检查入口

### 8.1 主权限检查函数

**文件**：`utils/permissions/permissions.ts` (1486 行)

这是整个系统的**决策引擎**。

```typescript
async function checkPermissions(
  tool: Tool,
  context: ToolPermissionContext
): Promise<PermissionResult>
```

**完整决策流程**：
```
1. 获取工具和操作上下文
2. 遍历权限规则（按优先级）
3. 尝试找到匹配的规则
4. 如果找到 'deny' 规则 → 返回拒绝
5. 如果找到 'allow' 规则 → 返回允许
6. 如果找到 'ask' 规则或无匹配
   ├─ 检查权限模式
   ├─ 如果是 auto 模式 → 调用分类器
   └─ 否则 → 返回需要询问用户
7. 返回完整的 PermissionResult（含建议更新）
```

---

## 9. Opus 深度分析任务清单

### 需要详细解析的代码块：

- [ ] **yoloClassifier.ts 的完整流程**
  - 侧查询 API 调用方式
  - 提示词动态生成
  - 缓存和性能优化
  - 令牌使用计算

- [ ] **classifierDecision.ts 的决策矩阵**
  - 不同权限模式下的行为
  - 置信度阈值设定
  - 用户交互流程

- [ ] **filesystem.ts 的安全检查**
  - 所有检查函数的实现细节
  - 特殊路径处理
  - Windows/Unix 兼容性逻辑

- [ ] **permissionSetup.ts 的初始化**
  - 配置文件格式
  - 默认规则集
  - 用户向导流程

- [ ] **sandbox-adapter.ts 的隔离实现**
  - 不同操作系统的实现
  - 资源限制机制
  - 逃逸防护

---

## 10. 参考代码量统计

| 文件 | 行数 | 复杂度 | 优先级 |
|------|------|-------|-------|
| permissions.ts | 1486 | ⭐⭐⭐⭐ | 🔴 最高 |
| filesystem.ts | 1777 | ⭐⭐⭐⭐ | 🔴 最高 |
| yoloClassifier.ts | 1495 | ⭐⭐⭐⭐⭐ | 🔴 最高 |
| permissionSetup.ts | 1532 | ⭐⭐⭐ | 🟠 高 |
| pathValidation.ts | 485 | ⭐⭐⭐ | 🟠 高 |
| PermissionUpdate.ts | 389 | ⭐⭐⭐ | 🟠 高 |
| permissionsLoader.ts | 296 | ⭐⭐⭐ | 🟠 高 |
| sandbox-adapter.ts | ? | ⭐⭐⭐⭐ | 🟠 高 |

**总计**：9400+ 行核心权限代码

---

**生成日期**：2026-04-20  
**下一阶段**：Claude Opus 深度分析以上列出的文件
