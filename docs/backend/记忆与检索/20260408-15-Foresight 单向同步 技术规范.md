# Foresight 单向同步规范

更新日期：2026-04-06

## 1. 目标与边界

这份文档只定义一期的 `TodoManager -> foresight` 单向同步。

目标：

- plan 模式中的 todo 状态变化能沉淀到长期记忆
- 为后续提醒、自动跟进、主动 agent 留接口

一期边界固定为：

- 只做 `TodoManager -> foresight`
- 不做 `foresight -> TodoManager`
- 不单独建任务系统
- 不新增 `tasks / task_events`
- 仍写入 `memory_items`

## 2. 当前事件源

当前 todo 状态的真实事件源在：

- [`backend/src/runtime/session-runtime-service.ts`](../../backend/src/runtime/session-runtime-service.ts)
  - planner 生成完 todo 后调用 `appendTodoUpdated()`
  - worker 开始执行某个 todo 时调用 `appendTodoUpdated()`
  - worker 完成或失败后再次调用 `appendTodoUpdated()`
- [`backend/src/runtime/projections.ts`](../../backend/src/runtime/projections.ts)
  - `todo_updated` 会被消费成 workflow projection 的当前 todo 状态

一期同步不从下面这些位置取数：

- `ws/plan-handler.ts`
- 前端 `todo_update` 事件
- `todo_write` 工具原始输出

唯一真相源固定为：

- runtime 的 `todo_updated` 事件链路

## 3. 挂接点

一期推荐新增一个专门 helper，例如：

- `backend/src/memory/foresight-sync.ts`

同步调用点固定为：

1. `bound.manager.appendTodoUpdated(runId, items)`
2. `await this.refreshProjection(sessionKey)`
3. 调用 `syncTodosToForesight(projection, runId, items)`

这样做的原因是：

- `appendTodoUpdated()` 只负责写事件
- `refreshProjection()` 之后能拿到一致的 workflow 快照
- `syncTodosToForesight()` 只关心 todo 到 memory 的映射

## 4. Foresight 最小模型

一期不单独建表，仍写入 `memory_items`。

固定写法：

- `kind = 'foresight'`
- `summary = item.content`
- `content = item.activeForm || item.content`
- `session_id = projection.sessionId`
- `session_key = projection.key`

`payload_json` 最小结构固定为：

```ts
{
  foresight_type: 'todo',
  progress: 'pending' | 'in_progress' | 'done' | 'cancelled',
  run_id: string,
  todo_index: number,
  content: string,
  active_form?: string,
  error?: string,
  updated_at: string
}
```

## 5. 唯一键与 Upsert 规则

一期唯一键固定为：

- `session_id + run_id + todo_index`

因为当前 `memory_items` 没有独立唯一索引列来表达这组语义，所以实现时直接使用确定性 `id`：

```text
mem_foresight_<session_id>_<run_id>_<todo_index>
```

upsert 规则固定为：

- 如果该 `id` 不存在，则插入
- 如果该 `id` 已存在，则更新 `summary / content / payload_json / updated_at / status`

不要在一期通过模糊查重来决定是否更新同一条 foresight。

## 6. 状态映射

一期状态映射固定如下：

- `pending -> payload.progress = pending`，`memory_items.status = active`
- `in_progress -> payload.progress = in_progress`，`memory_items.status = active`
- `completed -> payload.progress = done`，`memory_items.status = superseded`
- `failed / interrupted -> payload.progress = cancelled`，`memory_items.status = superseded`

这里明确选择：

- 错误结束统一记为 `cancelled`
- 一期不引入 `done_with_error`

这样后续 recall 只需查：

- `kind = 'foresight'`
- `status = 'active'`

即可拿到仍待跟进的事项。

## 7. 去重规则

一期去重规则固定为：

- 同一 `session_id + run_id + todo_index` 只保留一条当前记录
- 同一 run 中多次 `todo_updated` 通过 deterministic id 覆盖更新
- 不因为 `content` 或 `activeForm` 的文案变化而新建第二条记录

## 8. 与 Plan / Simple 模式边界

一期只在 `plan` 模式下写 foresight。

明确不做：

- `simple` 模式普通聊天自动生成 foresight
- assistant 自发承诺自动转换成 todo
- `event memory` 反推 `foresight`

也就是说：

- plan 模式负责结构化 todo
- foresight 只接 plan 模式已经显式存在的 todo

## 9. 当前未实现

这部分必须明确：

- 还没有 `foresight-sync.ts`
- `memory_items` 里还没有 `kind = 'foresight'` 的写入
- 还没有 deterministic foresight id 方案落代码

## 10. 测试场景

实现完成后，至少验证这些场景：

1. planner 首次生成 3 个 todo 时，生成 3 条 `foresight` 记录
2. 某 todo 从 `pending` 变 `in_progress` 时，原记录被更新而不是新建
3. 某 todo 完成后，`payload.progress = done` 且 `memory_items.status = superseded`
4. 某 worker 失败时，该 todo 被更新成 `cancelled`
5. simple 模式对话不产生任何 `foresight`
