# Lecquy — Agent Web 全栈项目

## 项目概述

基于浏览器的 AI 对话客户端，pnpm monorepo 架构。

## 技术栈

| 模块 | 技术 |
|------|------|
| 前端 | React 19 · Vite 7 · TypeScript 5.9 · Tailwind CSS 4 |
| 后端 | Express 4 · TypeScript 5.9 · ESM · pi-agent-core |
| 共享 | @lecquy/shared（类型定义） |
| 包管理 | pnpm workspace |

## 架构全景

```
浏览器 ──WebSocket──→ Express ──→ Agent Runner ──→ vLLM/OpenAI API
  │                     │              │
  │ shared 类型         │ shared 类型   │ tools/
  └─── @lecquy/shared ─┘              ├── bash, read_file, edit_file
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
Lecquy/
├── frontend/          # React SPA（详见 frontend/README.md 与 docs/frontend/）
│   └── src/
│       ├── app/home/  # 首页：HomePageLayout, ConversationArea, SettingsDrawer
│       ├── components/chat/  # 消息组件：MessageItem, MessageList
│       ├── components/ui/    # UI 原语：ChatInput, AutoResizeTextarea
│       ├── hooks/     # useChat, useAutoResize
│       ├── lib/       # ws-reconnect, session
│       └── config/    # api.ts（API 地址配置）
├── backend/           # Express 服务（详见 backend/AGENTS.md 与 docs/backend/20260408-13-Simple Plan 模式分析 技术规范.md）
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

## 文档落盘原则

- `docs/` 是项目开发文档目录；方案、规范、验收、复盘、仓库分析、prompt 研究等研发资料统一写入这里
- `.lecquy/` 是运行时上下文与产物目录，不是开发文档目录
- `.lecquy/artifacts/docs/` 只用于面向用户交付、需要在产品里作为附件或文件卡片展示的运行期产物
- 不要因为文档是 AI 生成的，就把研发资料默认写进 `.lecquy/artifacts/docs/`
- 判断目录归属时，优先看“文档用途”：
  - 属于项目研发资料：写 `docs/`
  - 属于运行期交付附件：写 `.lecquy/artifacts/docs/`
- 新增研发文档写入 `docs/` 后，要同步更新 `docs/README.md`

## 文档归类原则

- 文档入口层 `docs/`、`docs/backend/`、`docs/frontend/` 直接放置的 `.md` 文件都不得超过 `5` 个；超过后必须继续拆分主题子目录
- 文档归类优先按“领域 -> 主题”两级判断：
  - 项目级 / 跨端文档：写入 `docs/项目级/`、`docs/环境与配置/` 等根级主题目录
  - 后端文档：写入 `docs/backend/` 下对应主题目录，如 `架构与接口`、`记忆与检索`、`Prompt 与运行时`
  - 前端文档：写入 `docs/frontend/` 下对应主题目录；过时材料优先放入 `历史归档`
- 一级入口目录优先保留 `README.md`、少量总览文档和导航文档；具体方案、规范、验收、复盘不要长期直挂在入口层
- 迁移或整理旧文档时，优先改“目录归属 + README 索引”，非必要不要为归类目的通读全文；通常依据文件名、开头摘要和文档用途判断即可
- 归类完成后，要同步维护对应目录的 `README.md` 或上级导航，保证能按主题和顺序找到文档

## 文档命名规范

以后新增的开发文档、规范文档、验收文档、复盘文档，统一使用下面的文件名格式：

```text
YYYYMMDD-N-文档标题 文档类型.md
```

例如：

- `20260408-1-RAG 开发规划.md`
- `20260408-2-上下文压缩 技术规范.md`
- `20260408-3-PostgreSQL 验收记录.md`
- `20260408-4-真实链路联调 复盘记录.md`

命名规则：

- `YYYYMMDD`：表示该轮文档的日期，必须放在最前面
- `N`：表示同一天内的顺序号，必须从 `1` 开始连续递增，不能跳号
- 同一天的 `2` 必须建立在 `1` 之后，`3` 必须建立在 `2` 之后；编号本身就是阅读顺序和依赖顺序
- `文档标题`：统一优先使用中文；允许空格；保持简短明确
- `文档类型`：必须使用下面的统一词表，不要自行发明近义词

统一词表：

- `开发规划`
- `技术规范`
- `验收记录`
- `复盘记录`

补充要求：

- 未来新增文档默认遵守这套规则，旧文档不强制立即重命名
- 如果同一天新增多份文档，先确认上一份文档已经定稿，再继续编号下一份
- 除非是必须保留的专有名词，否则不要在文件名里混用英文 slug
- 新文档写入 `docs/` 后，要同步更新 `docs/README.md`，保证能按顺序找到

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
pnpm dev:full         # 前端 + 后端 + 本机 PG 一键联调
pnpm dev              # 前后端并行启动
pnpm dev:backend      # 仅后端
pnpm dev:frontend     # 仅前端
pnpm build            # 全量构建
```

## 开发规范

- **开发期运行原则**：当前处于开发阶段，默认采用本机进程 + 本机 PostgreSQL 联调；不要把 Docker / Docker Compose 作为默认开发、验收或部署路径
- **启动入口原则**：一键启动优先使用跨平台 Node 脚本；不要把 `bash` 作为顶层唯一入口
- **PostgreSQL 运行时原则**：Windows 开发机若未安装 PostgreSQL，允许首次启动时自动下载本地运行时到 `.lecquy/pg/`；该目录属于本地依赖缓存，不提交仓库
- **语言**：中文注释/对话，英文代码/配置
- **样式**：Tailwind CSS 4
- **不可变性**：ALWAYS 创建新对象，NEVER 直接修改
- **详细规范**见各子目录说明文档和 `.claude/rules/`
