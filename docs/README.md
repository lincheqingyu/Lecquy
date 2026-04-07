# WebClaw Docs

项目文档统一收敛在根目录 `docs/` 下，按前端和后端分组维护。

## 当前主线

1. [`monorepo-guide.md`](./monorepo-guide.md)：了解 workspace 结构和常用命令
2. [`personal-strong-agent-roadmap.md`](./personal-strong-agent-roadmap.md)：记录 WebClaw 从 AI Web 向“个人强 Agent”演进的最终方向与阶段重点
3. [`backend/runtime-memory-compact-decisions.md`](./backend/runtime-memory-compact-decisions.md)：三份 Claude/记忆/compact 探索产物压缩后的正式决策沉淀，适合新会话快速对齐
4. [`backend/memory-system-phase1-backend-checklist.md`](./backend/memory-system-phase1-backend-checklist.md)：当前两周最应该跟着走的后端实施清单与开发顺序
5. [`backend/memory-system-phase1-ts-plan.md`](./backend/memory-system-phase1-ts-plan.md)：记忆系统一期的最新技术基线，已统一到 `runtime + session_events + event-first`
6. [`backend/backend-architecture-analysis.md`](./backend/backend-architecture-analysis.md)：后端主链路、runtime 中枢和模式边界分析
7. [`backend/claude-code-capability-borrowing-roadmap.md`](./backend/claude-code-capability-borrowing-roadmap.md)：Claude Code 可借鉴能力与中长期吸收路线
8. [`environment-configuration.md`](./environment-configuration.md)：环境变量、默认值、覆盖关系与配置风险说明

当前状态：

- 已完成：PG 底座、runtime dual-write、memory write path、retrieval / injection、foresight sync、compact prototype、cache-friendly 收口验收、RAG 最小骨架、RAG text-first 可实验检索、本地 PostgreSQL 第一轮真实 smoke 验收
- 当前边界：RAG 仍未接入 runtime 主链路，不参与 memory recall / ws，只在后端内部提供表结构、chunk 策略与 repository 检索
- 本地 PG 环境入口：`pnpm pg:dev:start` / `pnpm pg:dev:stop` / `pnpm --filter @webclaw/backend run pg:smoke`

## Frontend

- [`frontend/tailwind-classname-guide.md`](./frontend/tailwind-classname-guide.md)：Tailwind 4 + React className 编写约定
- [`frontend/network-and-public-assets.md`](./frontend/network-and-public-assets.md)：前后端端口约定与 `frontend/public` 静态资源清单

## Backend 专题

- [`backend/api-examples.md`](./backend/api-examples.md)：当前后端 HTTP / WebSocket 接口说明与调用示例
- [`backend/session-management-integration.md`](./backend/session-management-integration.md)：会话管理模块联调文档
- [`backend/simple-plan-modes-analysis.md`](./backend/simple-plan-modes-analysis.md)：`simple / plan` 模式专题，已统一到 runtime 口径

## 剩余主线专题

- [`backend/memory-retrieval-and-prompt-injection-spec.md`](./backend/memory-retrieval-and-prompt-injection-spec.md)：检索与 prompt injection 的实现规范
- [`backend/foresight-sync-spec.md`](./backend/foresight-sync-spec.md)：`TodoManager -> foresight` 单向同步规范
- [`backend/compact-and-context-stabilization-spec.md`](./backend/compact-and-context-stabilization-spec.md)：compact 与 cache-friendly 上下文稳定化规范
- [`backend/rag-spike-boundary-spec.md`](./backend/rag-spike-boundary-spec.md)：RAG spike 的边界、最小表结构与接口建议

## Research Artifacts

- [`memory-phase1-exploration-report.md`](/Users/hqy/Documents/zxh/projects/ZxhClaw/.ZxhClaw/artifacts/docs/memory-phase1-exploration-report.md)：记忆系统一期第一轮深度探索稿，保留问题空间和最早决策过程
- [`memory-phase1-followup-details.md`](/Users/hqy/Documents/zxh/projects/ZxhClaw/.ZxhClaw/artifacts/docs/memory-phase1-followup-details.md)：记忆系统 follow-up 细化稿，重点收敛 runtime、schema、提取契约和检索细节
- [`runtime-memory-compact-exploration.md`](/Users/hqy/Documents/zxh/projects/ZxhClaw/.ZxhClaw/artifacts/docs/runtime-memory-compact-exploration.md)：runtime / memory / compact 联合探索稿，重点覆盖 dual-write、compact 插入点和 cache-friendly 思路

## 补充说明

- 当前文档已统一到 `runtime + session_events + event-first memory` 基线，旧的 `session-v2 + session_messages` 口径不再作为实施参考
- `frontend/README.md` 和 `backend/AGENTS.md` 仍保留在各自目录，作为包级开发入口说明
