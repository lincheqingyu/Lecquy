# Phase 2 token-aware 触发策略

更新日期：2026-04-30

> Phase 2 是文档 7 第 3 节“四阶段复刻路线”中的第二阶段，目标是把压缩触发策略从“固定消息条数”升级为“token-aware”。本文档只落 Phase 2 的范围、口径、实施策略与验收标准；Phase 1 的 LLM 摘要、Phase 3 的 tool result prune、Phase 4 的 streaming 中途溢出检测都不在本文档范围内。

上游依赖：
- 文档 7：`20260429-7-上下文压缩复刻思路 开发规划.md`
- 文档 14：`20260430-14-Phase 1 codex 审查报告.md`

启动前提：Phase 1 的 codex review findings 已修复，且灰度观察期内未出现摘要质量、降级率或 run 失败传播问题。

---

## 1. Phase 2 是什么

Phase 2 是上下文压缩复刻路线中的第二阶段，位于 Phase 1 之后、Phase 3 之前。

| 阶段 | 目标 | 状态 |
| --- | --- | --- |
| Phase 1 | 摘要生成升级为 LLM agent | 当前阶段，已完成 codex 审查与 findings 修复 |
| Phase 2 | 触发策略升级为 token-aware | 下一阶段，本文档定义 |
| Phase 3 | tool result prune 机制 | Phase 2 后推进 |
| Phase 4 | streaming 中途溢出检测 | 中期规划，不在本轮 |

Phase 2 要解决两个当前策略无法处理的问题：

1. **短消息长对话不必要地早期压缩。** 现有 `COMPACT_TRIGGER_MESSAGE_EVENTS = 50` 不看消息长短，50 条每条 20 字的闲聊也会进入压缩判断。
2. **长消息短对话来不及压缩。** 现有策略必须等到 50 条 message event；少量超长用户输入或工具输出可能在 3-5 条内就接近模型上下文上限。

同一个“50 条消息”阈值同时作用在 32k、128k、200k 模型上，本质上也是错误的：触发阈值必须随模型 context window 变化。

---

## 2. Phase 2 做什么

Phase 2 只做三件事。

### 2.1 用 token 估算替换固定消息条数触发

现状：

```ts
if (messageEntries.length < COMPACT_TRIGGER_MESSAGE_EVENTS) return null
```

Phase 2 目标：

```ts
const estimatedTokens = estimateSessionTokens(candidateMessages, previousSummary)
const threshold = getCompactionThreshold(modelContextWindow, reservedTokens)
if (estimatedTokens < threshold) return null
```

触发条件从“消息条数 >= 50”改为：

```text
当前 session 估算 token >= 模型 contextWindow - reservedTokens
```

其中 `reservedTokens` 用来给下一轮回复、system prompt、工具调用和误差留空间。

### 2.2 从 model spec 读取 contextWindow

Phase 2 不写死 32k / 128k / 200k。

`session-runtime-service.ts` 当前 run 内已经创建了 `Model<'openai-completions'>` 对象，`createVllmModel()` 返回值含 `contextWindow` 与 `maxTokens`。Phase 2 应由调用点把当前模型规格传给 compaction policy：

```ts
await applyCompactionIfNeeded(manager, {
  model: compactionModel,
  apiKey,
  timeoutMs: this.cfg.COMPACTION_TIMEOUT_MS,
  modelContextWindow: model.contextWindow,
  maxOutputTokens: model.maxTokens,
})
```

文档 14 已要求 compaction model 来源使用 `bound.projection.model ?? this.cfg.LLM_MODEL`。Phase 2 继续沿用这个 model id，但 threshold 必须来自本轮模型规格的 `contextWindow`，不能回到固定阈值。

### 2.3 用 token budget 替换固定 recent tail 条数

现状：

```ts
const COMPACT_RECENT_TAIL = 10
const firstKeptEntry = candidateMessages[candidateMessages.length - COMPACT_RECENT_TAIL]
```

Phase 2 目标：

```text
recent tail 按 token budget 保留，不按固定 10 条保留。
```

保留预算：

```text
tailBudgetTokens = clamp(floor(usableTokens * 0.25), 2_000, 8_000)
```

其中：

```text
usableTokens = modelContextWindow - reservedTokens
```

从最近 message 倒序累计估算 token，直到达到 tail budget。至少保留最新 1 条 durable message，避免最新用户意图被压缩进摘要后立即丢失上下文连续性。

---

## 3. Phase 2 不做什么

为避免范围漂移，Phase 2 不做以下事项：

- 不改变触发时机：仍然在 run 结束后的 finally 阶段尝试压缩，不做 streaming 中途触发。
- 不修改 Phase 1 的 LLM 摘要 prompt、模板降级、previousSummary 合并策略。
- 不实现 Phase 3 的 tool result prune；Phase 2 可以估算 tool output，但不主动改写历史 tool output。
- 不改变 compaction summary 进入上下文的消息角色；仍沿用当前合成 user 消息路径。
- 不引入精确 tokenizer 或外部 countTokens API 作为 Phase 2 MVP 的硬依赖。

---

## 4. 触发策略口径

### 4.1 token 估算

Phase 2 MVP 使用字符数粗估：

```ts
function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
```

估算范围必须贴近“下一轮上下文真实会携带的内容”：

- latest compaction 之后的 durable message entries
- latest compaction summary（如果存在）
- 文本内容
- tool call arguments
- tool output 文本（使用 Phase 1 已保存到 session content block 的 output）

不纳入估算：

- thinking 内容
- image / file 二进制内容本身
- 已被历史 compaction 覆盖的旧 message entries

如果某类 content block 无法稳定序列化，使用 `JSON.stringify()` 长度兜底；失败时按 0 处理并记录 debug 日志，不因为估算失败中断 run。

### 4.2 reservedTokens

Phase 2 MVP 采用保守的本地公式：

```ts
const reservedTokens = clamp(maxOutputTokens ?? cfg.LLM_MAX_TOKENS, 2_000, 20_000)
```

含义：

- 最少预留 2k，避免小输出配置导致安全空间过小。
- 最多预留 20k，避免 200k 模型因保留空间过大而过早压缩。
- 默认跟随当前模型的 `maxTokens`，因为这是最直接的下一轮输出预算。

文档 7 曾提到可选的 80% 预触发。Phase 2 MVP 不叠加额外 0.8 系数，避免 200k 模型过早压缩；如果灰度发现触发太晚，再引入 `COMPACTION_TRIGGER_RATIO` 配置。

### 4.3 threshold

```ts
function getCompactionThreshold(modelContextWindow: number, reservedTokens: number): number {
  return Math.max(1, modelContextWindow - reservedTokens)
}
```

示例：

| 模型 contextWindow | maxOutputTokens | reservedTokens | threshold |
| ---: | ---: | ---: | ---: |
| 32,000 | 4,096 | 4,096 | 27,904 |
| 128,000 | 4,096 | 4,096 | 123,904 |
| 200,000 | 8,192 | 8,192 | 191,808 |

如果 model spec 没有 `contextWindow`，允许回退到 `createVllmModel()` 当前默认值 128,000，但必须在日志和 compaction details 中体现这是 fallback。

### 4.4 candidate window

触发估算不是对整个 append-only session tree 从头累计，而是对“当前尚未被最新 compaction 覆盖的上下文窗口”累计。

规则：

1. 先取 durable message entries。
2. 如果存在 latest compaction：
   - 从 `latestCompaction.firstKeptEntryId` 对应 message 开始作为 candidate window。
   - `previousSummary = latestCompaction.summary` 参与估算。
3. 如果不存在 latest compaction：
   - 全部 durable message entries 都是 candidate window。
4. `estimatedTokens = estimate(previousSummary) + estimate(candidateMessages)`。
5. `estimatedTokens < threshold` 时不压缩。

这样可以避免刚压缩完后，因为旧历史仍在 append-only tree 中而重复触发压缩。

---

## 5. recent tail token budget

Phase 2 替换 `COMPACT_RECENT_TAIL = 10`，但保留 “latest compaction summary + recent tail” 的上下文形态。

### 5.1 预算计算

```ts
function getRecentTailBudget(usableTokens: number): number {
  return clamp(Math.floor(usableTokens * 0.25), 2_000, 8_000)
}
```

含义：

- 25%：保留足够近端上下文，避免所有新事实都只靠摘要承载。
- 下限 2k：小模型也保留最基本的连续对话。
- 上限 8k：大模型不因为 context window 很大就无限保留 tail，避免压缩收益被近端保留抵消。

### 5.2 倒序选取规则

```text
kept = []
tokens = 0
for message in candidateMessages from newest to oldest:
  messageTokens = estimateMessageTokens(message)
  if kept is not empty and tokens + messageTokens > tailBudgetTokens:
    break
  kept.prepend(message)
  tokens += messageTokens
```

边界：

- 即使最新 message 单条超过预算，也必须保留最新 1 条。
- 如果倒序选择后没有任何 compactedMessages，跳过压缩。
- `firstKeptEntryId` 指向 kept tail 的第一条 message。
- `compactedMessages` 是 candidate window 中位于 `firstKeptEntryId` 之前的 message。

### 5.3 details 字段

文档 14 已把 Phase 2 预留字段写入 compaction details：

```ts
{
  estimated_tokens_before: options.estimatedTokens,
  model_context_window: options.modelContextWindow,
  threshold_used: options.thresholdUsed,
}
```

Phase 2 触发时应把 `trigger` 从 `'message_threshold'` 改为 `'token_overflow'`。`kept_message_count` 继续记录实际保留 message 数，但不再代表触发策略。

建议新增可选 details 字段用于观测 tail 策略：

```ts
{
  recent_tail_budget_tokens?: number,
  recent_tail_estimated_tokens?: number,
}
```

这两个字段仅扩展 details，不改 session 存储 schema。

---

## 6. 实施顺序

### Step 2.1 引入 token 估算工具

建议新增纯函数并单测覆盖：

- `estimateTextTokens(text)`
- `estimateMessageTokens(entry)`
- `estimateSessionTokens(candidateMessages, previousSummary)`

估算工具应放在 `backend/src/memory/compact.ts` 内部或同目录 policy 文件中，避免先引入跨模块抽象。

### Step 2.2 从 model spec 读取 contextWindow

在 `session-runtime-service.ts` 调用 `applyCompactionIfNeeded()` 时传入：

- `modelContextWindow: model.contextWindow`
- `maxOutputTokens: model.maxTokens`

`CompactionOptions` 已有 `modelContextWindow` / `thresholdUsed` 预留字段；Phase 2 需要补 `maxOutputTokens` 或直接传入计算好的 `reservedTokens`。

推荐由 runtime 层传 model spec，由 compact policy 层计算 threshold，保证日志和 details 都来自同一套 policy。

### Step 2.3 替换 `resolveCompactSource()` 触发判断

把 `resolveCompactSource(entries)` 改为携带 policy 参数：

```ts
resolveCompactSource(entries, {
  modelContextWindow,
  maxOutputTokens,
})
```

返回值扩展：

```ts
interface CompactSource {
  readonly previousSummary?: string
  readonly compactedMessages: SessionEventEntry[]
  readonly firstKeptEntryId: string
  readonly estimatedTokens: number
  readonly thresholdUsed: number
  readonly recentTailBudgetTokens: number
  readonly recentTailEstimatedTokens: number
}
```

### Step 2.4 替换 `COMPACT_RECENT_TAIL`

删除固定 tail 条数常量，改为倒序累计 token budget。

保留 `kept_message_count` 作为观测字段，但实际保留数量由 token budget 自然决定。

---

## 7. 验收标准

必须覆盖以下测试：

1. **短消息长对话不会过早压缩。** 构造 100 条每条约 20 字的消息，在 128k contextWindow 下不触发压缩。
2. **长消息短对话会提前压缩。** 构造 3-5 条大消息，估算 token 超过 threshold 时触发压缩。
3. **阈值随模型变化。** 同一组消息在 32k contextWindow 下触发，在 200k contextWindow 下不触发。
4. **recent tail 使用 token budget。** 保留 tail 的估算 token 不超过 8k，且不少于必要的最新 1 条。
5. **latest compaction 后不重复触发。** 已有 compaction 时，只估算 `firstKeptEntryId` 之后的 candidate window 加 previousSummary。
6. **details 字段完整。** compaction entry details 写入 `trigger='token_overflow'`、`estimated_tokens_before`、`model_context_window`、`threshold_used`。
7. **运行链路不传播压缩异常。** token 估算或 policy 计算异常只导致本轮跳过压缩并记录日志，不把已完成 run 标记为失败。

手工验证场景：

- 32k 模型：输入多段长文本后应更早压缩。
- 200k 模型：短消息聊天不应在 50 条附近压缩。
- 多轮 compaction：第二轮触发应基于 latest compaction 之后的新窗口，而不是整棵 session tree。

---

## 8. 风险与观察

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| 字符数 / 4 对中文、代码、JSON 的误差较大 | 可能提前或延后压缩 | Phase 2 MVP 接受粗估；通过 details 记录估算值，灰度期观察 |
| model spec 缺失 contextWindow | threshold 回退不准确 | fallback 到 128k，并记录 warning / details |
| tool output 体积过大 | 估算可能频繁触发压缩 | Phase 2 只触发压缩；真正 prune 留给 Phase 3 |
| 单条最新 message 超过 tail budget | tail budget 看似失效 | 明确保留最新 1 条优先于预算，避免断上下文 |

Phase 2 灰度重点观察：

- 每次 compaction 的 `estimated_tokens_before / threshold_used` 比值
- 不同模型上的触发分布
- recent tail 的实际 message 数与估算 token
- 用户反馈“刚说过的内容不记得”是否增加

---

## 9. 与 Phase 1 的衔接

Phase 1 已把 compaction 产物升级为 LLM 摘要，并补齐以下 Phase 2 所需基础：

- `CompactionOptions` 是开放结构。
- compaction details 已预留 `estimated_tokens_before`、`model_context_window`、`threshold_used`。
- `session-runtime-service.ts` 已用独立 try/catch 包裹自动压缩。
- tool output 已进入可序列化的 session content block，Phase 2 可以把它纳入 token 估算。

因此 Phase 2 不需要重做 Phase 1 的摘要链路，只需要把“何时压缩”和“保留多少 recent tail”的 policy 从条数改成 token。
