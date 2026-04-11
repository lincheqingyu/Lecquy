# Lecquy Docs

项目文档统一收敛在根目录 `docs/` 下，按前端和后端分组维护。

## 当前主线

1. [`20260408-1-Monorepo 使用指南 技术规范.md`](./20260408-1-Monorepo 使用指南 技术规范.md)：了解 workspace 结构和常用命令
2. [`20260408-2-个人强 Agent 路线 开发规划.md`](./20260408-2-个人强 Agent 路线 开发规划.md)：记录 Lecquy 从 AI Web 向“个人强 Agent”演进的最终方向与阶段重点
3. [`backend/20260408-3-Runtime Memory Compact 决策沉淀 技术规范.md`](./backend/20260408-3-Runtime Memory Compact 决策沉淀 技术规范.md)：三份 Claude/记忆/compact 探索产物压缩后的正式决策沉淀，适合新会话快速对齐
4. [`backend/20260408-4-记忆系统一期后端实施 开发规划.md`](./backend/20260408-4-记忆系统一期后端实施 开发规划.md)：当前两周最应该跟着走的后端实施清单与开发顺序
5. [`backend/20260408-5-记忆系统一期 TS 方案 开发规划.md`](./backend/20260408-5-记忆系统一期 TS 方案 开发规划.md)：记忆系统一期的最新技术基线，已统一到 `runtime + session_events + event-first`
6. [`backend/20260408-6-后端架构分析 技术规范.md`](./backend/20260408-6-后端架构分析 技术规范.md)：后端主链路、runtime 中枢和模式边界分析
7. [`backend/20260408-7-Claude Code 能力借鉴路线 开发规划.md`](./backend/20260408-7-Claude Code 能力借鉴路线 开发规划.md)：Claude Code 可借鉴能力与中长期吸收路线
8. [`20260408-8-环境参数配置 技术规范.md`](./20260408-8-环境参数配置 技术规范.md)：环境变量、默认值、覆盖关系与配置风险说明

当前状态：

- 已完成：PG 底座、runtime dual-write、memory write path、retrieval / injection、foresight sync、compact prototype、cache-friendly 收口验收、RAG 最小骨架、RAG text-first 可实验检索、本地 PostgreSQL 第一轮真实 smoke 验收
- 已完成部分真实链路验收：前端同协议 WS 客户端已验证 `simple + PG + event memory + compaction`
- 已完成模型可达性验收：`http://192.168.3.49:8003/v1` 可达，但 event extraction 当前仍回退 heuristic
- 当前边界：RAG 仍未接入 runtime 主链路，不参与 memory recall / ws，只在后端内部提供表结构、chunk 策略与 repository 检索
- 当前阻塞：`plan -> foresight` 在真实 WS 验收里仍未通过，本地 `qwen3-coder-30b-instruct` 连续两次生成空 `todo_updated`
- 当前开发期原则：默认使用本机进程 + 本机 PostgreSQL 联调，不使用 Docker / Docker Compose 作为默认开发或部署路径
- 本地 PG 环境入口：`pnpm pg:dev:start` / `pnpm pg:dev:stop` / `pnpm --filter @lecquy/backend run pg:smoke`
- 一键联调入口：`pnpm dev:full`
- WS / LLM 验收入口：
  - `pnpm --filter @lecquy/backend run pg:ws-acceptance`
  - `pnpm --filter @lecquy/backend run pg:live-extraction`

## Frontend

- [`frontend/20260408-9-Tailwind className 编写 技术规范.md`](./frontend/20260408-9-Tailwind className 编写 技术规范.md)：Tailwind 4 + React className 编写约定
- [`frontend/20260408-10-前端网络与 Public 资源 技术规范.md`](./frontend/20260408-10-前端网络与 Public 资源 技术规范.md)：前后端端口约定与 `frontend/public` 静态资源清单

## Backend 专题

- [`backend/20260408-11-后端接口示例 技术规范.md`](./backend/20260408-11-后端接口示例 技术规范.md)：当前后端 HTTP / WebSocket 接口说明与调用示例
- [`backend/20260408-12-会话管理联调 技术规范.md`](./backend/20260408-12-会话管理联调 技术规范.md)：会话管理模块联调文档
- [`backend/20260408-13-Simple Plan 模式分析 技术规范.md`](./backend/20260408-13-Simple Plan 模式分析 技术规范.md)：`simple / plan` 模式专题，已统一到 runtime 口径
- [`backend/20260409-1-Lecquy 隐藏 Prompt 与模式边界 技术规范.md`](./backend/20260409-1-Lecquy 隐藏 Prompt 与模式边界 技术规范.md)：冻结隐藏 prompt、mode、executor、skill、memory 与权限边界的正式基线
- [`backend/20260409-2-Lecquy 隐藏 Prompt 文档评审指令 技术规范.md`](./backend/20260409-2-Lecquy 隐藏 Prompt 文档评审指令 技术规范.md)：交给 Claude 做正式架构评审前的参考方向、评估原则、评分标准与可复制指令

## 隐藏 Prompt v2 重构

- [`backend/20260410-1-隐藏 Prompt v2 重构 开发规划.md`](./backend/20260410-1-隐藏%20Prompt%20v2%20重构%20开发规划.md)：总领纲要，5 个开发包的顺序、分层真源表、物理请求格式、集成策略
- [`backend/20260410-2-Prompt 分层类型基座 技术规范.md`](./backend/20260410-2-Prompt%20分层类型基座%20技术规范.md)：包 0 — 7 层类型定义、capability、USER.md schema、权限三档
- [`backend/20260410-3-Prompt 序列化器 技术规范.md`](./backend/20260410-3-Prompt%20序列化器%20技术规范.md)：包 1 — `<LAYER:xxx>` 序列化入口、模板归层映射、字节稳定性契约
- [`backend/20260410-4-Startup Context 加载器 技术规范.md`](./backend/20260410-4-Startup%20Context%20加载器%20技术规范.md)：包 2 — USER.md 双切片、capability block、预算截断
- [`backend/20260410-5-Memory 路径收敛 技术规范.md`](./backend/20260410-5-Memory%20路径收敛%20技术规范.md)：包 3 — startup summary + query recall 双通道、MEMORY.summary.md
- [`backend/20260410-6-模式与权限契约层 技术规范.md`](./backend/20260410-6-模式与权限契约层%20技术规范.md)：包 4 — 权限三档、manager/worker 授权协议、worker 上下文隔离
- [`backend/20260410-7-Skill Runtime 层 技术规范.md`](./backend/20260410-7-Skill%20Runtime%20层%20技术规范.md)：包 5 — manifest-first、specificity、常驻管理、版本冻结

## 剩余主线专题

- [`backend/20260408-14-Memory Retrieval 与 Prompt Injection 技术规范.md`](./backend/20260408-14-Memory Retrieval 与 Prompt Injection 技术规范.md)：检索与 prompt injection 的实现规范
- [`backend/20260408-15-Foresight 单向同步 技术规范.md`](./backend/20260408-15-Foresight 单向同步 技术规范.md)：`TodoManager -> foresight` 单向同步规范
- [`backend/20260408-16-上下文压缩与稳定化 技术规范.md`](./backend/20260408-16-上下文压缩与稳定化 技术规范.md)：compact 与 cache-friendly 上下文稳定化规范
- [`backend/20260408-17-RAG Spike 边界 技术规范.md`](./backend/20260408-17-RAG Spike 边界 技术规范.md)：RAG spike 的边界、最小表结构与接口建议

## 三条路线文件夹

### Claude 上下文压缩复刻

- [`backend/Claude 上下文压缩复刻/20260408-1-Claude 上下文压缩复刻 开发规划.md`](./backend/Claude 上下文压缩复刻/20260408-1-Claude 上下文压缩复刻 开发规划.md)
- [`backend/Claude 上下文压缩复刻/20260408-2-Claude 上下文压缩复刻 开发与文档编写原则 技术规范.md`](./backend/Claude 上下文压缩复刻/20260408-2-Claude 上下文压缩复刻 开发与文档编写原则 技术规范.md)
- [`backend/Claude 上下文压缩复刻/20260408-3-Claude 上下文压缩参考项目探索 技术规范.md`](./backend/Claude 上下文压缩复刻/20260408-3-Claude 上下文压缩参考项目探索 技术规范.md)
- [`backend/Claude 上下文压缩复刻/20260408-4-Claude 上下文压缩复刻 Lecquy 对标分析 技术规范.md`](./backend/Claude 上下文压缩复刻/20260408-4-Claude 上下文压缩复刻 Lecquy 对标分析 技术规范.md)
- [`backend/Claude 上下文压缩复刻/20260408-5-Claude Code 共享前缀与 Lecquy 结构对比 技术规范.md`](./backend/Claude 上下文压缩复刻/20260408-5-Claude Code 共享前缀与 Lecquy 结构对比 技术规范.md)

### PaperQA 风格 RAG

- [`backend/PaperQA 风格 RAG/20260408-1-PaperQA 风格 RAG 开发规划.md`](./backend/PaperQA 风格 RAG/20260408-1-PaperQA 风格 RAG 开发规划.md)
- [`backend/PaperQA 风格 RAG/20260408-2-PaperQA 风格 RAG 开发与文档编写原则 技术规范.md`](./backend/PaperQA 风格 RAG/20260408-2-PaperQA 风格 RAG 开发与文档编写原则 技术规范.md)
- [`backend/PaperQA 风格 RAG/20260408-3-PaperQA 风格 RAG 参考项目探索 技术规范.md`](./backend/PaperQA 风格 RAG/20260408-3-PaperQA 风格 RAG 参考项目探索 技术规范.md)
- [`backend/PaperQA 风格 RAG/20260408-4-PaperQA 风格 RAG 基线差距与实验建议 技术规范.md`](./backend/PaperQA 风格 RAG/20260408-4-PaperQA 风格 RAG 基线差距与实验建议 技术规范.md)

### 心跳任务系统

- [`backend/心跳任务系统/20260408-1-心跳任务系统 开发规划.md`](./backend/心跳任务系统/20260408-1-心跳任务系统 开发规划.md)
- [`backend/心跳任务系统/20260408-2-心跳任务系统 开发与文档编写原则 技术规范.md`](./backend/心跳任务系统/20260408-2-心跳任务系统 开发与文档编写原则 技术规范.md)
- [`backend/心跳任务系统/20260408-3-心跳任务系统 参考项目探索 技术规范.md`](./backend/心跳任务系统/20260408-3-心跳任务系统 参考项目探索 技术规范.md)

## Research Artifacts

- [`memory-phase1-exploration-report.md`](/Users/hqy/Documents/zxh/projects/Lecquy/.lecquy/artifacts/docs/memory-phase1-exploration-report.md)：记忆系统一期第一轮深度探索稿，保留问题空间和最早决策过程
- [`memory-phase1-followup-details.md`](/Users/hqy/Documents/zxh/projects/Lecquy/.lecquy/artifacts/docs/memory-phase1-followup-details.md)：记忆系统 follow-up 细化稿，重点收敛 runtime、schema、提取契约和检索细节
- [`runtime-memory-compact-exploration.md`](/Users/hqy/Documents/zxh/projects/Lecquy/.lecquy/artifacts/docs/runtime-memory-compact-exploration.md)：runtime / memory / compact 联合探索稿，重点覆盖 dual-write、compact 插入点和 cache-friendly 思路

## 补充说明

- 当前文档已统一到 `runtime + session_events + event-first memory` 基线，旧的 `session-v2 + session_messages` 口径不再作为实施参考
- `frontend/README.md` 和 `backend/AGENTS.md` 仍保留在各自目录，作为包级开发入口说明
