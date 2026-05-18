# P1 FrozenSystemSnapshot Builder 开发指导

> 更新日期：2026-05-18
> 类型：技术规范
> 前置：[P0 入口同步与 Prompt 链路审查](./20260518-2-P0%20入口同步与%20Prompt%20链路审查%20报告.md)

## 1. P1 目标

P1 只做 `FrozenSystemSnapshot` 的生成、存储和复用，不实现 `<system_prompt_update>`。

完成后必须满足：

- 新会话首次请求生成一个 snapshot。
- 同一 snapshot 生命周期内，`buildRunSystemPrompt` 返回同一个 `systemText`。
- 修改 `USER.md`、跨日、切换模型、skill 热更新等事件不会直接改写当前 `systemText`。
- 旧 layered builder 和 legacy builder 都不删除。
- snapshot / replay 相关测试能证明 system 字节稳定。

## 2. 非目标

- 不迁移 `.lecquy/system-prompt/` 到 `BASE.md`。
- 不删除 `buildSystemPromptLegacy`。
- 不实现 `<system_prompt_update>` diff 摘要。
- 不改 MemoryRecall tag。
- 不做 provider adapter 重构。
- 不做 compact / resnapshot 的完整流程，只预留接口。

## 3. 新增类型

建议新增文件：

- `backend/src/core/prompts/system-prompt-snapshot.ts`

最小类型：

```ts
export interface FrozenSystemSnapshot {
  readonly sessionId: string
  readonly snapshotId: string
  readonly createdAt: string
  readonly createdReason: 'session_created' | 'resnapshot' | 'compact' | 'manual'
  readonly role: 'simple' | 'manager' | 'worker'
  readonly mode: 'simple' | 'plan'
  readonly timeZone?: string
  readonly modelId?: string
  readonly activeSkillName?: string
  readonly sourceHashes: FrozenSystemSourceHashes
  readonly sliceHashes: Record<string, string>
  readonly sliceTokens: Record<string, number>
  readonly systemText: string
  readonly contentHash: string
}

export interface FrozenSystemSourceHashes {
  readonly promptModules: Record<string, string>
  readonly managedAgents: string
  readonly managedTools: string
  readonly soul: string
  readonly identity: string
  readonly user: string
  readonly memorySummary: string
  readonly toolInventory: string
  readonly skillsIndex: string
  readonly activeSkill?: string
  readonly runtimeInputs: string
}
```

说明：

- `contentHash` 由最终 `systemText` 计算。
- `sourceHashes` 记录来源，不参与 provider adapter。
- `runtimeInputs` 只记录 snapshot 创建时被冻住的运行时输入，如 role/mode/timezone/model/channel/toolsEnabled。
- `sourceHashes` 中的 `managedAgents` / `managedTools` 必须记录生成内容 hash，因为当前代码不读 `.lecquy/AGENTS.md` 和 `.lecquy/TOOLS.md` 的磁盘正文。

## 4. Builder API

建议新增：

```ts
export interface BuildFrozenSystemSnapshotRequest {
  readonly sessionId: string
  readonly createdReason: FrozenSystemSnapshot['createdReason']
  readonly role: AgentRole
  readonly mode: 'simple' | 'plan'
  readonly workspaceDir: string
  readonly route?: SessionRouteContext
  readonly modelId: string
  readonly thinkingLevel?: string
  readonly tools: ReadonlyArray<AgentTool<any>>
  readonly toolsEnabled: boolean
  readonly extraInstructions?: string
  readonly activeSkillName?: string
  readonly skillSession?: SkillSession
  readonly now?: Date
}

export async function buildFrozenSystemSnapshot(
  request: BuildFrozenSystemSnapshotRequest,
): Promise<FrozenSystemSnapshot>
```

第一版实现策略：

1. 复用 `SessionRuntimeService.buildPromptCapability` 的等价逻辑，或把该逻辑下沉成可复用纯函数。
2. 调用 `loadStartupSlices`。
3. 构造 `BuildLayeredPromptOptions`。
4. 调用 `buildLayeredSystemPrompt` 得到 `systemPrompt`、`sliceHashes`、`sliceTokens`。
5. 计算 `sourceHashes` 与 `contentHash`。
6. 返回 immutable snapshot 对象。

## 5. 时间冻结

当前 `system-prompts.ts` 的 `buildTimeSection` 内部直接调用 `new Date()`，这会让同一输入跨分钟后输出不同 system。

P1 需要做一处小改造：

```ts
interface BuildLayeredPromptOptions {
  readonly snapshotNow?: string
}
```

或传入等价的 `currentDate` / `currentTime` 字段。要求：

- snapshot builder 创建时固定 `now`。
- `buildTimeSection` 使用 snapshot 的 `now`，不再直接读取当前系统时间。
- 不传 `snapshotNow` 时 legacy 行为保持兼容。

P1 只冻结 snapshot 创建时的时间。跨日后的即时日期变化由 P2 的 `<system_prompt_update>` 负责。

## 6. Source Hash 采集

P1 不要求精确到每个 Markdown 小节，但必须能判断“snapshot 是基于哪些来源生成的”。

建议实现：

- `hashPromptModuleTemplates(workspaceDir)`：读取 `PromptTemplateName` 对应模板渲染前文本，记录 hash。
- `hashContextSources(workspaceDir)`：记录 `SOUL.md`、`IDENTITY.md`、`USER.md`、`MEMORY.summary.md` 的文件 hash。
- `hashManagedSources(paths)`：记录 `buildManagedAgentsContent()` / `buildManagedToolsContent(paths)` 输出 hash。
- `hashToolInventory(tools, toolsEnabled)`：按工具名排序后 hash。
- `hashSkillsIndex(workspaceDir)`：按 skill name 排序后 hash 摘要列表。
- `hashActiveSkill(activeSkillName, workspaceDir)`：记录已冻结 skill 正文 hash。
- `hashRuntimeInputs(request)`：按固定字段顺序序列化 role/mode/timezone/channel/model/toolsEnabled/thinkingLevel。

实现注意：

- `prompt-module-files.ts` 当前没有导出完整模板名数组；P1 需要新增只读导出，避免 snapshot builder 复制模板清单。
- `context-files.ts` 当前没有导出 `buildManagedAgentsContent` / `buildManagedToolsContent`；P1 可以新增专用 hash helper，或第一版记录 `managedSystemContent` 的组合 hash，但不要复制托管文案。
- source hash 是诊断与 P2 diff 的基础，不要为了省事只记录最终 `systemText` hash。

序列化要求：

- 字段顺序固定。
- 数组先排序。
- 空字段省略或输出固定空字符串，二选一，不能混用。
- hash 用 SHA256。

## 7. 存储方案

P1 建议使用现有 session event tree，不新增数据库表。

可用接口：

- `SessionManager.appendCustomEntry(customType, data)`
- `SessionManager.getEntries()`

新增 custom entry：

```ts
type SystemPromptSnapshotEntryData = {
  kind: 'system_prompt_snapshot'
  snapshot: FrozenSystemSnapshot
}
```

写入形式：

```ts
manager.appendCustomEntry('system_prompt_snapshot', {
  kind: 'system_prompt_snapshot',
  snapshot,
})
```

读取规则：

- 按事件顺序扫描 `customType === 'system_prompt_snapshot'`。
- 取最后一个 `sessionId` 匹配且未被 resnapshot 覆盖的 snapshot。
- 内存层可在 `SessionRuntimeService` 加 `Map<string, FrozenSystemSnapshot>` 热缓存。
- 会话恢复时，如果内存没有，则从 `manager.getEntries()` 恢复。

注意：

- 该 custom entry 不参与用户可见 transcript。
- 不要用 `appendCustomMessageEntry` 存 snapshot。
- P1 可以把完整 `systemText` 存进事件；后续如果体积过大，再单独改成文件引用。

## 8. Runtime 接入

建议在 `SessionRuntimeService` 增加：

```ts
private readonly systemPromptSnapshots = new Map<string, FrozenSystemSnapshot>()

private async ensureFrozenSystemSnapshot(request: PromptBuildRequest): Promise<FrozenSystemSnapshot>
```

`ensureFrozenSystemSnapshot` 流程：

1. 用 `sessionId` 查内存 cache。
2. 没有则从 `SessionManager.getEntries()` 找最后一个 snapshot entry。
3. 仍没有则调用 `buildFrozenSystemSnapshot`。
4. 新 snapshot 通过 `appendCustomEntry('system_prompt_snapshot', ...)` 持久化。
5. 返回 snapshot。

`buildRunSystemPrompt` 调整为：

```text
if LAYERED_PROMPT !== true:
  return buildSystemPromptLegacy(...)

snapshot = await ensureFrozenSystemSnapshot(request)
return snapshot.systemText
```

P1 不做自动失效。文件变化、跨日、mode 切换等都不重建 snapshot；后续 P2 用 update block 表达变化，P4 才做 compact / resnapshot。

## 9. Session 粒度

snapshot key 使用：

```text
sessionId + snapshotId
```

不是 `sessionKey`。原因：

- `sessionKey` 受 channel / route 映射影响。
- `sessionId` 是持久会话身份。
- resnapshot 会生成新 `snapshotId`。

但是运行时热缓存可以用 `sessionId` 查“当前最新 snapshot”。

## 10. 测试要求

建议新增或扩展：

- `backend/src/core/prompts/__tests__/system-prompt-snapshot.test.ts`
- `backend/src/runtime/__tests__/system-prompt-snapshot-runtime.test.ts`

必须覆盖：

1. 同一输入两次构建 snapshot，`systemText` 与 `contentHash` 一致。
2. 同一会话连续两轮调用 `buildRunSystemPrompt`，返回同一 `systemText`。
3. snapshot 创建后修改 `USER.md`，当前 snapshot 的 `systemText` 不变。
4. snapshot 创建后时间跨分钟或跨日，当前 snapshot 的 `systemText` 不变。
5. snapshot entry 写入 session event tree 后，重新创建 runtime cache 能恢复。
6. `serializeSystemPrompt` 仍拒绝 `MemoryRecall` / `LiveTurn`。
7. 非 layered 路径仍走 legacy，不受 snapshot 影响。

## 11. 验收标准

P1 完成的最小验收：

- `FrozenSystemSnapshot` 类型和 builder 已落地。
- layered 路径下 system prompt 每会话只生成一次。
- snapshot 被写入 session event tree。
- session restore 能复用已有 snapshot。
- 同一会话内 system hash 不随时间、文件变更或重复请求改变。
- 测试覆盖 snapshot deterministic 和 runtime reuse。

P1 完成后，P2 才能开始做 `<system_prompt_update>`，否则 update 没有稳定 base snapshot 可对比。
