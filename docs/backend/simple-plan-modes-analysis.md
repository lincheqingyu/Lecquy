# Simple / Plan 模式分析

更新日期：2026-04-01

本文档只负责说明 `simple` / `plan` 两种运行模式的实现差异，不再承担旧 `session-v2` 口径说明。

## 1. 入口

两种模式共用同一个 WebSocket 入口：

- 入口文件：[`backend/src/ws/chat-ws.ts`](../../backend/src/ws/chat-ws.ts)
- 路径：`/api/v1/chat/ws`
- 触发字段：`payload.mode`

分发规则：

- `mode = simple` -> [`simple-handler.ts`](../../backend/src/ws/simple-handler.ts)
- `mode = plan` -> [`plan-handler.ts`](../../backend/src/ws/plan-handler.ts)
- 如果当前会话处于 waiting 状态，只允许继续以 `plan` 模式恢复

## 2. 请求流转

### simple

```txt
chat-ws
  -> resolve session
  -> handleSimpleChat()
  -> runSimpleAgent()
  -> agentLoop()
  -> runtime append message / projection refresh
```

### plan

```txt
chat-ws
  -> resolve session
  -> handlePlanChat()
  -> runManagerAgent()
  -> todo_write
  -> executePlan()
  -> runWorkerAgent() x N
  -> todo / pause / resume / final reply
```

## 3. Agent 角色差异

### simple

位置：[`backend/src/agent/agent-runner.ts`](../../backend/src/agent/agent-runner.ts)

职责：

- 构建系统提示词
- 运行 `agentLoop`
- 处理工具调用
- 在结束时触发 memory flush 入口

### plan

位置：

- [`backend/src/agent/manager-runner.ts`](../../backend/src/agent/manager-runner.ts)
- [`backend/src/agent/worker-runner.ts`](../../backend/src/agent/worker-runner.ts)
- [`backend/src/runtime/session-runtime-service.ts`](../../backend/src/runtime/session-runtime-service.ts)

职责：

- manager：拆任务、产 todo
- worker：逐项执行
- runtime：维护 todo、pause、resume 和 projection

## 4. 工具集差异

工具注册位置：[`backend/src/agent/tools/index.ts`](../../backend/src/agent/tools/index.ts)

### simple

- 有完整执行型工具集
- 可读写文件、可执行 shell、可访问会话工具

### manager

- 保留 `todo_write`
- 默认不具备 shell 和文件写能力

### worker

- 有执行型工具
- 当前不包含 `sessions_spawn`

这条能力分配是刻意的：manager 偏规划，worker 偏执行。

## 5. 当前运行态不再看 session-v2

过去旧文档常把状态字段归到 `session-v2/types.ts`。现在更准确的说法是：

- 运行态由 runtime projection 和事件流共同表达
- 关键类型主要来自 [`shared/src/session.ts`](../../shared/src/session.ts)
- plan 的 todo / pause / workflow 状态由 runtime 重建和缓存

要点：

- `todo_updated`
- `pause_requested`
- `pause_resolved`
- message / step / custom entry

这些都已经是 runtime 事件流的一部分。

## 6. plan 模式里最关键的几个点

### todo 更新

位置：[`backend/src/runtime/session-runtime-service.ts`](../../backend/src/runtime/session-runtime-service.ts)

典型动作：

- 生成 todo
- 标记 `in_progress`
- 标记 `completed`
- pause 前写入当前 todo 快照

### 等待与恢复

plan 模式的难点不在“能不能继续跑”，而在：

- 哪个 todo 正在等待用户
- 用户补充信息怎么重新注入
- 恢复后如何继续保持上下文和状态一致

这也是后续 `foresight` 和记忆系统需要接住的地方。

## 7. 对记忆系统的直接影响

simple / plan 的区别会直接影响记忆写入策略：

- `simple`
  - 以会话消息窗口触发 `event extraction`
- `plan`
  - manager todo 变化驱动 `foresight`
  - worker 执行结果继续走 event extraction

也就是说：

- `event` 是两种模式都共享的主力层
- `foresight` 先和 plan todo 做单向同步

## 8. 当前最值得注意的开发判断

1. 不要为了记忆系统去打散 `simple / plan`
2. 不要再用 `session-v2` 解释运行态
3. 后续 compact、memory、task 路线都应挂在 runtime 事件流上

如果只保留一句话，请保留这一句：

> `simple` 和 `plan` 的模式边界仍然成立，但它们的状态真相源已经变成了 `runtime + session events`。 
