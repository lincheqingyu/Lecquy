# Agent Web 后端

## 项目定位

WebClaw 后端服务，为前端 AI 对话客户端提供 Agent 驱动的对话能力。

**核心职责**：Agent 对话调度 · 工具调用 · 技能系统 · 流式响应

**与前端的边界**：前端负责 UI 交互和用户体验，后端负责 Agent 调度、LLM API 调用、密钥管理和业务逻辑。前端不直接调用 LLM API。

## 技术栈

Node.js 24.13 · Express 4.x · TypeScript 5.9 · ESM 模式

**Agent 框架**：`@mariozechner/pi-ai` + `@mariozechner/pi-agent-core`（替代 LangChain/LangGraph）

## 架构

### 请求流程

```
WebSocket chat → chat-ws → simple-handler / plan-handler → Agent Runner → vLLM/OpenAI API
```

| 层级 | 职责 |
|------|------|
| ws/ | WebSocket 路由分发、会话恢复、事件推送 |
| agent-runner | simple 模式主 Agent |
| manager-runner | plan 模式规划 Agent |
| worker-runner | plan 模式执行 Agent |
| tools/ | 工具实现（bash, read_file, edit_file, write_file, skill, todo_write, session-tools） |
| vllm-model | Model 工厂，连接 vLLM/OpenAI 兼容 API |

### 前端传参

前端可通过请求体传递自定义参数：
- `model`: 模型 ID（覆盖环境变量 LLM_MODEL）
- `baseUrl`: API 地址（覆盖环境变量 LLM_BASE_URL）
- `apiKey`: API Key（覆盖环境变量 LLM_API_KEY）

## 目录结构

```
src/
├── server.ts               # 服务器启动入口
├── app.ts                  # Express 应用配置
├── config/                 # 配置管理
├── ws/                     # WebSocket chat 入口与模式处理
├── agent/                  # Agent 核心（simple / manager / worker）
├── controllers/            # HTTP 路由（health, models, memory, sessions）
├── session-v2/             # 会话服务、持久化、裁剪与恢复
├── core/                   # prompts、skills、todo、memory
├── extensions/             # 扩展工具
├── middlewares/            # 请求日志、错误处理
├── memory/                 # memory 文件与 flush 逻辑
└── utils/                  # 日志等工具函数
```

## 文档导航

- 后端架构决策分析：`../docs/backend/backend-architecture-analysis.md`
- 后端接口文档：`../docs/backend/api-examples.md`
- 会话联调文档：`../docs/backend/session-management-integration.md`
- simple / plan 模式分析：`./simple-plan-modes-analysis.md`

## 开发规范

### TypeScript 严格模式

- `strict: true` 已启用，禁止 `any` 类型
- 所有函数参数和返回值必须标注类型
- 使用 `interface` 定义数据结构，`type` 定义联合/工具类型

### 模块隔离

- Agent 层不依赖 Express（纯 LLM 逻辑）
- Controller 层不包含业务逻辑
- 各层通过 TypeScript 接口通信

### 依赖管理

- 通过 pnpm workspace 管理：`pnpm -F @webclaw/backend add <包名>`
- 最小依赖原则，优先使用 Node.js 原生 API
- 生产依赖与开发依赖严格分离

## 本地开发

### 运行

```bash
pnpm dev:backend      # 单独启动后端（热重载）
pnpm dev              # 前后端并行启动
```

### 环境变量

在项目根目录维护 `.env`，后端启动时会从根目录加载配置：

```bash
PORT=3000
LLM_API_KEY=sk-xxx
LLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4/
LLM_MODEL=glm-4-plus
```

### 构建

```bash
pnpm build:backend    # 编译 TypeScript → dist/
pnpm start            # 运行编译后的代码
```
