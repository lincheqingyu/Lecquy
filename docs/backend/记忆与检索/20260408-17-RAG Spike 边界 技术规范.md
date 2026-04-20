# RAG Spike 边界规范

更新日期：2026-04-07

## 1. 定位

当前 RAG 的定位固定为：

- 只做 spike
- 不进入主线交付
- 不抢记忆系统和 compact 的带宽

这份文档的目标不是让本周实现完整 RAG，而是冻结边界，避免后面把 memory 和 RAG 混成一套。

## 2. 目标与非目标

当前 RAG spike 已进入第二阶段，除了冻结边界，还允许做到“后端内部可实验”。

这两周内，RAG spike 只需要回答四件事：

- chunk 策略怎么切
- metadata 至少存什么
- retrieval 接口长什么样
- 它和 memory recall 怎么并列存在

当前明确不做：

- 完整 ingestion pipeline
- 前端知识库管理 UI
- reranker
- citation 系统
- 多格式导入
- 文档权限系统

## 3. 数据建模选择

一期 spike 不复用 `memory_items` 作为主知识库存储。

数据模型固定预留为：

- `knowledge_documents`
- `knowledge_chunks`

原因：

- `memory_items` 承载的是会话记忆与 agent 运行记忆
- RAG 处理的是外部知识文档
- 两者生命周期、去重规则、更新频率不同

最小表结构建议：

### `knowledge_documents`

- `id`
- `source_type`
- `source_uri`
- `title`
- `metadata_json`
- `created_at`
- `updated_at`

### `knowledge_chunks`

- `id`
- `document_id`
- `seq`
- `content`
- `metadata_json`
- `created_at`

当前仓库实现里：

- 不创建 `embedding` 列
- 不做向量检索
- 只做 text-first 检索实验

## 4. 最小接口建议

这两周内只需要冻结接口，并允许做最小 text-first 实验检索，不要求实现完整产品链路。

最小接口建议：

```ts
ingestKnowledgeDocument(input): Promise<{ documentId: string; chunkCount: number }>
searchKnowledgeChunks(query): Promise<KnowledgeChunkHit[]>
```

最小查询输入：

```ts
{
  query: string
  topK?: number
  sourceFilter?: string[]
}
```

最小查询输出：

```ts
{
  chunkId: string
  documentId: string
  content: string
  score: number
  metadata: Record<string, unknown>
}
```

## 5. 与 Memory 系统的边界

当前边界固定如下：

- memory recall 解决“这个会话和这个用户之前发生过什么”
- RAG 解决“外部文档里有什么知识”

一期不要：

- 把外部文档 chunk 直接写进 `memory_items`
- 用同一套 `kind` 去混排会话记忆和知识块
- 让 `TodoManager` 或 compact 直接依赖 RAG 表

后续如果需要并列召回，顺序固定为：

1. memory recall
2. knowledge recall
3. current user input

但这一步现在只冻结原则，不要求实现。

## 5.1 当前实验范围

当前允许的实验能力：

- 最小纯文本 chunk 策略
- PostgreSQL `pg_trgm + FTS(simple)` 检索
- repository / `rag/index.ts` 内部调用

当前仍然明确不做：

- 接入 runtime
- 接入 memory recall
- 接入 ws / 前端
- embedding / vector search

## 6. 当前未实现

这部分当前状态：

- `knowledge_documents / knowledge_chunks` 已落表设计
- `rag/index.ts` 已存在
- 已有最小 chunk 策略
- 已有 text-first knowledge retrieval repository
- 已在真实 PostgreSQL 环境下完成最小 ingest / search smoke
- 仍未完成接入 runtime 前的更完整端到端验收

## 7. Spike 验收标准

这两周内，RAG spike 达到下面标准就算完成：

1. 已确定不复用 `memory_items` 作为知识库存储
2. 已冻结最小表结构
3. 已冻结最小 ingestion / retrieval 接口
4. 已实现可实验的 text-first 检索
5. 已明确它和 memory recall 的边界
6. 已在真实 PostgreSQL 上完成一轮最小 ingest / search 验证

如果这些问题没有全部回答清楚，就不要把 RAG 接进主链路。
