# WebClaw Docs

项目文档统一收敛在根目录 `docs/` 下，按前端和后端分组维护。

## 阅读顺序

1. [`monorepo-guide.md`](./monorepo-guide.md)：了解 workspace 结构和常用命令
2. [`environment-configuration.md`](./environment-configuration.md)：环境变量、默认值、覆盖关系与配置风险说明
3. [`backend/session-management-integration.md`](./backend/session-management-integration.md)：前后端会话联调约定
4. 按角色继续阅读对应分组文档

## Frontend

- [`frontend/tailwind-classname-guide.md`](./frontend/tailwind-classname-guide.md)：Tailwind 4 + React className 编写约定

## Backend

- [`backend/backend-architecture-analysis.md`](./backend/backend-architecture-analysis.md)：面向维护者的后端架构决策分析
- [`backend/api-examples.md`](./backend/api-examples.md)：当前后端 HTTP / WebSocket 接口说明与调用示例
- [`backend/session-management-integration.md`](./backend/session-management-integration.md)：会话管理模块联调文档

## 补充说明

- `backend/backend-architecture-analysis.md` 负责后端主链路、会话体系、Agent 分工和 shared 边界的维护者分析
- 后端内部运行模式专题文档放在 [`./backend/simple-plan-modes-analysis.md`](./backend/simple-plan-modes-analysis.md)
- `frontend/README.md` 和 `backend/AGENTS.md` 仍保留在各自目录，作为包级开发入口说明
