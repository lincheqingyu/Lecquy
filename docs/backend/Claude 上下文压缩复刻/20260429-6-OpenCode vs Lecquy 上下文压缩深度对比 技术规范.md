# OpenCode vs Lecquy 上下文压缩深度对比

更新日期：2026-04-29
参考源码：`/Users/hqy/Documents/zxh/github/opencode/packages/opencode/src/session/`

---

## 1. 目标

本文档基于 OpenCode 真实源码，逐点对比 OpenCode 与 Lecquy 的上下文压缩实现。

覆盖以下六个维度：

1. 什么时候触发压缩
2. 压缩任务如何插入 session
3. 压缩摘要用什么 Agent 生成
4. 压缩后哪些消息被裁剪
5. tool result 如何清理
6. 最近上下文如何保留

不覆盖：UI 侧呈现、WebSocket 协议差异、Provider 层实现。

---

## 2. OpenCode 相关文件速查

| 文件 | 职责 |
| --- | --- |
| `session/overflow.ts` | `isOverflow()` 与 `usable()` — token 溢出判断 |
| `session/processor.ts` | streaming 事件处理、`finish-step` 溢出检测、`process()` 返回 `"compact"` |
| `session/compaction.ts` | `create()`、`process()`、`select()`、`prune()`、SUMMARY_TEMPLATE |
| `session/prompt.ts` | `runLoop()` 主循环、compaction 任务调度、`filterCompactedEffect()` 调用 |
| `session/message-v2.ts` | `filterCompacted()` — 消息过滤与 tail 重建 |

---

## 3. 维度一：什么时候触发压缩

### 3.1 OpenCode：双路径触发

**路径 A — streaming 中途溢出（`processor.ts` `finish-step` 事件）**

```
finish-step 事件
→ Session.getUsage() 拿到本步实际 token 用量
→ isOverflow({ cfg, tokens, model }) 判断
→ ctx.needsCompaction = true
→ Stream.takeUntil(() => ctx.needsCompaction) 截断流
→ process() 返回 "compact"
→ runLoop: compaction.create(..., overflow: !handle.message.finish)
→ continue 进入下一次 while 循环
```

**路径 B — loop 入口检测已完成消息（`prompt.ts` `runLoop`）**

```
filterCompactedEffect() 拿消息列表
→ 找到 lastFinished（上次 LLM 结束的 assistant 消息）
→ compaction.isOverflow({ tokens: lastFinished.tokens, model })
→ 如果溢出且不是 summary 消息 → compaction.create()
→ continue
```

**`overflow.ts` 的实际判断逻辑**

```ts
// overflow.ts
const COMPACTION_BUFFER = 20_000

function usable(input: { cfg; model }) {
  const reserved = cfg.compaction?.reserved
    ?? Math.min(COMPACTION_BUFFER, ProviderTransform.maxOutputTokens(model))
  return model.limit.input
    ? Math.max(0, model.limit.input - reserved)
    : Math.max(0, context - maxOutputTokens(model))
}

function isOverflow(input: { cfg; tokens; model }) {
  if (cfg.compaction?.auto === false) return false
  if (model.limit.context === 0) return false
  const count = tokens.total || tokens.input + tokens.output + tokens.cache.read + tokens.cache.write
  return count >= usable(input)
}
```

即：**实际 token 用量 ≥ 模型输入上限 - min(20k, maxOutputTokens)** 时触发。

### 3.2 Lecquy：单路径、run 结束后

```ts
// compact.ts
const COMPACT_TRIGGER_MESSAGE_EVENTS = 50

function resolveCompactSource(entries) {
  const messageEntries = getDurableMessageEntries(entries)
  if (messageEntries.length < COMPACT_TRIGGER_MESSAGE_EVENTS) return null
  // ...
}

// session-runtime-service.ts
if (await applyCompactionIfNeeded(manager)) {
  await this.refreshProjection(sessionKey)
}
// 触发时机：run 结束后（executeRun 末尾）
```

**固定消息条数，与 token 完全无关，run 结束后才检查。**

### 3.3 差距总结

| 维度 | OpenCode | Lecquy |
| --- | --- | --- |
| 触发时机 | streaming 中途（`finish-step`）或 loop 入口 | run 全部结束后 |
| 触发策略 | `actual_tokens >= model.limit.input - min(20k, maxOutputTokens)` | `durable_message_count >= 50` |
| 模型感知 | 完全感知，随模型上下文窗变化 | 不感知，固定常量 |
| 能否救活本轮溢出 | 能（中途截断，触发压缩后重跑） | 不能（已跑完才检查） |

---

## 4. 维度二：压缩任务如何插入 session

### 4.1 OpenCode：写入真实 user 消息

`compaction.create()` 在 session 里写入一条真实的 user 消息，该消息带 `type: "compaction"` part：

```ts
// compaction.ts create()
const msg = yield* session.updateMessage({
  id: MessageID.ascending(),
  role: "user",
  model: input.model,
  sessionID: input.sessionID,
  agent: input.agent,
  time: { created: Date.now() },
})
yield* session.updatePart({
  id: PartID.ascending(),
  messageID: msg.id,
  sessionID: msg.sessionID,
  type: "compaction",
  auto: input.auto,
  overflow: input.overflow,
})
```

`runLoop` 在每次循环开头扫描 `tasks`（`type === "compaction"` 的 parts），发现后调用 `compaction.process()`。**压缩任务本身是一等的 session 消息，走正常 loop 流程。**

### 4.2 Lecquy：直接 append compaction entry

```ts
// compact.ts applyCompactionIfNeeded()
manager.appendCompaction(
  summary,
  source.firstKeptEntryId,
  estimateTokensBefore(source),
  { trigger: 'message_threshold', kept_message_count: 10, ... },
)
```

不经 loop 介入，直接向 append-only session tree 追加状态。

### 4.3 差距总结

| 维度 | OpenCode | Lecquy |
| --- | --- | --- |
| 插入方式 | 真实 user 消息 + compaction part，进入 loop 调度 | 直接 append compaction entry，绕过 loop |
| 可观测性 | compaction 任务在消息流中可见、可重放 | compaction entry 是内部状态 |
| 支持 overflow replay | 有（overflow=true 时找上一条 user 消息重放） | 无 |

---

## 5. 维度三：压缩摘要用什么 Agent 生成

### 5.1 OpenCode：独立 compaction agent + LLM stream

SUMMARY_TEMPLATE（`compaction.ts`）要求 LLM 输出 7 个结构化字段：

```
## Goal
- [single-sentence task summary]

## Constraints & Preferences
- [user constraints, preferences, specs, or "(none)"]

## Progress
### Done
- [completed work or "(none)"]
### In Progress
- [current work or "(none)"]
### Blocked
- [blockers or "(none)"]

## Key Decisions
- [decision and why, or "(none)"]

## Next Steps
- [ordered next actions or "(none)"]

## Critical Context
- [important technical facts, errors, open questions, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
```

如果有上一次摘要（`previousSummary`），prompt 要求：保留仍然成立的内容，删除过期内容，融入新事实。

compaction agent 可以在配置中单独指定 model（与主对话 model 解耦），通过 `SessionProcessor` 走完整 LLM stream。

### 5.2 Lecquy：纯字符串模板，无 LLM

```ts
// compact-summary.template.ts
export function formatCompactSummary(input) {
  // previousSummary 截取 280 字
  // 输出：已压缩 N 条，保留最近 M 条原文
  // 最近 8 条消息各截取 140 字
  // 总长上限 1200 字
}
```

**不调用任何 LLM，摘要是最近若干条消息的截断拼接，不包含语义理解。**

### 5.3 差距总结

| 维度 | OpenCode | Lecquy |
| --- | --- | --- |
| 摘要生成方式 | LLM agent，完整 stream | 纯模板函数，字符串拼接 |
| 摘要内容 | 目标 / 约束 / 进度 / 决策 / 下一步 / 关键上下文 / 相关文件 | 上次摘要截断 + 条数说明 + 最近 8 条消息采样 |
| 语义质量 | 高（LLM 推理） | 极低（字符截断） |
| 摘要迭代方式 | 基于 previousSummary 合并更新 | previousSummary 截取 280 字直接拼接 |
| agent 可配置 | 是（model 可独立指定） | 无（纯函数） |

**这是当前两者最大的单点差距。**

---

## 6. 维度四：压缩后哪些消息被裁剪

### 6.1 OpenCode：token-based tail 选择

**`select()` 函数（`compaction.ts`）：**

```ts
const MIN_PRESERVE_RECENT_TOKENS = 2_000
const MAX_PRESERVE_RECENT_TOKENS = 8_000
const DEFAULT_TAIL_TURNS = 2

function preserveRecentBudget(input) {
  return cfg.compaction?.preserve_recent_tokens
    ?? Math.min(MAX_PRESERVE_RECENT_TOKENS,
         Math.max(MIN_PRESERVE_RECENT_TOKENS,
           Math.floor(usable(input) * 0.25)))
}
// 即：可用 token 的 25%，限制在 2k-8k 之间
```

选择逻辑：

```
从最近 tail_turns（默认 2）个 user turn 倒序累计 token：
  - turn 能完整放入 budget → 保留整个 turn
  - turn 超出 budget → splitTurn()：从 turn 内部找 start 点
  - 连 split 也放不下 → 不保留
→ 返回 tail_start_id（保留段起点的 message ID）
```

**`filterCompacted()` 函数（`message-v2.ts`）：**

```ts
export function filterCompacted(msgs: Iterable<WithParts>) {
  // 从最新消息倒序扫描
  // 找到 assistant 消息有 summary=true + finish + !error
  //   → 标记其 parentID（对应 compaction user 消息）
  // 找到该 user 消息 → 读取 compaction part 的 tail_start_id
  //   → 从 tail_start_id 开始保留后续所有消息
  //   → 跳过 tail_start_id 之前的所有历史
  // result.reverse() 后返回（时间正序）
}
```

### 6.2 Lecquy：固定条数

```ts
const COMPACT_RECENT_TAIL = 10

// resolveCompactSource():
const firstKeptEntry = candidateMessages[candidateMessages.length - COMPACT_RECENT_TAIL]
// 固定保留最近 10 条消息，不论其 token 量

// buildSessionContext():
// 从 firstKeptEntryId 开始重放消息
```

### 6.3 差距总结

| 维度 | OpenCode | Lecquy |
| --- | --- | --- |
| 保留量依据 | token budget（usable 的 25%，2k-8k） | 固定 10 条消息 |
| turn 感知 | 以 user turn 为单位裁剪 | 以消息条数计 |
| 精细切分 | `splitTurn()` 在 turn 内部找切割点 | 无 |
| 动态性 | 随模型 context window 变化 | 完全固定 |

---

## 7. 维度五：tool result 如何清理

### 7.1 OpenCode：`prune()` 函数

```ts
// compaction.ts
const PRUNE_MINIMUM = 20_000   // 低于此量不值得 prune
const PRUNE_PROTECT = 40_000   // 此量以内的 tool output 受保护
const PRUNE_PROTECTED_TOOLS = ["skill"]  // skill tool 永不 prune
const TOOL_OUTPUT_MAX_CHARS = 2_000     // 送给 compaction LLM 的 tool output 截断

function prune(sessionID) {
  // 从最新消息倒序扫描 tool parts
  // 跳过最近 2 个 user turn
  // 遇到 assistant summary 消息 → 停止（已是上次压缩边界）
  // 遇到 time.compacted 已标记 → 停止（已经 prune 过）
  // 跳过 PRUNE_PROTECTED_TOOLS
  // 累计 token：total <= PRUNE_PROTECT → 保护；total > PRUNE_PROTECT → 加入待 prune
  // if (pruned > PRUNE_MINIMUM):
  //   对每个 part 打上 time.compacted = Date.now()
  //   session.updatePart() 持久化
}
```

`prune()` 在 `runLoop` 结束时异步 fork 调用（`Effect.forkIn(scope)`）。

在 `toModelMessagesEffect` 中，已被 prune 的 tool part（`time.compacted` 已设置）会被截断或替换为占位文本，不送入 LLM。

### 7.2 Lecquy：无专门机制

`toolResultsByCallId` 是运行时内存缓存，run 结束后按 `sessionKey:runId:` 前缀清理，但这是内存清理，不是历史 tool output 的 token 裁剪。

recent tail 里的所有 tool result 原样保留，没有任何截断。

### 7.3 差距总结

| 维度 | OpenCode | Lecquy |
| --- | --- | --- |
| tool result prune | 有，保护最近 40k tokens 内的 output，清理更旧的 | 无 |
| prune 触发时机 | runLoop 结束后异步 fork | 无 |
| prune 持久化 | `time.compacted` 标记写入 session | 无 |
| 送给 compaction LLM 的 tool output | 截断到 2000 字符 | N/A（无 compaction LLM） |
| 受保护 tool | skill（永不 prune） | N/A |

---

## 8. 维度六：最近上下文如何保留

### 8.1 OpenCode

`tail_start_id` 记录在 compaction part 上（`session.updatePart(compactionPart)`），`filterCompacted()` 根据它重建消息视图，保留 `tail_start_id` 之后的所有消息送入 LLM。

token 量由 `preserveRecentBudget` 控制（2k-8k tokens，usable 的 25%），随模型变化。

### 8.2 Lecquy

`firstKeptEntryId` 记录在 compaction entry 上，`buildSessionContext()` 从它开始重放消息，固定保留 10 条。

`augmented-context-builder.ts` 当前组装顺序：

```
[compact summary message]   ← 模板生成字符串（无语义）
[recent tail 10 条]          ← 原始消息
[memory recall block]        ← 动态插入，打断稳定前缀
[当前用户输入]
```

注意：memory recall block 在 compact 和非 compact 场景下插入位置不同，影响共享前缀稳定性。

### 8.3 差距总结

| 维度 | OpenCode | Lecquy |
| --- | --- | --- |
| 保留量 | token budget（动态） | 固定 10 条 |
| 保留边界记录位置 | compaction part（`tail_start_id`） | compaction entry（`firstKeptEntryId`） |
| 上下文顺序稳定性 | summary → tail，顺序固定 | compact 场景下 memory recall 插入位置与无 compact 时不同 |

---

## 9. 总览对比表

| 对比维度 | OpenCode | Lecquy 当前 |
| --- | --- | --- |
| **触发时机** | streaming 中途（finish-step）或 loop 入口 | run 结束后 |
| **触发策略** | token 溢出（model.limit.input - reserved） | 消息条数 ≥ 50 |
| **触发感知** | token-aware，随模型变化 | 固定，与 token 无关 |
| **能否救活本轮溢出** | 能（中途截断重跑） | 不能 |
| **压缩任务写入** | 真实 user 消息 + compaction part，走 loop | append compaction entry，绕过 loop |
| **摘要生成** | compaction agent + LLM stream | 纯模板函数，字符截断 |
| **摘要结构** | Goal / Constraints / Progress / Key Decisions / Next Steps / Critical Context / Files | 上次摘要截断 + 条数说明 + 最近 8 条采样 |
| **摘要迭代** | previousSummary 合并更新 | previousSummary 截取 280 字拼接 |
| **tail 保留量** | token budget（usable 25%，2k-8k，可配） | 固定 10 条消息 |
| **tail 选择粒度** | turn 级别 + turn 内精细 split | 消息条数 |
| **tool result 清理** | prune()：保护 40k tokens 内，清理更旧的 | 无 |
| **prune 持久化** | time.compacted 标记 + updatePart | 无 |
| **上下文顺序稳定性** | 固定（summary → tail） | compact 前后 memory recall 插入位置不同 |
| **可配置项** | tail_turns / preserve_recent_tokens / reserved / prune / auto / compaction agent model | 代码常量（不可配） |
| **持久化模型** | session 消息 + part 标记 | append-only event tree + compaction entry |
