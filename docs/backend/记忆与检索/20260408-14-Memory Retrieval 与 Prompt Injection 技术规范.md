# Memory Retrieval / Prompt Injection 规范

更新日期：2026-04-06

## 1. 目标与当前状态

这份文档只解决一个问题：

`memory_items` 已经能写入 PostgreSQL，下一步如何把这些记忆稳定地检索出来，并安全地注入到 runtime 上下文。

当前事实：

- `runtime -> sessions / session_events` dual-write 已完成
- `MemoryCoordinator.onTurnCompleted()` 已能入队 `extract_event` job
- `memory_items.kind = 'event'` 已可写入
- retrieval / prompt injection 还未实现

一期范围：

- 只检索 `memory_items.kind = 'event'`
- 只做 text-first recall
- 不依赖 embedding
- 不把 memory recall 持久化回 `session_events`

一期明确不做：

- 不做 `episodic / profile / foresight` recall 混排
- 不做 reranker
- 不做查询意图分类模型
- 不做“写回会话”的记忆注入事件

## 2. 实现锚点

当前 runtime 的上下文装配链路是：

- [`backend/src/runtime/session-runtime-service.ts`](../../backend/src/runtime/session-runtime-service.ts)
  - `executeRun()`
  - `executeSimple()`
  - `executePlan()`
- [`backend/src/runtime/pi-session-core/session-manager.ts`](../../backend/src/runtime/pi-session-core/session-manager.ts)
  - `buildSessionContext()`

一期挂接点固定为：

1. `executeRun()` 里先取 `manager.buildSessionContext().messages`
2. 再调用一个新的 memory augmentation helper
3. 得到增强后的 `contextMessages`
4. 再把增强后的 `contextMessages` 传给 `executeSimple()` / `executePlan()`

不要把 recall 挂在下面这些位置：

- WebSocket handler
- `SessionManager` 内部 vendored 逻辑
- `agent-runner.ts` 的底层 tool loop

## 3. Retrieval Data Flow

一期数据流固定为：

1. 从当前用户输入提取 `userQuery`
2. 如果 `PG_ENABLED=false`，直接跳过 recall
3. 如果 `userQuery` 为空或过短，直接跳过 recall
4. 查询当前 `session_id` 下的 `memory_items`
5. 仅保留 `kind = 'event'` 且 `status = 'active'`
6. 用 `tags + trigram + FTS(simple)` 做 text-first 排序
7. 取前 `topK = 5`
8. 把 recall 结果格式化成一个固定模板的 synthetic context block
9. 将这个 block 追加到原有 `contextMessages` 前缀中
10. 检索失败时静默降级为“不注入记忆”

这里的“追加到前缀中”指的是：

- 保持 `buildSessionContext()` 的历史顺序不变
- recall block 作为一条非持久化的 synthetic user-context message，放在历史上下文之后、当前用户输入之前

## 4. Repository Contract

建议新增：

- `backend/src/db/memory-search-repository.ts`
- `backend/src/memory/prompt-injector.ts`

一期 contract 固定如下：

```ts
export interface MemoryRecallQuery {
  sessionId: string
  sessionKey: string
  userQuery: string
  mode: 'simple' | 'plan'
  route?: string
  limit?: number
}

export interface MemoryRecallResult {
  id: string
  kind: 'event'
  summary: string
  content: string
  tags: string[]
  importance: number
  confidence: number
  occurredAt?: string
  sourceEventIds: string[]
  score: number
}
```

repository 固定只暴露一个主查询函数：

```ts
searchEventMemories(pool, query): Promise<MemoryRecallResult[]>
```

一期排序优先级固定为：

1. `tags` 精确命中
2. `content / summary` 的 `pg_trgm` 相似度
3. `FTS(simple)` 排名
4. `importance`
5. `confidence`
6. `created_at` 新近性

如果实现时需要 SQL 权重，可以按这个顺序折算，但不要改变排序主语义。

## 5. Prompt Injection 模板

一期注入模板固定为一条 synthetic user-context block，不持久化，不写回 session event。

固定模板：

```text
以下是与当前问题相关的历史记忆，只作为辅助上下文。
如果这些记忆与当前用户输入冲突，以当前用户输入为准。

[Relevant Memory]
1. summary: ...
   content: ...
   tags: tag1, tag2
   source: session memory

2. summary: ...
   content: ...
   tags: ...
   source: session memory
```

固定规则：

- 标题始终使用 `Relevant Memory`
- 条目顺序必须按 recall score 降序
- 每条都保留 `summary / content / tags`
- 不插入运行时动态解释语
- 不插入当前时间、请求 ID、调试分数
- 无命中时完全不生成这个 block

注入位置固定为：

- `base session history`
- `relevant memory block`
- `current user message`

不要把 memory recall 作为 `extraSystemPrompt` 动态拼进去。

## 6. 默认值

一期默认值固定如下：

- recall source：`event-only`
- `topK = 5`
- 注入预算：`1200-1800 tokens`
- 单条 memory 最大保留：`summary 80 chars`，`content 200 chars`
- recall block 超预算时：从低分项开始裁剪，不裁剪模板头
- 检索失败时：静默降级为“不注入”
- `route` 和 `mode` 一期只保留在接口里，不参与排序

## 7. Failure Modes

一期失败回退固定为：

- PostgreSQL 未开启：跳过 recall
- 查询报错：记录 warn/error，继续主流程
- 无命中：不注入
- 单条 memory 缺字段：丢弃该条，继续其余结果
- recall block 超预算：裁掉低分项，不截断中间字段

不要因为 recall 失败而阻断用户回复。

## 8. 当前未实现

这部分必须明确：

- 还没有 `memory-search-repository.ts`
- 还没有 `prompt-injector.ts`
- 还没有 recall block 注入到 `executeRun()`
- 还没有 `event` 之外的多层 recall

## 9. 验收用例

实现完成后，至少验证这些场景：

1. 当前会话里提过“后续先做记忆系统”，再次问“我们接下来先做什么”，能召回对应 `event memory`
2. 当前会话没有相关记忆时，不注入空模板
3. 检索 SQL 报错时，主回复仍正常生成
4. 连续两轮相似问题，memory block 模板顺序稳定
5. 中文问题主要依赖 `tags` 命中，英文标识符问题可由 `FTS(simple)` 补充
