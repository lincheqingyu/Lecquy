# ZxhClaw 后端架构决策分析

本文档面向项目维护者，聚焦当前后端主链路、会话体系、Agent 分工和 shared 协议边界。写法遵循“结论 -> 证据 -> 建议”，重点回答当前结构哪里合理、哪里边界不清，以及后续该如何收敛。

## 1. 主结论概览

### 结论

当前后端已经形成了一个相对清晰的“WebSocket 接入层 -> 模式处理层 -> Agent 执行层 -> SessionService 持久化/通知层 -> shared 协议层”主干结构，适合继续演进。

真正需要维护者关注的问题，不是入口是否还能工作，而是以下三类边界正在逐步变得模糊：

1. `chat-ws.ts` 同时承担协议校验、会话恢复、运行模式调度和连接生命周期管理，入口开始变重。
2. `plan` 模式的流程控制有一部分留在 `plan-handler.ts`，另一部分依赖 `SessionRuntimeState` 与 `TodoManager` 的隐式约定，恢复链路偏脆弱。
3. 前端对 WebSocket 事件的消费并没有完全复用 shared 中的 payload 类型，协议虽然集中定义了，但边界还没有完全闭合。

### 证据

- WebSocket 统一入口位于 `backend/src/ws/chat-ws.ts`，负责：
  - 解析 `chat` / `cancel` / `pong`
  - 调用 `sessionService.resolveActiveSession()`
  - 注册 notifier
  - 按 `mode` 分发到 `handleSimpleChat()` 或 `handlePlanChat()`
  - 在 `isWaiting` 场景切换到 `resumePlanChat()`
  - 管理心跳和连接关闭时的状态持久化
- `simple` 与 `plan` 模式分别落到 `backend/src/ws/simple-handler.ts` 和 `backend/src/ws/plan-handler.ts`。
- 会话状态集中在 `backend/src/session-v2/types.ts` 的 `SessionRuntimeState`，而索引、快照、标题生成、上下文裁剪、通知又都收口到 `backend/src/session-v2/session-service.ts`。
- shared 层已经定义了 `shared/src/ws-events.ts` 和 `shared/src/session.ts`，但前端 `frontend/src/hooks/useChat.ts` 仍自行定义了 `WsEventPayloadMap`、`SessionResolvedPayload`、`SessionTitleUpdatedPayload` 等本地类型。

### 建议

- 继续坚持当前分层，不要回到“控制器/入口直接驱动 Agent 细节”的结构。
- 下一轮优先收敛两个边界：
  - 入口层与模式流程控制的边界
  - shared 协议定义与前端消费类型的边界

## 2. WebSocket 主链路：设计方向正确，但入口职责偏重

### 结论

当前以 WebSocket 作为对话主链路是合理的，尤其适合 `message_delta`、`worker_delta`、`need_user_input` 这类事件流。但 `chat-ws.ts` 已经同时承担“协议入口”和“会话编排入口”两类职责，后续一旦再增加模式、鉴权或 tracing，文件会继续膨胀。

### 证据

- `backend/src/ws/chat-ws.ts` 使用 `/api/v1/chat/ws` 建立统一入口。
- 该文件内直接完成了：
  - WebSocket envelope 解析与 `chatRequestSchema` 校验
  - `session_key_resolved`、`session_restored` 事件发送
  - `cancel` 对 `abortController` 与运行状态的回收
  - `isWaiting` 场景下把用户追加输入塞进 `resumeHint`
  - `simple` / `plan` 分支分发
  - `close` 时的 `persistState()`
- 这意味着连接状态机、协议处理、模式调度都耦合在单一文件里。

### 建议

- 保持 WebSocket 为主链路，不建议回退到 HTTP + SSE 双主链路。
- 但应把 `chat-ws.ts` 的职责逐步收敛为：
  - 连接生命周期与基础协议处理
  - 调用一个更高层的“chat orchestration”接口
- 如果后续继续演进，可优先抽出：
  - 请求解析与会话装配
  - 运行模式分发
  - 取消/恢复状态处理

## 3. Simple / Plan 分层：产品意图清楚，执行语义还不够封装

### 结论

`simple` 与 `plan` 的职责分工目前是清楚的，这一点是现有后端最稳的部分之一：

- `simple` 负责单 Agent 对话
- `plan` 负责 manager 规划 + worker 执行

问题不在模式定义，而在 `plan` 的执行语义没有被完全封装，导致恢复、等待用户输入和 todo 生命周期仍然散落在 handler 与 state 约定之间。

### 证据

- `backend/src/ws/simple-handler.ts`：
  - 构建模型与 API key
  - 归一化消息
  - 读取裁剪后的历史上下文
  - 调用 `runSimpleAgent()`
  - 记录消息、更新标题、持久化状态
- `backend/src/ws/plan-handler.ts`：
  - 先 `runManagerAgent()` 写入 `todoManager`
  - 在 `todo_write` 完成后发送 `plan_created`
  - 再通过 `executePendingTodos()` 循环调用 `runWorkerAgent()`
  - 如果 `shouldWaitForUserInput()` 命中，则写入 `isWaiting`、`waitingTodoIndex`、`resumeHint`
  - 用户下一轮输入再通过 `resumePlanChat()` 继续执行
- `shouldWaitForUserInput()` 当前只是基于文本包含 `?`、`？`、`请提供`、`请告诉` 的启发式判断。
- `SessionRuntimeState` 承载了 `isRunning`、`isWaiting`、`resumeHint`、`waitingTodoIndex`、`todoManager` 等流程状态，这些字段一起才构成 plan 的恢复语义。

### 建议

- 保留 `simple` / `plan` 双模式，不建议过早合并。
- 但 `plan` 应尽快从“handler 里的循环 + 状态字段组合”升级为更明确的执行状态机，至少要把以下语义收口成统一抽象：
  - 当前 todo 的选择规则
  - 用户补充信息如何注入
  - 等待态如何判断与恢复
  - 完成态/错误态如何外显
- `shouldWaitForUserInput()` 是当前最脆弱的一段逻辑，后续应优先考虑替换为结构化信号，而不是继续堆启发式文案判断。

## 4. SessionService：已经是事实上的后端中枢，值得继续收口

### 结论

`session-v2` 当前不是一个普通的“会话存储模块”，而是事实上的运行时中枢。这个方向本身是对的，因为会话、快照、标题、历史、通知和上下文裁剪原本就强相关；但它已经开始承载过多横切职责，后续需要按“状态核心”和“附属能力”拆出边界。

### 证据

- `backend/src/session-v2/types.ts` 定义了运行态核心结构 `SessionRuntimeState`。
- `backend/src/session-v2/session-service.ts` 统一负责：
  - session key 解析后的活动会话恢复
  - 内存态和快照态切换
  - transcript 追加与索引持久化
  - context pruning
  - title generation
  - notifier 分发
  - `runSend()` 与 `spawnTask()` 这类基于会话的能力
- `resolveActiveSession()` 已经承担了“查找旧会话 / 轮转会话 / 恢复快照 / 初始化运行态 / 更新时间戳”的完整流程。
- `recordRunResult()` 同时更新 entry stats、追加 transcript、持久化 snapshot 和 index。

### 建议

- 不建议把 `SessionService` 打散回多个轻量 util，因为它已经天然承接会话中枢角色。
- 但应在它内部逐步形成两个层次：
  - 运行态与持久化核心：active session、snapshot、transcript、pruning
  - 附属能力：title generation、session tool notifications、spawn/send
- 后续如果继续做复杂能力，优先避免把更多“运行模式逻辑”直接塞进 `SessionService`；它更适合做状态与生命周期中枢，而不是模式编排器。

## 5. 工具能力边界：模式分层合理，但存在能力不对称

### 结论

当前工具集分配体现了明确的权限意图，这是好事：manager 默认不具备 shell 和文件写能力，worker/simple 才具备执行型工具。这种设计对控制规划 Agent 的破坏半径是有效的。

不过，`sessions_spawn` 仅存在于 simple/manager，不存在于 worker，这让“计划内执行”和“子任务派生”之间出现了能力不对称，后续要么固化为刻意限制，要么补足成明确规则。

### 证据

- `backend/src/agent/tools/index.ts` 中：
  - `createSimpleTools()` 包含 `read_file`、`bash`、`edit_file`、`write_file`、`skill`、会话工具和扩展工具
  - `createManagerTools()` 包含 `read_file`、`skill`、`todo_write`、部分会话工具，不含 shell/file write
  - `createWorkerTools()` 包含执行型工具和扩展工具，但不包含 `sessions_spawn`
- `plan-handler.ts` 中 manager 负责产出 todo，worker 负责逐项执行，这与工具集权限分离一致。

### 建议

- 继续保留 manager 的受限工具集，不建议给 manager 直接增加写文件或 shell 能力。
- 明确 `sessions_spawn` 缺失是否为设计选择：
  - 如果是为了防止 worker 无限制派生子任务，应在文档里明确这是约束
  - 如果只是当前实现未补齐，应列入后续能力设计，而不是保持“半隐式差异”

## 6. Shared 协议边界：后端已经共享定义，前端尚未完全消费

### 结论

shared 层已经承担了“协议单一事实源”的角色，但前端还没有完全围绕这个事实源实现消费，导致协议边界只闭合了一半。当前最大风险不是运行失败，而是前后端事件 payload 演进时出现静默漂移。

### 证据

- `shared/src/ws-events.ts` 已定义：
  - `ServerEventType`
  - `ServerEventPayloadMap`
  - `ClientEventType`
  - `ClientEventPayloadMap`
- `shared/src/session.ts` 已定义：
  - `SessionRouteContext`
  - `SessionEntry`
  - `SessionSnapshot`
  - `SerializedTodoItem`
- 但 `frontend/src/hooks/useChat.ts` 仍自行维护 `WsEventPayloadMap`，且只覆盖了部分事件。
- 前端 `handleWsEvent()` 对很多事件采取“兜底展示 JSON”的方式消费，这保证了兼容性，但削弱了类型约束。

### 建议

- 保持 `shared` 继续作为 WS 与 session 协议定义的唯一来源。
- 下一步应优先推动前端直接消费 shared 类型，而不是继续在 hook 内部复制 payload 映射。
- 如果短期不做全量改造，至少优先收口以下事件的 shared 类型复用：
  - `session_key_resolved`
  - `session_title_updated`
  - `need_user_input`
  - `plan_created`
  - `worker_start` / `worker_end`

## 7. 前后端边界：前端仍是 UI 驱动方，后端不应回收交互职责

### 结论

目前前后端总体边界是健康的：前端负责交互状态与消息展示，后端负责 Agent 调度、模型调用和会话持久化。这条边界应继续保持，不建议把更多 UI 语义下沉到后端。

### 证据

- `frontend/src/hooks/useChat.ts` 负责：
  - 本地消息列表维护
  - optimistic message 处理
  - `isStreaming` / `isWaiting` 等前端交互状态
  - WebSocket 建立、发送、取消
  - 把服务端事件映射到 UI 消息
- `frontend/src/lib/ws-reconnect.ts` 负责重连、消息队列、自动回应 `ping`
- 后端 `chat-ws.ts` 只发协议事件，不直接处理任何前端展示逻辑
- 会话列表、历史、标题编辑等非流式能力则通过 `frontend/src/lib/session-api.ts` 访问 HTTP `/sessions*` 接口

### 建议

- 保持“后端发事实事件，前端决定展示方式”的模式。
- 但前端 hook 目前已经同时承担 transport、event mapping、UI state 三层职责，后续如果聊天 UI 继续复杂化，建议把 WS transport 和事件归一化再拆一层，避免 `useChat()` 继续膨胀。

## 8. 维护优先级建议

### 结论

当前最值得投入的不是大规模重写，而是针对两个脆弱边界做低风险收敛。

### 证据

- 主链路已经完整可用，且 `simple` / `plan` 分层明确。
- 更显著的风险来自：
  - `plan` 的等待/恢复语义过于依赖隐式状态
  - shared 类型与前端消费未完全闭合
  - WebSocket 入口职责逐渐膨胀

### 建议

建议按以下顺序推进：

1. 优先收敛协议边界：让前端更多直接复用 `shared/src/ws-events.ts` 与 `shared/src/session.ts`。
2. 收敛 `plan` 恢复语义：把等待用户输入、恢复执行、todo 状态推进变成更明确的状态机或统一编排抽象。
3. 减轻 `chat-ws.ts`：把模式分发与运行编排从连接入口里抽离。
4. 最后再考虑进一步细化 `SessionService` 内部边界。

## 9. 文档分工说明

- 本文档负责维护者视角的后端架构判断与收敛建议。
- [`simple-plan-modes-analysis.md`](./simple-plan-modes-analysis.md) 继续作为 `simple` / `plan` 实现差异专题文档使用。
- [`session-management-integration.md`](./session-management-integration.md) 继续承担联调约定，不负责架构决策。
- [`api-examples.md`](./api-examples.md) 继续承担接口与调用示例，不负责内部实现分析。
