# Simple / Plan 模式分析

本文档是后端 `simple` / `plan` 两种运行模式的实现差异专题，重点服务联调、排查和模式级开发。

如果需要维护者视角的高层架构判断、模块边界分析和收敛建议，请优先阅读 `backend-architecture-analysis.md`。本文不承担项目级架构决策说明。

## 1. 入口与触发方式

两种模式共用同一个 WebSocket 入口：

- 入口文件：`backend/src/ws/chat-ws.ts`
- WebSocket 路径：`/api/v1/chat/ws`
- 触发字段：客户端发送 `chat` 事件时的 `payload.mode`

请求示意：

```json
{
  "event": "chat",
  "payload": {
    "mode": "simple",
    "route": {
      "channel": "webchat",
      "chatType": "dm",
      "peerId": "web-user-001"
    },
    "messages": [
      { "role": "user", "content": "你好" }
    ]
  }
}
```

分发逻辑：

- `mode === "simple"` 时进入 `backend/src/ws/simple-handler.ts`
- `mode === "plan"` 时进入 `backend/src/ws/plan-handler.ts`
- 如果当前会话处于 `isWaiting = true`，后端只允许继续以 `plan` 模式补充输入

## 2. 请求流转差异

### simple

```txt
chat-ws
  -> resolveActiveSession()
  -> handleSimpleChat()
  -> runSimpleAgent()
  -> agentLoop()
  -> 直接返回 assistant 文本 / 工具事件
```

### plan

```txt
chat-ws
  -> resolveActiveSession()
  -> handlePlanChat()
  -> runManagerAgent()
  -> todo_write 产出计划
  -> executePendingTodos()
  -> runWorkerAgent() 逐项执行
  -> 全部完成后发送 done
```

## 3. Agent 角色差异

### simple: `runSimpleAgent`

位置：`backend/src/agent/agent-runner.ts`

职责：

- 组装 simple 模式系统提示词
- 将用户消息和上下文送入 `agentLoop`
- 在启用工具时执行完整工具集
- 合并上下文消息并写入 memory/session

### plan: `runManagerAgent` + `runWorkerAgent`

位置：

- `backend/src/agent/manager-runner.ts`
- `backend/src/agent/worker-runner.ts`

`runManagerAgent` 负责拆解任务和写入 todo。  
`runWorkerAgent` 负责逐项执行 todo 并返回执行结果。

结论：

- `simple` 是单 Agent 对话
- `plan` 是 manager + worker 的两阶段协作

## 4. 工具集差异

工具注册位置：`backend/src/agent/tools/index.ts`

### simple 工具集

- `read_file`
- `bash`
- `edit_file`
- `write_file`
- `skill`
- `sessions_list`
- `sessions_history`
- `sessions_send`
- `sessions_spawn`
- 扩展工具：`backend/src/extensions/`

说明：只有当请求里 `enableTools = true` 时，simple 才会挂载这些工具。

### manager 工具集

- `read_file`
- `skill`
- `todo_write`
- `sessions_list`
- `sessions_history`
- `sessions_send`
- `sessions_spawn`

说明：manager 默认不具备文件写入和 shell 执行能力。

### worker 工具集

- `read_file`
- `bash`
- `edit_file`
- `write_file`
- `skill`
- `sessions_list`
- `sessions_history`
- `sessions_send`
- 扩展工具：`backend/src/extensions/`

说明：当前 worker 不包含 `sessions_spawn`。

## 5. 会话状态差异

关键状态字段位于 `backend/src/session-v2/types.ts`：

- `isRunning`
- `isWaiting`
- `resumeHint`
- `waitingTodoIndex`
- `todoManager`

### simple

- 开始执行时设置 `isRunning = true`
- 不使用 `isWaiting`、`waitingTodoIndex`
- 完成后持久化上下文并清理 abort controller

### plan

- manager 完成后把 todo 列表载入 `todoManager`
- worker 执行中如果需要用户补充信息，会设置：
  - `isWaiting = true`
  - `waitingTodoIndex = 当前 todo`
  - `resumeHint` 在用户恢复执行时注入
- 用户再次发送 `mode: "plan"` 的消息后，通过 `resumePlanChat()` 继续执行未完成 todo

## 6. 事件流差异

共享事件定义位于 `shared/src/ws-events.ts`。

### simple 常见事件

- `session_key_resolved`
- `session_restored`
- `message_delta`
- `message_end`
- `tool_start`
- `tool_end`
- `done`
- `error`

### plan 额外事件

- `plan_created`
- `worker_start`
- `worker_delta`
- `worker_end`
- `todo_update`
- `need_user_input`

## 7. 适用场景、优缺点

### simple

适合普通问答和轻量任务。

优点：

- 链路短，响应快
- 前端处理成本低

限制：

- 不擅长显式任务拆解
- 没有 todo 可视化执行过程

### plan

适合复杂任务拆解和多步骤执行。

优点：

- 可以展示任务清单与进度
- 支持中途等待用户补充信息

限制：

- 链路更长，状态更复杂
- `shouldWaitForUserInput()` 当前基于启发式文本判断，存在误判空间

## 8. 当前实现与旧文档的偏差

- 旧文档仍描述 `HTTP /api/v1/chat + SSE` 为主链路，但当前主链路已经是 WebSocket `/api/v1/chat/ws`
- `backend/src/controllers/chat.ts` 现在只是废弃提示，不承载实际对话能力
- 旧文档中提到的 `sub-agent-runner.ts` 已不准确，当前实际文件是 `worker-runner.ts`
- 当前后端实际已有 `session-v2`、`memory`、`models`、`sessions` 等接口与模块
- health 接口当前只返回 `status` 和 `timestamp`

## 9. 开发建议

- 单轮对话能力优先考虑 `simple`
- 需要计划可视化、恢复执行或用户中途补充信息时优先接入 `plan`
- 更新文档时优先同步：
  - `shared/src/ws-events.ts`
  - `backend/src/ws/chat-ws.ts`
  - `backend/src/ws/simple-handler.ts`
  - `backend/src/ws/plan-handler.ts`
