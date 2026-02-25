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
请求 → Controller → runMainAgent() → agentLoop (pi-agent-core) → streamSimple (pi-ai) → vLLM HTTP
```

| 层级 | 职责 |
|------|------|
| Controller | HTTP 路由，参数校验，SSE 流式推送 |
| agent-runner | 主 Agent 循环，迭代控制，todo 自动执行 |
| sub-agent-runner | 子 Agent 分发，执行 pending todo items |
| tools/ | 工具实现（bash, read_file, skill, todo_write） |
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
│   ├── index.ts
│   └── env.ts              # 环境变量校验
├── agent/                  # Agent 核心（pi-agent-core）
│   ├── index.ts            # 统一导出
│   ├── types.ts            # 共享常量和类型
│   ├── vllm-model.ts       # vLLM Model 工厂
│   ├── agent-runner.ts     # 主 Agent 运行器
│   ├── sub-agent-runner.ts # 子 Agent 运行器
│   └── tools/              # 工具实现
│       ├── index.ts
│       ├── bash.ts
│       ├── read-file.ts
│       ├── skill.ts
│       └── todo-write.ts
├── core/                   # 业务核心
│   ├── agent/agent-config.ts   # Agent 类型配置
│   ├── prompts/system-prompts.ts # 系统提示词
│   ├── skills/skill-loader.ts   # 技能加载器
│   └── todo/todo-manager.ts     # 任务管理器
├── types/                  # 全局类型定义
│   ├── api.ts              # API 响应类型
│   └── index.ts
├── controllers/            # 路由控制层
│   ├── chat.ts             # 对话路由
│   └── health.ts           # 健康检查
├── middlewares/             # 中间件
│   ├── error-handler.ts    # 全局错误处理
│   └── request-logger.ts   # 请求日志
└── utils/                  # 工具函数
    ├── logger.ts           # 日志工具
    └── stream.ts           # SSE 流式工具
```

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

复制 `.env.example` 为 `.env` 并填入：

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
