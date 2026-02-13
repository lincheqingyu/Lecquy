# Agent Web 后端

## 项目定位

WebClaw 后端服务，为前端 AI 对话客户端提供 LLM API 代理和会话管理能力。

**核心职责**：LLM API 调用代理 · 多 Provider 适配 · 流式响应 · 会话管理

**与前端的边界**：前端负责 UI 交互和用户体验，后端负责 LLM API 调用、密钥管理和业务逻辑。前端不直接调用 LLM API。

## 技术栈

Node.js 24.13 · Express 4.x · TypeScript 5.9 · ESM 模式

## 架构

### 分层设计

```
请求 → Controller → Service → Provider → LLM API
                                ↑
                            Registry（Provider 注册表）
```

| 层级 | 职责 |
|------|------|
| Controller | HTTP 路由，参数校验，响应格式化 |
| Service | 业务逻辑，会话管理，Provider 调度 |
| Provider | LLM API 适配，统一接口封装 |
| Middleware | 错误处理，请求日志 |

### Provider 插件机制

所有 LLM Provider 实现统一的 `LLMProvider` 接口：

| 方法 | 用途 |
|------|------|
| `chat()` | 同步对话，返回完整响应 |
| `chatStream()` | 流式对话，返回 AsyncIterable |

**添加新 Provider**：
1. 实现 `LLMProvider` 接口
2. 在 `providers/registry.ts` 中注册
3. 在 `.env` 中配置 API Key

大多数厂商可直接复用 `OpenAICompatibleProvider`，只需配置不同的 `baseURL`。

## 目录结构

```
src/
├── server.ts               # 服务器启动入口
├── app.ts                  # Express 应用配置
├── config/                 # 配置管理
│   ├── index.ts
│   └── env.ts              # 环境变量校验
├── types/                  # 全局类型定义
│   ├── llm.ts              # LLM 消息/选项类型
│   ├── provider.ts         # Provider 接口
│   └── api.ts              # API 请求/响应类型
├── providers/              # LLM Provider 适配层
│   ├── base.ts             # 抽象基类
│   ├── openai-compatible.ts # OpenAI 兼容 Provider
│   └── registry.ts         # Provider 注册表
├── services/               # 业务逻辑层
│   ├── chat.ts             # 对话服务
│   └── provider.ts         # Provider 管理
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

- Provider 层不依赖 Express（纯 LLM 逻辑）
- Service 层不接触 `req` / `res` 对象
- Controller 层不包含业务逻辑
- 各层通过 TypeScript 接口通信

### 依赖管理

- 通过 pnpm workspace 管理：`pnpm -F @webclaw/backend add <包名>`
- 最小依赖原则，优先使用 Node.js 原生 API
- 生产依赖与开发依赖严格分离

## 扩展策略

### 添加新 Provider

```typescript
// 1. 大多数情况：复用 OpenAI 兼容 Provider
registerProvider('deepseek', new OpenAICompatibleProvider({
  name: 'deepseek',
  baseURL: 'https://api.deepseek.com/v1',
  apiKey: config.DEEPSEEK_API_KEY
}))

// 2. 非兼容 API：实现 LLMProvider 接口
class CustomProvider implements LLMProvider { ... }
```

### 添加新功能模块

1. 在 `types/` 添加类型定义
2. 在 `services/` 添加业务逻辑
3. 在 `controllers/` 添加路由
4. 在 `app.ts` 注册路由

### 未来扩展点

| 模块 | 用途 | 优先级 |
|------|------|--------|
| 计费统计 | Token 使用量统计 | 中 |
| 日志追踪 | 请求链路追踪 | 中 |
| API Key 管理 | 多密钥轮换 | 低 |
| 插件系统 | 工具调用、RAG | 低 |

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
OPENAI_API_KEY=sk-xxx
OPENAI_BASE_URL=https://api.openai.com/v1
# 可选：其他 Provider
# DEEPSEEK_API_KEY=sk-xxx
```

### 构建

```bash
pnpm build:backend    # 编译 TypeScript → dist/
pnpm start            # 运行编译后的代码
```
