# WebClaw Frontend

WebClaw 前端是一个基于 React 19、Vite 7、TypeScript 5.9、Tailwind CSS 4 的浏览器 AI 对话客户端。

## 开发命令

```bash
pnpm dev:frontend
pnpm build:frontend
```

## 相关文档

- 根目录文档索引：[`../docs/README.md`](../docs/README.md)
- 前端文档目录：[`../docs/frontend/`](../docs/frontend/)
- Tailwind className 编写指南：[`../docs/frontend/tailwind-classname-guide.md`](../docs/frontend/tailwind-classname-guide.md)
- 前后端会话联调文档：[`../docs/backend/session-management-integration.md`](../docs/backend/session-management-integration.md)

## 说明

- 前端通过 WebSocket 与后端对话：`/api/v1/chat/ws`
- 会话列表、历史、详情等管理能力通过 HTTP `/api/v1/sessions*` 获取
- UI 和交互逻辑位于 `src/`，共享协议类型来自 `@webclaw/shared`
