# Claude 上下文压缩复刻 Lecquy 对标分析

更新日期：2026-04-08

## 1. 目标

这份文档只做一件事：

- 对照 Claude Code 主参考项目 `/Users/hqy/Documents/zxh/github/Kuberwastaken-src`
- 梳理 Lecquy 当前上下文工程与它的差异
- 明确哪些已经对齐，哪些尚未对齐，哪些属于有意不对齐
- 给出下一步最小可执行改动计划

本轮分析只覆盖：

- `backend/src/runtime/`
- `backend/src/core/prompts/`
- `backend/src/memory/compact.ts`
- `backend/src/memory/prompt-injector.ts`
- 当前主链路 `SessionRuntimeService`

本轮明确不展开：

- RAG
- 心跳任务
- Anthropic 服务端缓存实现
- Claude Code 的 memdir / auto-dream 长期记忆底座整体复刻

## 2. 当前基线

### 2.1 Lecquy 当前主链路

当前真实生效的上下文装配主链路是：

```text
run_start / run_resume
→ SessionRuntimeService.executeRun()
→ buildContextMessages()
→ buildMemoryRecallBlock()
→ buildAugmentedContext()
→ sessionManager.buildSessionContext()
→ runSimpleAgent / runManagerAgent / plan final answer
→ applyCompactionIfNeeded()
```

这条链路的关键信息：

- `simple`
- `plan` 的 manager 阶段
- `plan` 的 final-answer 阶段
- `run_resume` 的 pause 恢复阶段

都共用了 `SessionRuntimeService.buildContextMessages()`。

### 2.2 Claude Code 主参考链路

主参考项目里的上下文工程主链路可以概括为：

```text
QueryEngine.submitMessage()
→ fetchSystemPromptParts()
→ systemPrompt + userContext + systemContext
→ query()
→ shouldAutoCompact()
→ compactConversation()
→ boundary + summary + kept tail
→ forked / side-question / compact 子路径复用 CacheSafeParams
```

对应重点文件：

- `QueryEngine.ts`
- `utils/queryContext.ts`
- `utils/systemPrompt.ts`
- `constants/prompts.ts`
- `constants/systemPromptSections.ts`
- `services/compact/compact.ts`
- `services/compact/autoCompact.ts`

### 2.3 两边最核心的结构差异

Claude Code 的重点不是“有摘要”本身，而是：

1. system prompt 分块组织
2. 静态前缀与动态区块分离
3. compact boundary + summary + kept tail 顺序固定
4. side question / compact / forked agent 复用同一套 cache-safe 前缀

Lecquy 当前已经接近的是：

1. 主线程上下文装配集中到单入口
2. compact summary block 已经结构化
3. recent tail 已有明确概念
4. simple / plan final-answer / resume 已开始复用统一 builder

## 3. Claude Code 对标点

本轮按下面 8 个点做对标：

1. 主线程上下文总入口是否统一
2. system prompt 是否分块并区分静态前缀 / 动态区块
3. 是否存在 `systemPrompt + userContext + systemContext` 的明确边界
4. compact summary block / recent tail 的顺序是否稳定
5. compact 触发是否是 token-aware，而不是固定条数阈值
6. compact 事件是否携带 boundary / preserved segment 语义
7. fork / retry / side-question / resume 是否复用同一套上下文构建纪律
8. 仓内是否还存在会误导后续开发的旧上下文路径

## 4. 已对齐点

### 4.1 主线程上下文入口已经基本统一

Lecquy 当前主链路已经把上下文装配收口到：

- `SessionRuntimeService.buildContextMessages()`
- `buildAugmentedContext()`
- `SessionManager.buildSessionContext()`

这意味着当前运行中的 `simple / plan manager / plan final-answer / run_resume`，已经不是各自手工拼接 `contextMessages`，这一点和 Claude Code 强调“统一上下文入口”的方向是一致的。

### 4.2 compact summary block 已经是单一定义

Lecquy 已把 compact summary 模板收敛到：

- `backend/src/runtime/context/templates/compact-summary.template.ts`

同时 `memory/compact.ts` 与 `SessionManager.buildSessionContext()` 都复用它，而不是多处分散写摘要文本，这一点是对齐的。

### 4.3 memory recall block 已经是单一定义

Lecquy 已把 memory recall 模板收敛到：

- `backend/src/runtime/context/templates/memory-recall.template.ts`

虽然这不是 Claude Code 的原生 memdir 方案，但从“模板只定义一次、由统一 builder 注入”的工程纪律看，这一步是对的。

### 4.4 recent tail 已经进入上下文模型

Lecquy 当前 compact 后不会把全部历史继续原样塞回模型，而是保留：

- 一段 compact summary
- 一段 recent tail

这与 Claude Code 的“摘要 + 保留近端原文”思路一致，只是触发策略和载荷结构仍未对齐。

### 4.5 final-answer 阶段已经复用主线程上下文 builder

`plan` 工作流的 final-answer 阶段没有另起一套历史装配逻辑，而是重新调用 `buildContextMessages()`，并且 recall 仍锚定原始用户问题，而不是锚定“请给最终答复”这条合成 prompt。

这一点体现了 Claude Code 式的“最终答复阶段也遵守同一上下文纪律”。

## 5. 未对齐点

| 对标项 | Claude Code | Lecquy 当前 | 影响 |
| --- | --- | --- | --- |
| system prompt 组织方式 | 分块、分层、可区分静态前缀与动态区块 | `buildSystemPrompt()` 直接拼成单字符串 | 无法明确共享前缀，难以做 cache-friendly 审计 |
| prompt 上下文拆分 | 显式拆成 `systemPrompt + userContext + systemContext` | 只有单个 system prompt 字符串 | 项目上下文、文档、时间、运行态全混在一起，难以稳定前缀 |
| prompt section 缓存 | `systemPromptSection()` 支持缓存直到 `/clear` 或 `/compact` | 每轮重新读模板、上下文文件、文档入口 | 上下文前缀缺少“稳定块”概念 |
| compact 后消息顺序 | `boundary + summary + kept tail` 顺序固定 | 有 compact 时，`memory recall block` 会插到 `compact summary` 前面 | 动态 recall 打断稳定前缀，不够 cache-friendly |
| compact 触发策略 | 基于 token window、输出预留、buffer 的 autocompact | 固定 `50` 条消息触发、固定保留 `10` 条 tail | 不随模型上下文窗变化，容易过早或过晚压缩 |
| compact 载荷结构 | 有 `compact_boundary`、`pre_tokens`、`preserved_segment` | 只有 `compaction` entry + `firstKeptEntryId` + 少量 details | 不能表达 Claude 式 boundary 语义，也不利于未来 partial compact |
| fork / side-question / compact 子路径 | 通过 `CacheSafeParams` 复用同一套前缀 | `worker` 只拿任务 prompt，不继承主线程上下文前缀 | 子路径无法共享相同的上下文纪律与缓存策略 |
| retry / fallback 路径 | side question、fallback、compact fork 都遵守同一套 cache-safe 装配 | Lecquy 只有 pause resume，没有 Claude 式 side-question / retry 体系 | 差异清单还没覆盖这部分路径 |
| live message store 行为 | compact 后主动裁掉 boundary 之前的 live messages | Lecquy 保留 append-only 全量树，靠重建视图投影上下文 | 虽然持久化更稳，但与 Claude 的 boundary 运行语义不同 |
| 仓内旧路径残留 | 主链路高度集中 | 仍保留 `session-v2/` 与旧 `ws/simple-handler.ts`、`ws/plan-handler.ts` | 容易让后续开发误把旧裁剪逻辑当主链路 |

### 5.1 最大的未对齐不是 compact，而是“共享前缀工程”还没落地

当前 Lecquy 已经有：

- unified builder
- compact summary block
- recent tail

但还没有 Claude Code 最核心的两层结构：

1. `systemPrompt / userContext / systemContext` 明确拆分
2. 静态前缀和动态区块的显式边界

所以现在 Lecquy 更像是“统一了消息侧 builder”，但还没有真正完成 Claude Code 意义上的“上下文工程收口”。

### 5.2 当前 builder 顺序在 compact 场景下不够稳定

`buildAugmentedContext()` 当前的关键行为是：

- 无 compact 时：`session history -> memory recall`
- 有 compact 时：`memory recall -> compact summary -> recent tail`

这会导致同一个会话在 compact 前后，动态 recall block 的插入位置发生变化。

如果目标是更接近 Claude Code 的 cache-friendly 纪律，这一顺序应当固定，且动态 recall 不应打断 compact summary 与 recent tail 组成的稳定区块。

### 5.3 compact 目前更像 prototype，而不是 Claude 式 autocompact

Lecquy 当前 compact 的实现重点在：

- “能压”
- “能保留 recent tail”
- “能写回 session tree 与 PG”

但 Claude Code 更强调：

- 根据模型上下文窗判断何时压
- 为输出保留预算
- compact 后立即形成边界化的新上下文视图

所以 Lecquy 当前 compact 仍更接近“消息数阈值原型”，而不是“上下文窗管理系统”。

## 6. 有意不对齐点

### 6.1 不复刻 Claude 的 memdir / auto-dream 长期记忆底座

Claude Code 的记忆体系以：

- `MEMORY.md` / memory files
- `memoryTypes.ts`
- `autoDream/consolidationPrompt.ts`

为中心，强调 durable memory taxonomy，而不是 runtime recall block。

Lecquy 当前的记忆侧是：

- PG / event-first memory
- retrieval + recall block
- foresight sync

这和 Claude Code 不是同一条实现路线。本路线不应该为了“Claude 上下文压缩复刻”而把 Lecquy 整个 memory 底座改造成 memdir。

### 6.2 不复刻 Anthropic 服务端 prefix cache

Claude Code 的很多 cache-friendly 设计，是围绕 Anthropic 的服务端 prompt caching 展开的。

Lecquy 当前能复刻的是：

- 客户端侧的拼接顺序
- 共享前缀稳定性
- 子路径上下文纪律

不能复刻的是：

- Anthropic 服务端真实 cache key 行为
- 专有的 SDK / API 语义

### 6.3 不强行把 Lecquy 的 plan/worker 工作流改成 Claude 的单体 QueryEngine

Claude Code 的 QueryEngine 是单体式主循环，Lecquy 当前则是：

- `manager`
- `worker`
- `final-answer`

三段式 plan workflow。

这不是必须抹平的差异。更合理的目标是：

- 主线程路径遵守 Claude 式上下文纪律
- worker 的“是否需要继承主线程上下文”单独决策

而不是照搬 QueryEngine 的整体形态。

### 6.4 保留 append-only session tree 作为持久化底座

Claude Code 更偏消息流与 transcript/boundary 语义。

Lecquy 当前的 `SessionManager` 是 append-only session tree，并且还要服务：

- workflow projection
- PG dual-write
- session history API

因此本路线更适合在现有 session tree 上补齐 boundary 语义，而不是彻底替换底座。

## 7. 下一步最小可执行改动计划

### 7.1 第一步：先把“当前主链路顺序契约”写死到测试

目标：

- 明确 `simple / plan manager / final-answer / run_resume` 当前都走同一入口
- 明确 compact 与非 compact 场景下，context block 的最终顺序

最小改动：

- 给 `SessionRuntimeService.buildContextMessages()` 增补链路级测试
- 给 `buildAugmentedContext()` 增补 compact 场景顺序测试
- 在文档中明确 `session-v2` 与旧 WS handlers 不属于主链路参考

为什么先做这个：

- 这一步不改行为，但能先把“当前正确入口”冻结下来
- 后续改顺序、改触发策略时，不会误伤旧路径或遗漏 final-answer / resume

### 7.2 第二步：把 builder 顺序改成真正稳定的 cache-friendly 版本

目标：

- 让动态 block 不打断 compact summary 与 recent tail

建议顺序：

```text
sessionContext.messages
→ memory recall block（若存在）
→ 当前用户输入
```

也就是：

- 无 compact 时：`full history -> memory recall -> user`
- 有 compact 时：`compact summary -> recent tail -> memory recall -> user`

最小改动：

- 简化 `buildAugmentedContext()`，不再在 compact 场景下把 summary/tail 拆开重排
- 保持 `SessionManager.buildSessionContext()` 作为 session history 的唯一真源

为什么这一步最小：

- 只动一个 builder
- 不改协议
- 不改 memory/RAG
- 但能立即提高“共享前缀稳定性”

### 7.3 第三步：把 system prompt 先拆成 section，再谈缓存

目标：

- 不先改 prompt 内容，只先改 prompt 组织形式

最小改动：

- 在 `backend/src/core/prompts/` 引入 section registry
- 先把现有内容拆成：
  - stable sections
  - dynamic sections
- 暂时仍返回一个字符串给 agent runners

这一步完成后，Lecquy 才真正具备继续做下面两件事的基础：

- 显式 boundary marker
- `systemPrompt / userContext / systemContext` 三段式拆分

### 7.4 第四步：把 compact 触发从“消息条数阈值”升级为“token-aware 策略”

目标：

- 让 compact 触发更接近 Claude Code，而不是固定 `50/10`

最小改动：

- 引入基于模型上下文窗的阈值计算
- 保留输出预留 buffer
- 把当前 `COMPACT_TRIGGER_MESSAGE_EVENTS` / `COMPACT_RECENT_TAIL` 从散落常量收口为 policy
- `compaction.details` 统一记录：
  - trigger
  - pre_tokens
  - kept_message_count
  - compacted_message_count

这一阶段仍不需要实现完整的 Claude SDK boundary event，只先把 policy 与 metadata 做对。

## 8. 不改范围

本轮之后的最小实施计划，默认仍然不改：

- RAG 接入 runtime 主链路
- 心跳任务
- WebSocket 协议大改
- 数据库 schema 大重构
- Claude memdir / auto-dream 体系整体移植

## 9. 验收标准

下一轮如果按本计划推进，至少要满足下面标准：

1. 仓内能明确说出哪条是当前主链路，哪条是历史遗留路径
2. `simple / plan final-answer / resume` 的上下文顺序有测试约束
3. compact 场景下，动态 recall 不再打断稳定历史前缀
4. system prompt 已具备 section 化骨架，即使暂时还没拆成三段
5. compact policy 与 metadata 不再依赖硬编码的原型常量表述

## 10. 风险与未决项

### 10.1 worker 是否要继承主线程上下文，暂时不要提前做大改

Claude Code 的 forked agent 强调共享 cache-safe 前缀，但 Lecquy 当前 worker 设计是“任务执行器”。

这里要先回答的是产品问题：

- worker 需要继承多少主线程上下文
- 继承的是 recent tail，还是完整 shared prefix

在这个问题没定之前，不建议直接把 Claude 的 fork 语义搬进 Lecquy worker。

### 10.2 session-v2 旧路径要不要删除，当前不建议在这轮动手

`session-v2/` 与旧 `ws/simple-handler.ts`、`ws/plan-handler.ts` 已不是当前主链路，但这轮的重点是对标和收口，不是仓库清扫。

更合理的做法是：

- 先在文档和测试里明确“主链路是谁”
- 后续再单独开一轮做遗留代码清理
