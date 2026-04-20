# Runtime / Memory / Compact 决策沉淀

更新日期：2026-04-07

## 1. 目的

这份文档现在只承担两件事：

- 作为当前基线与默认值的索引页
- 作为“剩余主线专题文档”的总入口

如果需要具体实现细节，优先跳到对应专题文档，而不是继续在这里扩写。

## 2. 当前总基线

当前主线已经固定为：

- 主运行时对标 `runtime/`
- 会话真相源对标 `session_events`
- 记忆一期走 `event-first memory`
- 存储地基走 `PostgreSQL + pgvector + pg_trgm`
- 文件系统保留为兼容层、回退层、导出层
- compact 先做行为对齐，不做字节级复刻
- RAG 当前只做 spike，不进主线交付

一句话版本：

> 先把 `runtime -> session_events -> event memory -> retrieval/injection` 打通，再收口 cache-friendly 上下文，最后冻结 RAG 骨架边界，但暂不接入主链路。

## 3. 当前已完成项

当前已经落地的部分：

- PostgreSQL 可选开关与启动/关闭接入
- `runtime -> sessions / session_events` dual-write
- `memory_items / memory_jobs` 建表
- `MemoryCoordinator.onTurnCompleted()` 入队 `extract_event`
- event extraction 的最小写入闭环
- retrieval / prompt injection
- `TodoManager -> foresight` 单向同步
- compact prototype
- cache-friendly 上下文收口（Task A）已验收
- RAG spike 最小骨架（Task B）已落地
- RAG text-first 检索与最小 chunk 策略（phase 2）已实现，可供后端内部实验
- 本地 PostgreSQL 验收环境已落地，并完成第一轮真实 smoke 验收
- 前端同协议 WS 真实验收已完成一轮部分通过：`simple + event memory + compaction` 通过，`plan -> foresight` 仍被模型阻塞
- 可达 LLM extraction 验收已完成一轮：模型链路可达，但当前仍回退 `heuristic`

当前仍未落地的部分：

- knowledge retrieval 尚未接入 runtime 主链路
- 尚未完成“包含 foresight 的完整前端 / WS 驱动 PostgreSQL 端到端验收”
- RAG 仍未实现 reranker / citation / embedding 检索

## 4. 已拍板决策

- 一期迁移锚点是 [`session-runtime-service.ts`](../../backend/src/runtime/session-runtime-service.ts)，不是 `session-v2`
- 会话物理模型优先是 `sessions + session_events`
- 记忆系统 canonical schema 仍是 `profile / episodic / event / foresight`
- 一期 recall 主来源固定为 `event`
- 一期 `foresight` 固定为单向同步
- compact 固定为派生层，不重写历史事件
- RAG 固定为独立 `knowledge_chunks` 方向，不复用 `memory_items`
- RAG 当前已支持 text-first 实验检索，但仍不参与 memory recall
- 当前机器已真实验证：`PG_ENABLED=true` 启动、migration、runtime dual-write、event memory、foresight、compact、RAG ingest/search
- 当前机器已真实验证：前端同协议 WS 客户端可驱动 `simple -> sessions/session_events -> event memory -> compaction`
- 当前机器已真实确认：本地 `qwen3-coder-30b-instruct` 在 plan 验收里连续两次产生 `todo_updated.items = []`，因此 `foresight` 还不能写成“真实通过”
- 当前机器已真实确认：`http://192.168.3.49:8003/v1` 可达，但 event extraction 输出仍不满足当前 JSON schema，最终回退 `heuristic`
- compact 识别已改为依赖 `SessionContext.compaction` 结构化元信息，不再靠 summary 文案相等
- plan final answer 阶段的 recall 查询已明确固定为“原始用户输入”，不改成 synthetic final prompt

## 5. 当前推荐默认值

这些默认值必须和当前代码保持一致：

- `event extraction threshold = 4`
- `event extraction maxMessages = 8`
- `memory job poll interval = 5000ms`
- `memory job max retry = 3`
- `event extraction` 一期只提 `event`
- `FTS config = simple`
- `vector index` 一期先不建近似索引
- `compact trigger = 50 message events`
- `compact recent tail = 10`

## 6. 当前最重要的挂接点

### 6.1 Runtime Dual-Write

- [`session-runtime-service.ts`](../../backend/src/runtime/session-runtime-service.ts)
- [`runtime-session-repository.ts`](../../backend/src/db/runtime-session-repository.ts)

### 6.2 记忆入口

- [`session-runtime-service.ts`](../../backend/src/runtime/session-runtime-service.ts)
  - run 完成后已经走 `MemoryCoordinator.onTurnCompleted()`
- [`coordinator.ts`](../../backend/src/memory/coordinator.ts)
- [`extraction-runner.ts`](../../backend/src/memory/extraction-runner.ts)

### 6.3 Compact 入口

- [`session-manager.ts`](../../backend/src/runtime/pi-session-core/session-manager.ts)
  - `buildSessionContext()`
  - `appendCompaction()`

## 7. 剩余主线专题文档

剩余主线的实现细节已经拆分为 4 份专题规范：

- [`20260408-14-Memory Retrieval 与 Prompt Injection 技术规范.md`](./20260408-14-Memory Retrieval 与 Prompt Injection 技术规范.md)
- [`20260408-15-Foresight 单向同步 技术规范.md`](./20260408-15-Foresight 单向同步 技术规范.md)
- [`20260408-16-上下文压缩与稳定化 技术规范.md`](./20260408-16-上下文压缩与稳定化 技术规范.md)
- [`20260408-17-RAG Spike 边界 技术规范.md`](./20260408-17-RAG Spike 边界 技术规范.md)

## 8. 与其他文档的关系

- 一期技术基线：[`20260408-5-记忆系统一期 TS 方案 开发规划.md`](./20260408-5-记忆系统一期 TS 方案 开发规划.md)
- 当前实施顺序：[`20260408-4-记忆系统一期后端实施 开发规划.md`](./20260408-4-记忆系统一期后端实施 开发规划.md)
- 后端主链路：[`20260408-6-后端架构分析 技术规范.md`](./20260408-6-后端架构分析 技术规范.md)
- Claude Code 能力借鉴：[`20260408-7-Claude Code 能力借鉴路线 开发规划.md`](./20260408-7-Claude Code 能力借鉴路线 开发规划.md)

如果只保留一句话作为后续开发锚点，请保留这一句：

> Lecquy 当前最正确的开发顺序，是保持 `runtime + session_events + event-first memory` 主链路稳定，只在需要时单独把 knowledge retrieval 接入，而不是继续扩张 memory 主链路。 
