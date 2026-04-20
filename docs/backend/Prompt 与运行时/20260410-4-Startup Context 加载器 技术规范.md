# Startup Context 加载器 技术规范

更新日期：2026-04-10

所属开发包：包 2（Startup Context Loader）
前置依赖：包 0 + 包 1
预估工期：1-2 天

## 1. 目标

把 `context-files.ts` 从「6 文件平铺加载」改为「受控切片 + capability block + 预算截断」。AGENTS.md / TOOLS.md 的动态生成内容收回 system 层，不再经过 startup context。新建 USER.md 解析器和 capability block 生成器。

## 2. 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `core/prompts/context-files.ts` | 改造 | 新增 `loadStartupSlices`，旧函数保留为 legacy |
| `core/prompts/user-md-parser.ts` | **新建** | USER.md 解析器 |
| `core/prompts/capability-block.ts` | **新建** | `<CAPABILITY>` block 生成器 |

## 3. 新建 `user-md-parser.ts`

### 3.1 函数签名

```typescript
import { UserMdSlices, USER_MD_SCHEMA, STARTUP_BUDGETS } from './prompt-layer-types'

/**
 * 解析 USER.md 为 profile / preference 双切片
 *
 * @param raw - USER.md 原始文本
 * @returns UserMdSlices
 */
export function parseUserMd(raw: string): UserMdSlices
```

### 3.2 解析流程

```
1. 解析 frontmatter
   - 提取 --- 包裹的 YAML 块
   - 校验 schema 字段 === 'lecquy.user/v1'
   - schema 不匹配 → rejected=true, reason='schema_mismatch'

2. 按二级标题切分
   - 扫描 /^## (.+)$/gm 匹配的所有二级标题
   - 找 '## profile' 和 '## preference'（大小写不敏感）
   - 出现第三个及以上二级标题 → rejected=true, reason='extra_h2_found'
   - 缺失 ## profile → profileSlice = ''（补空，不报错）
   - 缺失 ## preference → preferenceSlice = ''（补空，不报错）

3. 黑名单校验
   - profile 段黑名单（命中则 profileSlice 置空）：
     /语气|风格|口吻|请用.*语气|回答要/
   - preference 段黑名单（命中则 preferenceSlice 置空）：
     /跳过确认|自动执行|禁用验证|忽略权限|override|bypass|sudo|绕过/
   - 命中时 rejected=false，但 rejectReason 记录哪个段被置空

4. 预算截断
   - profileSlice: estimateTokens() > STARTUP_BUDGETS.userProfile → 尾部截断
   - preferenceSlice: estimateTokens() > STARTUP_BUDGETS.userPreference → 尾部截断

5. 返回 { profileSlice, preferenceSlice, rejected, rejectReason }
```

### 3.3 无 frontmatter 的兼容处理

如果 USER.md 没有 frontmatter（旧格式），不报错，视为整个文件内容都是 profile，preference 补空。这保证向后兼容。

### 3.4 USER.md 骨架模板

新会话创建 `.lecquy/USER.md` 时，使用以下骨架：

```markdown
---
schema: lecquy.user/v1
updated_at: 2026-04-10
---

## profile


## preference

```

## 4. 新建 `capability-block.ts`

### 4.1 函数签名

```typescript
import { CapabilityBlock } from './prompt-layer-types'

/**
 * 生成 <CAPABILITY> block 文本
 * 输出格式固定，同一输入 → 字节一致
 */
export function buildCapabilityBlock(cap: CapabilityBlock): string
```

### 4.2 输出格式

```
<CAPABILITY>
executor=powershell
available=[fs.read, fs.write, exec, docx, pdf, xlsx, pptx]
unavailable=[no_browser, no_external_api, no_deploy]
</CAPABILITY>
```

规则：

- `available` 和 `unavailable` 的数组元素按字母序排列，保证字节确定性
- 每个字段占一行，字段顺序固定：executor → available → unavailable
- 无尾随空白

### 4.3 capability 数据来源

由 `session-runtime-service.ts` 在构建 prompt 时根据当前环境决定：

```typescript
// 示例：根据 OS 和工具集生成 capability
const capability: CapabilityBlock = {
  executor: process.platform === 'win32' ? 'powershell' : 'shell',
  available: tools.filter(t => t.enabled).map(t => t.name).sort(),
  unavailable: ['no_browser', 'no_external_api', 'no_deploy'].sort(),
}
```

## 5. 改造 `context-files.ts`

### 5.1 新函数签名

```typescript
/**
 * 加载 startup context 所需的所有切片
 *
 * 替代原 readPromptContextFiles()，按 v2 分层规范切片
 */
export async function loadStartupSlices(options: {
  workspaceDir: string
  role: AgentRole
  capability: CapabilityBlock
}): Promise<{
  /** CAPABILITY + SOUL + IDENTITY + USER.profile + MEMORY.summary → 层 3 */
  startupSlice: LayerSlice
  /** USER.preference → 层 5 */
  preferenceSlice: LayerSlice
  /** AGENTS + TOOLS 动态生成内容 → 归入层 1 (system) */
  managedSystemContent: string
  /** USER.md 解析事件（用于前端警告） */
  userMdEvent?: { type: 'user_md_truncated' | 'user_md_rejected'; reason: string }
}>
```

### 5.2 加载逻辑

```
1. 读取文件
   - SOUL.md: readFile(.lecquy/SOUL.md) → soulContent
   - IDENTITY.md: readFile(.lecquy/IDENTITY.md) → identityContent
   - USER.md: readFile(.lecquy/USER.md) → raw → parseUserMd(raw) → userSlices
   - MEMORY.summary.md: readFile(.lecquy/MEMORY.summary.md) → memorySummary
     - 文件不存在 → 空字符串（不报错）

2. 角色过滤
   - worker 角色：soulContent = '', identityContent = '', userSlices 清空
   - simple / manager 角色：全部加载

3. 构建 startup slice
   内容拼接顺序（固定，字节级契约）：
   a. buildCapabilityBlock(capability)
   b. '\n\n'
   c. '## SOUL\n' + soulContent   （如果非空）
   d. '\n\n'
   e. '## IDENTITY\n' + identityContent   （如果非空）
   f. '\n\n'
   g. '## USER PROFILE\n' + userSlices.profileSlice   （如果非空）
   h. '\n\n'
   i. '## MEMORY SUMMARY\n' + memorySummary   （如果非空）

4. 预算校验
   - estimateTokens(startupContent) > STARTUP_BUDGETS.startupTotal
   - 超出时按保留优先级截断：CAPABILITY > SOUL > IDENTITY > profile > summary
   - 从最低优先级（summary）开始截断

5. 构建 preference slice
   - 内容 = userSlices.preferenceSlice
   - 如果为空则返回空 slice（序列化器会跳过空 LAYER）

6. 生成 managed system content
   - buildManagedAgentsContent(workspaceDir, role)
   - buildManagedToolsContent(workspaceDir, role)
   - 合并为单个字符串返回

7. 返回结果
```

### 5.3 保留旧函数

```typescript
/**
 * @deprecated 使用 loadStartupSlices 替代
 */
export async function readPromptContextFiles(...): Promise<PromptContextFile[]>
```

旧函数保持不变，由 `buildSystemPromptLegacy` 继续调用。

## 6. session-runtime-service 接入（包 2 完成后）

```typescript
// 包 2 接入：startup 数据源切换
if (USE_LAYERED_PROMPT) {
  const { startupSlice, preferenceSlice, managedSystemContent, userMdEvent } =
    await loadStartupSlices({ workspaceDir, role, capability })

  // managedSystemContent 传入 buildLayeredSystemPrompt → 合并到 system 层
  // startupSlice / preferenceSlice 传入 buildLayeredSystemPrompt
  // userMdEvent 如有则通过 ws 事件通知前端
}
```

## 7. 验收标准

### 7.1 协议测试

| # | 用例 | 预期 |
|---|---|---|
| 1 | USER.md 含第三个 H2 | 整文件 rejected，profileSlice 和 preferenceSlice 均为空 |
| 2 | USER.md preference 段含「跳过确认」 | preferenceSlice 置空，profileSlice 不受影响 |
| 3 | USER.md 无 frontmatter | 不报错，整文件视为 profile |
| 4 | USER.md 不存在 | 不报错，双切片均为空 |
| 5 | MEMORY.summary.md 不存在 | 不报错，summary 为空 |
| 6 | worker 角色 | startup slice 不含 SOUL / IDENTITY / USER |
| 7 | AGENTS.md / TOOLS.md | 不出现在 startup slice 中，出现在 managedSystemContent 中 |

### 7.2 序列化稳定性测试

| # | 用例 | 预期 |
|---|---|---|
| 1 | capability block 同一输入 | 字节一致 |
| 2 | profileSlice 变化 | preferenceSlice 字节不变 |
| 3 | startup 整体拼接同一输入 | 字节一致 |

### 7.3 预算测试

| # | 用例 | 预期 |
|---|---|---|
| 1 | profileSlice 超 400 tokens | 尾部截断到 400 |
| 2 | startup 总量超 1500 tokens | 按优先级从 summary 开始截断 |
| 3 | capability block ≤ 200 tokens | 正常通过 |

### 7.4 回归测试

| # | 用例 | 预期 |
|---|---|---|
| 1 | `LAYERED_PROMPT=true` 跑 simple 模式 | SOUL / IDENTITY / USER 内容在 prompt 中存在 |
| 2 | `LAYERED_PROMPT=false` | 旧路径不受影响 |

## 8. 不改动的部分

- memory 注入逻辑（包 3）
- skill 加载逻辑（包 5）
- tool 注册逻辑（包 4）
- `buildManagedAgentsContent` / `buildManagedToolsContent` 的生成逻辑不改，只改它们的归属层
