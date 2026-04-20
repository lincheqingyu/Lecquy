# Skill Runtime 层 技术规范

更新日期：2026-04-10

所属开发包：包 5（Skill Runtime 层）
前置依赖：包 0 + 包 1 + 包 2 + 包 3 + 包 4
预估工期：1-2 天

## 1. 目标

把当前「摘要注入 + 直接正文加载」的 skill 系统升级为 v2 的 manifest-first + 常驻规则 + 版本冻结。确保 skill 正文注入后常驻在 prefix cache 段内，磁盘热更新不影响当前会话。

## 2. 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `core/skills/skill-loader.ts` | 改造 | manifest 校验 + specificity + 静态拒绝 |
| `core/skills/skill-session.ts` | **新建** | 会话级 skill 常驻管理器 |
| `core/prompts/prompt-serializer.ts` | 改造 | skill slice 的注入和移除 |
| `agent/agent-runner.ts` | 改造 | skill 工具调用触发 loadAndFreeze |
| `agent/worker-runner.ts` | 改造 | worker 使用已冻结的 skill |

## 3. 改造 `core/skills/skill-loader.ts`

### 3.1 扩展 manifest 格式

当前 SKILL.md frontmatter 仅支持 `name / description / direct_return`。扩展为：

```typescript
export interface SkillManifest {
  /** 必须 */
  name: string
  /** 必须 */
  description: string
  /** 可选：分类 */
  category?: string
  /** 可选：触发条件描述 */
  trigger_when?: string
  /** 可选：必须输入 */
  required_inputs?: string[]
  /** 可选：风险等级 */
  risk_level?: 'low' | 'medium' | 'high'
  /** 可选：是否直接返回结果 */
  direct_return?: boolean
  /** 可选：具体度分值，数值越高越具体；多命中时选最高 */
  specificity?: number
}
```

### 3.2 manifest 校验函数

```typescript
/**
 * 校验 skill manifest 是否合规
 * v1 最低要求：name + description 必须存在
 */
export function validateSkillManifest(manifest: SkillManifest): {
  valid: boolean
  reason?: string
} {
  if (!manifest.name || !manifest.description) {
    return { valid: false, reason: 'name 和 description 为必填字段' }
  }
  return { valid: true }
}
```

### 3.3 skill body 静态拒绝

```typescript
/**
 * 检查 skill 正文是否包含禁止的指令
 */
export function validateSkillBody(body: string): {
  valid: boolean
  reason?: string
} {
  const BLACKLIST = [
    /override\s+mode/i,
    /bypass\s+confirm/i,
    /skip\s+validation/i,
    /ignore\s+safety/i,
    /override\s+system/i,
    /覆盖模式/,
    /绕过确认/,
    /跳过验证/,
    /忽略安全/,
  ]

  for (const pattern of BLACKLIST) {
    if (pattern.test(body)) {
      return { valid: false, reason: `skill 正文包含禁止的指令: ${pattern.source}` }
    }
  }
  return { valid: true }
}
```

### 3.4 改造 scanSkills

在扫描时对每个 skill 执行 manifest 校验：

```typescript
export async function scanSkills(workspaceDir: string): Promise<Map<string, Skill>> {
  // ... 现有扫描逻辑 ...

  // 新增：manifest 校验
  for (const [name, skill] of result) {
    // baseline skill 豁免校验
    if (BASELINE_SKILLS.includes(name)) continue

    const manifestCheck = validateSkillManifest(skill.manifest)
    if (!manifestCheck.valid) {
      logger.warn(`skill "${name}" manifest 不合规: ${manifestCheck.reason}，已跳过`)
      result.delete(name)
      continue
    }

    const bodyCheck = validateSkillBody(skill.body)
    if (!bodyCheck.valid) {
      logger.warn(`skill "${name}" 正文被拒绝: ${bodyCheck.reason}，已跳过`)
      result.delete(name)
    }
  }

  return result
}
```

### 3.5 baseline 豁免列表

```typescript
/**
 * baseline 能力列表
 * 这些 skill 不走 manifest 校验，直接加载
 */
export const BASELINE_SKILLS = ['pdf', 'docx', 'xlsx', 'pptx'] as const
```

### 3.6 多命中时的 specificity 选择

```typescript
/**
 * 从多个命中 skill 中选择最具体的一个
 * 规则：specificity 最高者优先；相同则按名称字母序选第一个
 */
export function selectMostSpecificSkill(candidates: Skill[]): Skill {
  return candidates.sort((a, b) => {
    const specA = a.manifest.specificity ?? 0
    const specB = b.manifest.specificity ?? 0
    if (specB !== specA) return specB - specA
    return a.manifest.name.localeCompare(b.manifest.name)
  })[0]
}
```

## 4. 新建 `core/skills/skill-session.ts`

### 4.1 职责

管理单个会话内 skill 的冻结、常驻和卸载。

### 4.2 接口

```typescript
import { LayerSlice, PromptLayer } from '../prompts/prompt-layer-types'
import { createSlice } from '../prompts/prompt-serializer'

/**
 * 会话级 Skill 常驻管理器
 *
 * 生命周期规则：
 * - 命中后冻结，当前会话内字节不变
 * - 同一会话最多常驻 1 个 skill
 * - 仅模式切换或显式卸载时移除
 * - 磁盘文件变更不影响当前冻结版本
 */
export class SkillSession {
  private frozenSkill: {
    name: string
    content: string
    contentHash: string
  } | null = null

  /**
   * 加载并冻结一个 skill
   * 如果已有冻结 skill，先卸载再加载新的
   *
   * @returns 冻结后的 LayerSlice
   */
  loadAndFreeze(name: string, content: string): LayerSlice {
    this.frozenSkill = {
      name,
      content,
      contentHash: hashContent(content),
    }
    return createSlice(PromptLayer.SkillRuntime, content, { id: name })
  }

  /**
   * 获取当前冻结 skill 的 LayerSlice
   * 无冻结 skill 时返回空内容 slice（序列化器会跳过）
   */
  getSlice(): LayerSlice {
    if (!this.frozenSkill) {
      return createSlice(PromptLayer.SkillRuntime, '')
    }
    return createSlice(
      PromptLayer.SkillRuntime,
      this.frozenSkill.content,
      { id: this.frozenSkill.name }
    )
  }

  /**
   * 是否有常驻 skill
   */
  hasActiveSkill(): boolean {
    return this.frozenSkill !== null
  }

  /**
   * 获取当前冻结 skill 名称
   */
  getActiveSkillName(): string | null {
    return this.frozenSkill?.name ?? null
  }

  /**
   * 卸载当前 skill
   * 仅在模式切换或显式卸载时调用
   */
  unload(): void {
    this.frozenSkill = null
  }
}
```

### 4.3 与 prompt-serializer 的配合

```typescript
// 在 buildLayeredSystemPrompt 中
export function buildLayeredSystemPrompt(
  options: BuildLayeredPromptOptions,
  skillSession: SkillSession  // 新增参数
): LayeredPromptResult {
  // ...
  const skillSlice = skillSession.getSlice()
  // ...
}
```

## 5. 改造 `agent/agent-runner.ts`

### 5.1 skill 工具调用触发冻结

当 LLM 调用 `skill` 工具时：

```typescript
// 在 agentLoop 中处理 skill 工具调用
if (toolCall.name === 'skill') {
  const skillName = toolCall.arguments.name as string

  // 检查是否已有不同的冻结 skill
  if (skillSession.hasActiveSkill() && skillSession.getActiveSkillName() !== skillName) {
    // 同一会话内只允许 1 个 skill
    // 返回工具错误，提示当前已有活跃 skill
    return toolError(`当前会话已有活跃 skill: ${skillSession.getActiveSkillName()}，请先完成当前任务`)
  }

  // 加载 skill 内容
  const skillContent = await getSkillContent(skillName)

  if (!skillSession.hasActiveSkill()) {
    // 首次加载：冻结并重建 system prompt
    skillSession.loadAndFreeze(skillName, skillContent)

    // 重建 system prompt（skill slice 已变化）
    const newResult = buildLayeredSystemPrompt(options, skillSession)
    currentSystemPrompt = newResult.systemPrompt
  }

  // 返回 skill 内容给 LLM
  return toolResult(skillContent)
}
```

### 5.2 模式切换时卸载

```typescript
// 在 session-runtime-service 的模式切换逻辑中
function onModeSwitch(newMode: SessionMode) {
  skillSession.unload()
  // 重建 system prompt
}
```

## 6. 改造 `agent/worker-runner.ts`

worker 使用 manager 所在会话的 `skillSession`：

```typescript
export interface WorkerRunOptions {
  // ... 已有字段 ...
  /** 当前会话的 skill session（共享冻结状态） */
  skillSession: SkillSession
}

// worker 的 system prompt 使用与 manager 相同的冻结 skill
const workerSystemPrompt = buildLayeredSystemPrompt(workerOptions, options.skillSession)
```

## 7. session-runtime-service 接入（包 5 完成后）

```typescript
// 包 5 接入

// 1. 为每个会话创建 SkillSession 实例
const skillSessionMap = new Map<string, SkillSession>()

function getSkillSession(sessionId: string): SkillSession {
  if (!skillSessionMap.has(sessionId)) {
    skillSessionMap.set(sessionId, new SkillSession())
  }
  return skillSessionMap.get(sessionId)!
}

// 2. 传入 agent runner
const skillSession = getSkillSession(sessionId)
const result = buildLayeredSystemPrompt(layeredOptions, skillSession)

// 3. 模式切换时卸载
function handleModeSwitch(sessionId, newMode) {
  getSkillSession(sessionId).unload()
}

// 4. 会话结束时清理
function handleSessionEnd(sessionId) {
  skillSessionMap.delete(sessionId)
}
```

## 8. 验收标准

### 8.1 协议测试

| # | 用例 | 预期 |
|---|---|---|
| 1 | manifest 缺 name | skill 被跳过，不加载 |
| 2 | manifest 缺 description | skill 被跳过，不加载 |
| 3 | skill body 含 "override mode" | skill 被拒绝 |
| 4 | skill body 含 "绕过确认" | skill 被拒绝 |
| 5 | 3 个 skill 同时命中 | 选 specificity 最高者 |
| 6 | specificity 相同 | 按名称字母序选第一个 |
| 7 | baseline skill (pdf) | 不经过 manifest 校验，直接加载 |
| 8 | 同一会话加载第二个 skill | 返回错误提示 |
| 9 | 模式切换后 | skill 卸载，可加载新 skill |

### 8.2 序列化稳定性测试

| # | 用例 | 预期 |
|---|---|---|
| 1 | skill 冻结后，磁盘 SKILL.md 文件内容变更 | 当前会话 system prompt 字节不变 |
| 2 | skill 冻结后连续 10 次 buildLayeredSystemPrompt | skill slice 字节一致 |
| 3 | skill 卸载后 | system prompt 中无 `<LAYER:skill>` 标签 |

### 8.3 回归测试

| # | 用例 | 预期 |
|---|---|---|
| 1 | simple 模式调用 pdf skill | skill 加载并冻结，后续回合保持 |
| 2 | plan 模式 worker 使用 skill | 使用 manager 会话的冻结 skill |
| 3 | baseline skill 调用 | 直接加载，无 manifest 校验 |
| 4 | `LAYERED_PROMPT=false` | 旧 skill 路径正常工作 |

## 9. 不改动的部分

- skill 的三层加载优先级逻辑（bundle > workspace > runtime）
- `listSkillSummaries()` 的行为（仍用于 system 层 skill index）
- `getSkillContent()` 的内容读取逻辑
- `isDirectReturn()` 的行为
- skill 的资源文件组织（scripts / references / assets）

## 10. 实现注意事项

1. `SkillSession` 的生命周期绑定到会话，不绑定到请求。这意味着 WebSocket 重连后，只要是同一会话，skill 冻结状态应该保持。
2. `frozenSkill.content` 在整个常驻期内字节不变，即使磁盘文件被修改。下一次模式切换后的新会话才会读取新版本。
3. baseline skill 豁免的判断基于 skill name 精确匹配，不走模糊匹配。
4. 静态拒绝的关键词列表是硬编码的，不从配置文件读取，避免被 skill 间接篡改。
