# WebClaw — Agent Web 全栈项目

## 项目概述

基于浏览器的 AI 对话客户端，pnpm monorepo 架构。

## 技术栈

| 模块 | 技术 |
|------|------|
| 前端 | React 19 · Vite 7 · TypeScript 5.9 · Tailwind CSS 4 |
| 后端 | Express 4 · TypeScript 5.9 · ESM · pi-agent-core |
| 共享 | @webclaw/shared（类型定义） |
| 包管理 | pnpm workspace |

## 架构全景

```
浏览器 ──WebSocket──→ Express ──→ Agent Runner ──→ vLLM/OpenAI API
  │                     │              │
  │ shared 类型         │ shared 类型   │ tools/
  └─── @webclaw/shared ─┘              ├── bash, read_file, edit_file
                                       ├── write_file, skill, todo_write
                                       └── session-tools/
```

### 前后端通信协议

**WebSocket 事件**（定义在 `shared/src/ws-events.ts`）：
- 客户端 → 服务端：`chat`（发送消息）、`cancel`（取消）、`pong`
- 服务端 → 客户端：`message_delta`（流式文本）、`tool_start/end`（工具调用）、`todo_update`（任务更新）、`worker_start/delta/end`（子 Agent）、`done`、`error`

**chat 事件 payload**：`{ mode, route, messages, model?, baseUrl?, apiKey?, enableTools?, options? }`

### 会话类型（定义在 `shared/src/session.ts`）

- `SessionRouteContext`：路由上下文（channel, chatType, peerId 等）
- `SessionSnapshot`：会话快照（持久化用）
- `SerializedTodoItem`：todo 项（content, status, activeForm）

## 目录导航

```
WebClaw/
├── frontend/          # React SPA（详见 frontend/README.md 与 docs/frontend/）
│   └── src/
│       ├── app/home/  # 首页：HomePageLayout, ConversationArea, SettingsDrawer
│       ├── components/chat/  # 消息组件：MessageItem, MessageList
│       ├── components/ui/    # UI 原语：ChatInput, AutoResizeTextarea
│       ├── hooks/     # useChat, useAutoResize
│       ├── lib/       # ws-reconnect, session
│       └── config/    # api.ts（API 地址配置）
├── backend/           # Express 服务（详见 backend/AGENTS.md 与 backend/simple-plan-modes-analysis.md）
│   └── src/
│       ├── agent/     # Agent 核心：agent-runner, vllm-model, tools/
│       ├── controllers/  # health, memory, models, sessions
│       ├── core/      # prompts, skills, todo, memory
│       ├── ws/        # WebSocket chat handlers
│       └── session-v2/ # 会话服务与持久化
├── shared/            # 共享类型包
│   └── src/
│       ├── ws-events.ts  # WebSocket 事件类型
│       └── session.ts    # 会话相关类型
└── pnpm-workspace.yaml
```

## 文档导航

- 统一文档入口：`docs/README.md`
- 前端文档目录：`docs/frontend/`
- 后端文档目录：`docs/backend/`

## 协作分工

本项目默认采用 `Claude Code + Codex` 双开协作模式，但这是一套工作流经验，不是绝对规则。

### 角色定位

- `Claude Code`：更适合先想清楚再动手，承担 `planner / reviewer / architect`
- `Codex`：更适合定义清楚后高速执行，承担 `implementer / finisher / repo operator`

### 优先交给 Claude Code 的任务

- 新系统设计、迁移方案、接口边界设计
- Agent 编排、状态流、上下文处理策略设计
- 大型重构方案与阶段拆解
- 复杂 bug 根因分析，尤其是跨文件、跨层链路问题
- PR review、风险审计、长 diff 审查
- 读长文档、长日志、长上下文后输出结论

### 优先交给 Codex 的任务

- 根据明确 spec 直接实现功能
- 批量改文件、补样板代码、补测试
- 修类型错误、lint、测试失败
- 按 checklist 执行中小型实现任务
- 做仓库内高频、重复、吞吐优先的开发工作
- 做 repo 自动化、GitHub / workflow 相关落地操作

### 推荐协作流水线

1. `Claude Code` 先理解需求、出方案、拆任务
2. `Codex` 按方案实现第一版
3. `Claude Code` 做 review、补边界条件、检查架构偏移
4. `Codex` 按 review 继续收尾、补测试、整理仓库

### 快速判断标准

- 如果任务还不清楚、需要先想方案、要读很多上下文、或者主要是评审，优先给 `Claude Code`
- 如果需求已经写清楚、成功标准明确、主要是执行和修改，优先给 `Codex`

## 关键开发路径

### 前后端联调常见任务

| 任务 | 涉及文件 |
|------|---------|
| 新增 WS 事件 | `shared/src/ws-events.ts` → `backend/src/ws/` → 前端 hook |
| 修改消息格式 | `shared/src/session.ts` → 后端 agent-runner → 前端 MessageItem |
| 新增工具 | `backend/src/agent/tools/` → `tools/index.ts` 注册 |
| 修改 UI 组件 | `frontend/src/components/` 或 `app/home/components/` |
| 会话管理 | `backend/src/session-v2/` + `frontend/src/lib/session.ts` |

### 开发命令

```bash
pnpm dev              # 前后端并行启动
pnpm dev:backend      # 仅后端
pnpm dev:frontend     # 仅前端
pnpm build            # 全量构建
```

## 开发规范

- **语言**：中文注释/对话，英文代码/配置
- **样式**：Tailwind CSS 4
- **不可变性**：ALWAYS 创建新对象，NEVER 直接修改
- **详细规范**见各子目录说明文档和 `.claude/rules/`
