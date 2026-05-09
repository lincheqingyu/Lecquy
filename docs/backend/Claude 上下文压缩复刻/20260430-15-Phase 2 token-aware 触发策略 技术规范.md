# Phase 2 token-aware 触发策略

更新日期：2026-05-07（基于 2026-04-30 初稿，按 codex 二轮审查收敛 reservedTokens 拆分、contextWindow 来源、details 观测字段；详见末尾附录）

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
const threshold = getCompactionThreshold({
  modelContextWindow,
  outputReserved,
  promptOverhead,
  nextInputBuffer,
})
if (estimatedTokens < threshold) return null
```

触发条件从“消息条数 >= 50”改为：

```text
当前 session 估算 token >= 模型 contextWindow
                           - outputReserved
                           - promptOverhead
                           - nextInputBuffer
```

预算拆成三类，分别覆盖：模型下一轮输出空间（`outputReserved`）、system prompt + 工具声明 + memory recall 等固定开销（`promptOverhead`）、下一轮用户输入预留（`nextInputBuffer`）。Phase 2 仍在 run 结束后压缩、不做 streaming 中途触发，因此必须在估算时就为下一轮的"提示装配 + 用户输入"留好空间，避免贴边触发后下一轮直接溢出。

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
usableTokens     = modelContextWindow - outputReserved - promptOverhead - nextInputBuffer
                 = §4.4 中的 threshold
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

> **关于 tool output 是否裁剪估算**
>
> Phase 2 不对单条 tool output 做估算上限裁剪（如 codex 建议的 50k chars 上限）。理由是 Phase 2 不做 tool result prune（属于 Phase 3）：即使估算时把 200k 的 tool output 当作 50k，模型实际收到的仍是完整 200k。裁剪估算会导致"看似 token-aware 但 threshold 该触发不触发"的隐藏失败模式。Phase 2 选择"估算反映真实压力 → 该触发就触发 → summary 后若仍超窗，由 Phase 3 prune 兜底"这条路径。
>
> 为避免单条超长 part 把估算"打飞"，估算工具应同时输出 `largest_single_part_tokens` 写入 details，灰度期观察是否经常被单条 part 主导。

### 4.2 reservedTokens 三类预算

Phase 2 不再把所有预留塞进单一 `reservedTokens`，而是显式拆成三类，对应下一轮上下文装配的三个真实开销点：

```ts
const outputReserved   = clamp(maxOutputTokens ?? cfg.LLM_MAX_TOKENS, 2_000, 20_000)
const promptOverhead   = 4_000   // system prompt + 工具声明 + memory recall + 固定上下文块
const nextInputBuffer  = 2_000   // 下一轮用户输入预留
```

含义与默认值：

- `outputReserved`：模型下一轮回复空间，跟随当前模型的 `maxTokens`，下限 2k 上限 20k。最直接的"下一轮输出预算"。
- `promptOverhead`：system prompt、工具声明（pi-ai 工具规格在每次 request 都会序列化）、memory recall 块等"每轮固定追加"的开销。Phase 2 MVP 给定值 4k，灰度期观察实际占比再调。
- `nextInputBuffer`：给下一条用户输入留的空间。交互式对话单轮输入绝大多数远小于 2k，给 2k 已能覆盖；超长输入由 Phase 4 streaming 中途检测兜底。

为什么不再叠加 `0.8` / `0.9` 系数：拆三类已经是显式的多重 buffer，再乘 ratio 会让 32k 这类小模型过早压缩 35% 以上，触发"刚说过的内容不记得"的退化体验。如果灰度发现仍有溢出，加 `COMPACTION_TRIGGER_RATIO` 配置项（默认 1.0）作为应急开关，比硬编码更灵活。

> 文档 7 曾提到可选的 80% 预触发。Phase 2 不再用全局系数模拟"提前一点"的效果，而是把实际预算项写明：要更早压缩就调大 `promptOverhead` 或 `nextInputBuffer`，要更晚压缩就调小，语义可观测、可调参。

### 4.3 contextWindow 来源

Phase 2 不能直接信任 `createVllmModel()` 的 128k fallback。当前 [vllm-model.ts:99](../../backend/src/agent/vllm-model.ts) 写的是 `contextWindow: options?.contextWindow ?? 128_000`：caller 不显式传值时，所有模型都会被当成 128k。这意味着对 32k 模型，即使做了 token-aware，threshold 也会比真实窗口大 4 倍，触发反而比固定 50 条更晚。

`modelContextWindow` 必须按以下优先级解析，且每一级失败时都有可观测痕迹：

```text
1. session/run 显式传入的 model contextWindow
   （来自 bound.projection.model 或 run-level 配置）
2. 本地 model registry（按 modelId 查表）
3. createVllmModel() fallback 128_000
   （仅打 warning，details 标记 context_window_source='fallback'）
```

实施层面 Phase 2 需要在 `backend/src/agent/` 下新增最小 model registry（哪怕是常量表 `Record<string, { contextWindow, maxTokens }>`），把 32k / 128k / 200k 三档显式列出。否则后面所有 threshold 公式对 32k 模型都失效。

`context_window_source` 必须写入 compaction details（见 §5.3），灰度期通过这个字段直接揭穿"看似 token-aware 实际仍按 128k 算"的伪 token-aware。

### 4.4 threshold

```ts
interface CompactionThresholdInput {
  modelContextWindow: number
  outputReserved: number
  promptOverhead: number
  nextInputBuffer: number
}

function getCompactionThreshold(input: CompactionThresholdInput): number {
  const { modelContextWindow, outputReserved, promptOverhead, nextInputBuffer } = input
  return Math.max(1, modelContextWindow - outputReserved - promptOverhead - nextInputBuffer)
}
```

示例（默认 `promptOverhead = 4_000`、`nextInputBuffer = 2_000`）：

| 模型 contextWindow | outputReserved | promptOverhead | nextInputBuffer | threshold |
| ---: | ---: | ---: | ---: | ---: |
| 32,000 | 4,096 | 4,000 | 2,000 | 21,904 |
| 128,000 | 4,096 | 4,000 | 2,000 | 117,904 |
| 200,000 | 8,192 | 4,000 | 2,000 | 185,808 |

对 32k 模型从原文档 27.9k 降到 21.9k（早 21%），覆盖小模型容易溢出的真实风险；对 200k 模型从 191.8k 降到 185.8k（早 3%），基本不变。

### 4.5 candidate window

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

Phase 2 必须新增的 details 字段：

```ts
{
  // tail 策略观测
  recent_tail_budget_tokens: number,
  recent_tail_estimated_tokens: number,

  // contextWindow 来源（响应 §4.3）
  context_window_source: 'spec' | 'registry' | 'fallback',

  // 预留预算分项（响应 §4.2）
  reserved_breakdown: {
    output: number,
    prompt_overhead: number,
    next_input: number,
  },

  // tail 切口是否落在 tool_call/tool_result 之间（Phase 2.2 决策依据）
  tail_split_in_tool_chain: boolean,

  // 单条最大 part 估算 token（响应 §4.1，诊断"是否被超长 tool output 主导"）
  largest_single_part_tokens: number,
}
```

这些字段仅扩展 details，不改 session 存储 schema。

灰度期通过这套字段直接回答四个关键问题：

- **threshold 设错了吗？** 看 `context_window_source`：是不是经常 fallback。
- **预留过多/过少？** 看 `reserved_breakdown` 与 `estimated_tokens_before / threshold_used` 比值的分布。
- **tail 切坏了吗？** 看 `tail_split_in_tool_chain` 命中率，决定是否上 Phase 2.2。
- **被异常 tool output 拖累了吗？** 看 `largest_single_part_tokens` 在估算总量中的占比。

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

`CompactionOptions` 已有 `modelContextWindow` / `thresholdUsed` 预留字段；Phase 2 需要补 `maxOutputTokens`，由 compact policy 层计算 §4.2 的三类 buffer 与 §4.4 的 threshold。`promptOverhead` / `nextInputBuffer` 默认值在 policy 层定义，runtime 层无需感知。

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

### Step 2.5 引入 model registry（最小可用版）

新增 `backend/src/agent/model-registry.ts`（或同等位置的常量表），把已知模型的 `contextWindow` / `maxTokens` 真实规格列出来；`session-runtime-service.ts` 调用 `applyCompactionIfNeeded()` 前按 §4.3 优先级解析 `modelContextWindow`，并把 `context_window_source` 透传到 details。

未在 registry 命中的 modelId 仍可走 `createVllmModel()` 的 128k fallback，但必须 `logger.warn` 一次，避免静默降级。

### Phase 2.2 待定项（数据驱动，不进 MVP）

以下事项 Phase 2.1 不做，留待灰度数据触发后再推进：

- **tool-call group aware tail**：当 `tail_split_in_tool_chain` 命中率高于阈值（建议先观察 1 周后定具体阈值），把 tail 选择改成"tool_call + 对应 tool_result + 紧随的 assistant 文本"作为整体单位，避免 orphan tool_result 出现在下一轮上下文。
- **`COMPACTION_TRIGGER_RATIO` 配置项**：当灰度发现"贴边触发后下一轮溢出"成为常态，引入 0.0-1.0 的 ratio 作为应急开关，默认 1.0 不启用。
- **`promptOverhead` / `nextInputBuffer` 自适应**：根据本会话最近 N 轮观测到的 system prompt + tool spec 实际长度，动态调整 `promptOverhead`，替代 4k 固定值。

这三项都依赖 Phase 2.1 的 details 字段累积数据后再决定，不在 Phase 2 MVP 范围。

---

## 7. 验收标准

必须覆盖以下测试：

1. **短消息长对话不会过早压缩。** 构造 100 条每条约 20 字的消息，在 128k contextWindow 下不触发压缩。
2. **长消息短对话会提前压缩。** 构造 3-5 条大消息，估算 token 超过 threshold 时触发压缩。
3. **阈值随模型变化。** 同一组消息在 32k contextWindow 下触发，在 200k contextWindow 下不触发。
4. **recent tail 使用 token budget。** 保留 tail 的估算 token 不超过 8k，且不少于必要的最新 1 条。
5. **latest compaction 后不重复触发。** 已有 compaction 时，只估算 `firstKeptEntryId` 之后的 candidate window 加 previousSummary。
6. **details 基本字段完整。** compaction entry details 写入 `trigger='token_overflow'`、`estimated_tokens_before`、`model_context_window`、`threshold_used`。
7. **运行链路不传播压缩异常。** token 估算或 policy 计算异常只导致本轮跳过压缩并记录日志，不把已完成 run 标记为失败。
8. **contextWindow 三级优先级。** 显式传入时 `context_window_source='spec'`；未传入但命中 registry 时 `'registry'`；都未命中时 `'fallback'` 且 logger.warn 被调用一次。
9. **reserved_breakdown 写入正确。** details 中 `reserved_breakdown.output / prompt_overhead / next_input` 三项之和加上 `threshold_used` 等于 `model_context_window`。
10. **tail_split_in_tool_chain 检测。** 构造 tail 切口落在 tool_call/tool_result 之间的场景，details 中 `tail_split_in_tool_chain=true`；切口在干净 message 边界时 `false`。
11. **tool output 估算不裁剪。** 单条 tool output 长度 200k chars 时，估算结果反映完整长度（不被 50k 上限截断），且 `largest_single_part_tokens` 等于该 part 的估算值。

手工验证场景：

- 32k 模型：输入多段长文本后应更早压缩。
- 200k 模型：短消息聊天不应在 50 条附近压缩。
- 多轮 compaction：第二轮触发应基于 latest compaction 之后的新窗口，而不是整棵 session tree。

---

## 8. 风险与观察

| 风险 | 影响 | 处理 |
| --- | --- | --- |
| 字符数 / 4 对中文、代码、JSON 的误差较大 | 可能提前或延后压缩 | Phase 2 MVP 接受粗估；通过 details 记录估算值，灰度期观察 |
| `createVllmModel()` 默认 128k 误导小模型 | 32k 模型 threshold 错位 4 倍，伪 token-aware | 引入 model registry，按 §4.3 三级优先级解析；fallback 必须打 warning 并写 `context_window_source='fallback'` |
| tool output 体积过大主导估算 | 单条 200k tool output 让估算频繁触发 | Phase 2 不裁剪估算（避免隐藏失败模式）；通过 `largest_single_part_tokens` 灰度观察；真正 prune 留给 Phase 3 |
| tail 切口落在 tool_call/tool_result 之间 | 下一轮上下文出现 orphan tool_result | Phase 2.1 沿用 Phase 1 的容忍逻辑；用 `tail_split_in_tool_chain` 观测命中率，命中率高再上 Phase 2.2 group-aware tail |
| 单条最新 message 超过 tail budget | tail budget 看似失效 | 明确保留最新 1 条优先于预算，避免断上下文 |
| `promptOverhead = 4_000` / `nextInputBuffer = 2_000` 与真实开销偏差 | 触发太早或太晚 | 灰度期通过 `reserved_breakdown` 与 `estimated_tokens_before / threshold_used` 比值评估；Phase 2.2 自适应方案兜底 |

Phase 2 灰度重点观察：

- `context_window_source` 分布：fallback 命中率应趋近 0
- `estimated_tokens_before / threshold_used` 比值的 P50 / P95：理想接近 1.0 但不超过
- `reserved_breakdown` 各分项与实际 prompt overhead 的差距
- `tail_split_in_tool_chain=true` 的频率
- `largest_single_part_tokens / estimated_tokens_before` 的 P95：判断是否被超长 part 主导
- 不同模型（32k / 128k / 200k）的触发分布
- 用户反馈"刚说过的内容不记得"是否增加

---

## 9. 与 Phase 1 的衔接

Phase 1 已把 compaction 产物升级为 LLM 摘要，并补齐以下 Phase 2 所需基础：

- `CompactionOptions` 是开放结构。
- compaction details 已预留 `estimated_tokens_before`、`model_context_window`、`threshold_used`。
- `session-runtime-service.ts` 已用独立 try/catch 包裹自动压缩。
- tool output 已进入可序列化的 session content block，Phase 2 可以把它纳入 token 估算。

因此 Phase 2 不需要重做 Phase 1 的摘要链路，只需要把"何时压缩"和"保留多少 recent tail"的 policy 从条数改成 token。

---

## 附录：codex 二轮审查反馈处理记录

更新日期：2026-05-07

codex 二轮审查针对文档初稿提出了 6 点设计建议 + 1 点对 §4.2 的修订。本附录记录采纳决策与依据，便于后续追溯。

### 强采纳

- **contextWindow 来源优先级（codex 第 2 点）**：单纯改公式不够，必须先解决 `createVllmModel()` 的 128k fallback 静默误导小模型问题。落到 §4.3 + Step 2.5 + 风险表。
- **details 观测字段（codex 第 6 点）**：灰度期最关键的诊断数据。落到 §5.3，新增 `context_window_source` / `reserved_breakdown` / `tail_split_in_tool_chain` / `largest_single_part_tokens`。

### 部分采纳

- **拆分 reservedTokens（codex 第 1 点）**：拆 `outputReserved` / `promptOverhead` / `nextInputBuffer` 三类预算。但**不叠加 0.9 ratio**——三类 buffer 已是显式多重保险，再乘 ratio 会让 32k 模型过早压缩 35%+，反而触发"刚说过的内容不记得"退化。`COMPACTION_TRIGGER_RATIO` 作为应急配置项（默认 1.0）放进 Phase 2.2 待定项。
- **tail 保护工具链（codex 第 4 点）**：方向正确但属于 Phase 2.2。Phase 2.1 维持 Phase 1 的"配对断裂可容忍"策略，先用 `tail_split_in_tool_chain` 字段观测命中率，数据驱动再做 group-aware tail。

### 不采纳

- **tool output 估算 50k chars 上限（codex 第 3 点）**：与 Phase 2 范围矛盾。Phase 2 不做 tool result prune，模型实际收到的仍是完整 tool output；估算裁剪会让 threshold 反映"假压力"，制造隐藏失败模式（看似 token-aware 但 threshold 该触发不触发）。改为不裁剪 + 同时写 `largest_single_part_tokens` 用于诊断。详见 §4.1 引用块。

### 仅强调、无新内容

- **latest compaction 后窗口（codex 第 5 点）**：与 §4.5 既有规则一致，不需修订。

### 默认值取舍

codex 建议 `nextInputBuffer = 4_000`，本文档定为 `2_000`：交互式对话单轮输入绝大多数远小于 2k；超长输入由 Phase 4 streaming 中途检测兜底，不应让所有 session 都按"可能有超长输入"预留。如灰度发现 nextInput 实际经常溢出，再调大或走 Phase 2.2 自适应方案。
