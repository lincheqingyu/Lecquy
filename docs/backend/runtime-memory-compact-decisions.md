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

当前仍未落地的部分：

- knowledge retrieval 尚未接入 runtime 主链路
- 尚未完成前端 / WS 驱动的 PostgreSQL 端到端验收
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

- [`memory-retrieval-and-prompt-injection-spec.md`](./memory-retrieval-and-prompt-injection-spec.md)
- [`foresight-sync-spec.md`](./foresight-sync-spec.md)
- [`compact-and-context-stabilization-spec.md`](./compact-and-context-stabilization-spec.md)
- [`rag-spike-boundary-spec.md`](./rag-spike-boundary-spec.md)

## 8. 与其他文档的关系

- 一期技术基线：[`memory-system-phase1-ts-plan.md`](./memory-system-phase1-ts-plan.md)
- 当前实施顺序：[`memory-system-phase1-backend-checklist.md`](./memory-system-phase1-backend-checklist.md)
- 后端主链路：[`backend-architecture-analysis.md`](./backend-architecture-analysis.md)
- Claude Code 能力借鉴：[`claude-code-capability-borrowing-roadmap.md`](./claude-code-capability-borrowing-roadmap.md)

如果只保留一句话作为后续开发锚点，请保留这一句：

> WebClaw 当前最正确的开发顺序，是保持 `runtime + session_events + event-first memory` 主链路稳定，只在需要时单独把 knowledge retrieval 接入，而不是继续扩张 memory 主链路。 
