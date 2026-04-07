# Compact 与 Context Stabilization 规范

更新日期：2026-04-06

## 1. 目标与当前状态

这份文档把两个强相关主题合并处理：

- compact summary
- cache-friendly 上下文稳定化

当前事实：

- `buildSessionContext()` 已支持消费 `compaction` 事件
- `SessionManager.appendCompaction()` 已存在
- compact 生成逻辑已实现最小原型
- cache-friendly 规则还未真正落到 runtime 上下文装配

一期目标固定为：

- 在不改写原始 `session_events` 的前提下生成 compact summary
- 让 runtime 的上下文顺序固定下来，尽量稳定共享前缀

## 2. 当前实现锚点

compact 的现有锚点在：

- [`backend/src/runtime/pi-session-core/session-manager.ts`](../../backend/src/runtime/pi-session-core/session-manager.ts)
  - `appendCompaction()`
  - `buildSessionContext()`
- [`backend/src/runtime/session-runtime-service.ts`](../../backend/src/runtime/session-runtime-service.ts)
  - `executeRun()` 的 run 完成后检查点

当前 `buildSessionContext()` 的行为已经是：

- 如果存在最新 `compaction` 事件，先放 compaction summary
- 再拼接保留区间里的 messages

所以一期不需要重做 context rebuild，只需要把“何时生成 compaction event”补上。

## 3. Compact Trigger

一期 compact 采用固定阈值，不做动态阈值。

阈值固定为：

- 只统计 `message` 事件
- 只统计 `user / assistant` 两类消息
- 当累计消息事件数 `>= 50` 时，触发 compact

保留区固定为：

- `recent tail = 10`

也就是：

- 前面 `40` 条 message events 压成 summary
- 最近 `10` 条 message events 保留原文

## 4. Compaction Payload

一期直接复用已有 `appendCompaction(summary, firstKeptEntryId, tokensBefore, details)`。

字段约定固定为：

- `summary`：压缩后的会话摘要
- `firstKeptEntryId`：保留尾部中的第一条 entry id
- `tokensBefore`：压缩前的估算 token 数
- `details` 最小结构：

```ts
{
  trigger: 'message_threshold',
  kept_message_count: 10,
  compacted_message_count: number,
  compacted_through_entry_id: string
}
```

一期不要：

- 修改旧 `session_events`
- 删除旧 JSONL 内容
- 在数据库层面覆盖历史 event

compact 是派生层，不是真相源替换层。

## 5. Rebuild Algorithm

一期 rebuild 算法固定如下：

1. base system prompt
2. memory recall block
3. `buildSessionContext()` 产出的历史上下文
4. current user input

其中第 3 步内部又固定为：

- 如果没有 compaction：直接按事件路径展开历史消息
- 如果已有 compaction：先放 compaction summary，再放 `recent tail`

也就是说：

- memory recall 在 compaction 之前
- current user input 永远最后进入

## 6. Compact 生成时机

一期不单独建 compact job 表。

生成时机固定为：

- 在 `executeRun()` 的 run 完成后检查点里判断
- 同一轮 run 结束时，如果消息阈值已满足且自上次 compact 后新增消息足够，则调用 `appendCompaction()`
- compact 追加成功后立即 `refreshProjection()`

这样做的原因是：

- 一期先保持实现简单
- compact 与当前 session manager 状态天然同构
- 不引入第二套异步执行器

## 7. Cache-Friendly Checklist

一期稳定化原则固定如下：

- 不追求“最终完整 prompt 永久固定”
- 追求“最长连续共享前缀稳定”
- base system prompt 顺序固定
- tool schema 顺序固定
- memory recall 模板固定
- compact summary 模板固定
- 高变化内容后置
- 不在 recall block 里写动态调试字段
- 不在 recall block 里写每轮不同的解释文字

特别注意：

- 不要把 memory recall 塞进 `extraSystemPrompt`
- 不要把 compact summary 做成每轮不同结构
- 不要让 simple / plan / retry / compact 走不同的上下文拼接顺序

## 8. 当前未实现

这部分必须明确：

- 还没有统一的 augmented context builder
- cache-friendly 规则还未落实到实际 prompt 组装

## 9. 观测指标与验收

实现完成后，至少验证这些场景：

1. 消息事件数未达 `50` 时，不生成 compaction event
2. 达到阈值后，追加一条 compaction event，且不改写历史 event
3. `buildSessionContext()` 在存在 compaction 时输出 `summary + recent tail`
4. 连续两轮相似问题时，memory block 和 compact block 模板顺序稳定
5. compaction 失败时，主对话流程仍可继续
