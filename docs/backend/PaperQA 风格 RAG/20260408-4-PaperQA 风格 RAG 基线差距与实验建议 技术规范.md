# PaperQA 风格 RAG 基线差距与实验建议

更新日期：2026-04-08

## 1. 目标与范围

这份文档只回答 3 件事：

1. Lecquy 当前独立 RAG 基线到底是什么
2. 它和 Paper-QA / PaperQA2 在能力上差多少
3. 当前最值得做的 3 个实验方向是什么

当前明确边界：

- 只讨论独立 RAG 路线
- 不接 runtime 主链路
- 不混入 memory recall
- 不展开上下文压缩和心跳任务

## 2. 本轮文档源

### 2.1 Lecquy 仓库内实现

- `backend/src/rag/index.ts`
- `backend/src/rag/chunking.ts`
- `backend/src/rag/types.ts`
- `backend/src/db/knowledge-repository.ts`
- `backend/src/db/migrations/0004_init_knowledge_tables.sql`
- `backend/src/rag/*.test.ts`
- `backend/src/db/knowledge-repository.test.ts`
- `backend/src/dev/pg-acceptance-smoke.ts`
- `docs/backend/20260408-17-RAG Spike 边界 技术规范.md`

### 2.2 Paper-QA / PaperQA2 本地参考仓库

以后这条路线默认优先阅读本地参考仓库，不再优先依赖线上搜索。

本地仓库目录：

- `/Users/hqy/Documents/zxh/github/paper-qa`

本轮实际阅读并用于分析的源码入口：

- `/Users/hqy/Documents/zxh/github/paper-qa/README.md`
- `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/settings.py`
- `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/docs.py`
- `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/readers.py`
- `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/core.py`
- `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/prompts.py`
- `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/types.py`
- `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/agents/tools.py`
- `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/agents/search.py`

### 2.3 补充线上参考源

- FutureHouse 工程博客：<https://www.futurehouse.org/research-announcements/engineering-blog-journey-to-superhuman-performance-on-scientific-tasks>
- 旧版 Paper-QA PyPI 描述：
  - <https://pypi.org/project/paper-qa/1.6.0/>
  - <https://pypi.org/project/paper-qa/4.0.0/>

## 3. Lecquy 当前独立 RAG 基线

## 3.1 数据模型

当前独立知识库存储只有两张表：

- `knowledge_documents`
- `knowledge_chunks`

表结构特点：

- 只存文档与 chunk
- `knowledge_chunks` 只有 `content + metadata_json`
- 没有 `embedding`
- 没有 evidence 表
- 没有 answer / citation 落库结构

这和 20260408-17 的 RAG spike 边界一致，本质上还是一个 text-first spike。

## 3.2 ingest 基线

当前入口是：

```ts
ingestKnowledgeDocument(input): Promise<{ documentId: string; chunkCount: number }>
```

现状：

- 只接受已经准备好的 `title + content + metadata`
- 不负责真实文档解析
- PostgreSQL 未开启时只返回 `documentId/chunkCount`，不持久化
- PostgreSQL 开启后才插入 `knowledge_documents` 和 `knowledge_chunks`

这说明当前 ingestion 仍是“纯文本输入写库”，不是 PaperQA 风格的“文档解析 + 元数据增强 + chunk 建索引”链路。

## 3.3 chunk 基线

当前 chunk 策略来自 `splitKnowledgeText()`：

- 先做基础空白字符归一化
- 以空行分段
- 在 `maxChars=1000` 附近按段落拼接
- 超长段落再按换行、句号、空格做软切分
- 默认无 overlap
- 默认无 section / heading 感知
- 默认无页码、章节、句子级定位信息

每个 chunk 目前只补充两类 metadata：

- `chunk_chars`
- `chunk_strategy=paragraph_text_v1`

这是一种足够稳定的最小 chunk 方案，但它还不是面向检索效果优化的 chunk 方案。

## 3.4 retrieval 基线

当前入口是：

```ts
searchKnowledgeChunks({
  query,
  topK,
  sourceFilter,
})
```

当前检索行为：

- PostgreSQL 开启时才执行真实检索
- 先做 query 归一化和 `topK` 裁剪（默认 5，最大 20）
- 若安装 `pg_trgm`：
  - 使用 `similarity(lower(content), query)` 与 `similarity(lower(title), query)`
  - 同时叠加 `ts_rank(simple)` 做排序
- 若无 `pg_trgm`：
  - 回退到 `LIKE + ts_rank(simple)`
- 结果直接返回原始 chunk 文本和合并后的 metadata

这套检索的优点：

- 成本低
- 不需要 embedding
- PostgreSQL 内即可跑通最小实验

这套检索的局限：

- 只有单阶段检索，没有 candidate pool -> rerank 两段式
- 只有 text-first，没有 dense / hybrid / metadata-aware retrieval
- 没有 MMR 去重与多样性控制
- 没有 query expansion
- 没有 doc-level search，再下钻到 chunk
- 没有 evidence selection

## 3.5 当前已有验证

当前仓库对独立 RAG 做过的验证主要是：

- chunking 单测
- repository 单测
- PostgreSQL 下最小 ingest / search smoke

当前还没有：

- 固定问答集
- gold evidence 标注
- recall@k / MRR / nDCG 一类检索指标
- evidence precision 指标
- answer with citation 的人工或自动评测

所以现阶段 Lecquy 只有“骨架已通”，还没有“质量基线已立”。

## 4. 对照 Paper-QA / PaperQA2 的能力差距

## 4.1 总体判断

如果把 Lecquy 当前独立 RAG 放在 Paper-QA 演进线上看，它现在更接近：

- 已有最小 chunk 与最小 search 的 pre-Paper-QA 基线

它距离旧版 Paper-QA 的差距主要在：

- embedding retrieval
- passage summary
- evidence score / selection
- answer with citations

它距离 PaperQA2 的差距则更大，额外缺：

- Paper search / local paper index
- agentic query expansion
- metadata-aware retrieval
- deeper top-k candidate recall
- RCS（re-ranking + contextual summarization）
- evidence cutoff 和 final source budgeting
- citation traversal

## 4.2 分层对照

| 层 | Lecquy 当前 | 本地 `paper-qa` 代码表现 | 差距判断 |
|---|---|---|---|
| chunk | 段落优先、约 1000 chars、无 overlap、无结构感知 | `readers.py` 的 `read_doc()` 默认 `chunk_chars=5000`、`overlap=250`，并按文件类型走 `chunk_pdf / chunk_text / chunk_code_text`，chunk 名称里直接带页码区间或 chunk 序号 | Lecquy 还没有 overlap，也没有按文档类型选择 chunk 策略 |
| chunk metadata | 只有 `chunk_chars` 与 `chunk_strategy` | `types.py` 里有 `ChunkMetadata(size, overlap, name)`；`read_doc(include_metadata=True)` 会把 chunk 算法摘要挂到 `ParsedMetadata.chunk_metadata` 上 | Lecquy 的 chunk 元数据过弱，后续证据追踪空间不够 |
| ingest / parsing | 只接受外部传入的纯文本内容 | `docs.py` 的 `Docs.aadd()` 会先 peek 首个 chunk 生成 citation，再尝试从 citation 抽 `title/doi/authors`，再用 metadata client 升级文档信息，最后调用 `read_doc()` 真正解析和 chunk | Lecquy 当前还没有“文档解析 + 元数据增强”这层 |
| retrieval | PostgreSQL `pg_trgm + FTS(simple)` 单阶段检索 | `docs.py` 的 `retrieve_texts()` 先建立 embedding index，再走 `max_marginal_relevance_search(query, k, fetch_k=2*k)`；`settings.py` 还暴露了 `texts_index_mmr_lambda` | Lecquy 当前没有 dense retrieval，也没有 MMR 去重/多样性控制 |
| evidence selection | 没有单独层 | `docs.py` 的 `aget_evidence()` 对候选 chunk 逐个调用 `map_fxn_summary()`；`core.py` + `prompts.py` 明确要求输出 `{summary, relevance_score}`；`types.py` 的 `Context.score` 采用 `0-10` 标准 | Lecquy 当前完全没有 query-aware summary 和 relevance score |
| answer synthesis | 没有 | `settings.py` 中 `answer_max_sources=5`、`evidence_relevance_score_cutoff=1`；`context_serializer()` 先按 score 排序、再 cutoff、再截断；`qa_prompt` 要求句末带 citation keys | Lecquy 当前还没有 final evidence budgeting，也没有 citation-key 驱动回答 |
| agentic search | 没有 | `agents/tools.py` 把流程拆成 `gather_evidence` 和 `gen_answer` 工具；`agents/search.py` 里还有本地 paper search index | Lecquy 当前先不用追这个，但要知道 PaperQA2 的 retrieval 不只是一层 chunk search |

## 4.3 从本地源码里可直接提炼的点

### 4.3.1 PaperQA2 的 ingest 不是“写入纯文本”，而是“解析 -> 补元数据 -> chunk -> embed”

从 `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/docs.py` 可以直接看出，`Docs.aadd()` 做的事情明显比 Lecquy 当前 `ingestKnowledgeDocument()` 更重：

1. 先 `read_doc(... page_range=(1, 3))` peek 文档前几页
2. 用 `citation_prompt` 生成 citation
3. 用 `structured_citation_prompt` 从 citation 再抽 `title / doi / authors`
4. 用 metadata client 把 `Doc` 升级成更完整的 `DocDetails`
5. 再调用 `read_doc()` 做完整解析和 chunk
6. 最后在 `aadd_texts()` 中为 chunk 生成 embedding

这意味着 PaperQA2 从 ingest 阶段就把“文档身份”和“引用可追溯性”前置了，而 Lecquy 当前 ingest 还只是把外部传入的 `content` 切块后写库。

### 4.3.2 PaperQA2 的 chunk 不是单一路径，而是按文档类型分流

从 `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/readers.py` 可以看到：

- PDF / Office 文档走 `chunk_pdf()`
- 文本 / HTML 走 `chunk_text()`
- 代码类文本走 `chunk_code_text()`

其中几个关键差异：

- `chunk_pdf()` 维护页码范围，chunk 名称会变成类似 `docname pages 1-3`
- `chunk_text()` 不是按段落，而是按 token 近似切分，并带 overlap
- `chunk_code_text()` 则按行号语义切分代码

所以 PaperQA2 的 chunk 策略核心不是一个固定长度，而是“文档类型感知 + overlap + 可追溯命名”。

对 Lecquy 的直接启发是：

- 不要只围绕 `1000 chars` 调参
- 至少要先把 `overlap` 与 `文档内位置` 加回来
- 后续如果要接 PDF / markdown / code，chunk 策略应分型

### 4.3.3 PaperQA2 的 retrieval 是 dense + MMR，而不是 text-first 排序

从 `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/docs.py` 和 `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/settings.py` 可以直接确认：

- `aadd_texts()` 会为 chunk 计算 embedding
- `retrieve_texts()` 会建立 `texts_index`
- 检索调用是 `max_marginal_relevance_search()`
- 参数使用 `k=_k` 和 `fetch_k=2 * _k`
- `texts_index_mmr_lambda` 暴露为可调参数

这说明 PaperQA2 的候选生成默认就同时考虑：

- query 相似度
- 结果去重
- 结果多样性

而 Lecquy 当前 `searchKnowledgeChunks()` 只有单阶段 text-first 排序，既没有 dense recall，也没有 MMR。

### 4.3.4 PaperQA2 的 evidence selection 是一个明确的独立层

从 `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/docs.py` 的 `aget_evidence()`、`/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/core.py` 的 `map_fxn_summary()`、以及 `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/prompts.py` 的 `summary_json_system_prompt` 可以看得很清楚：

- 先检索 `evidence_k` 个候选 chunk
- 再对每个 chunk 生成 query-aware summary
- LLM 输出结构明确要求带 `summary` 和 `relevance_score`
- `Context.score` 在 `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/types.py` 中固定为 `0-10`
- 低分或失败的 context 会被过滤

这比“把 topK 原文 chunk 直接塞进 answer prompt”高出一个完整层级。

Lecquy 当前最大的结构性差距，不是 citation 样式，而是完全没有这一层。

### 4.3.5 PaperQA2 的 answer 不是消费原始 chunk，而是消费过滤后的 contexts

从 `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/settings.py` 的 `context_serializer()` 和 `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/prompts.py` 的 `qa_prompt` 可以确认：

- 进入 answer 的不是原始 chunk，而是 `Context`
- `Context` 先按 `score` 排序
- 再应用 `evidence_relevance_score_cutoff`
- 再截断到 `answer_max_sources`
- prompt 中使用的是 citation keys，而不是直接裸引用标题

默认参数也很值得注意：

- `evidence_k=10`
- `answer_max_sources=5`
- `evidence_relevance_score_cutoff=1`
- `max_concurrent_requests=4`

这套收口逻辑说明 PaperQA2 的核心不是“多塞点上下文”，而是“先让 evidence 足够多，再让最终 answer 使用足够少而精的 sources”。

### 4.3.6 PaperQA2 已经把 citation / traceability 纳入对象模型

从 `/Users/hqy/Documents/zxh/github/paper-qa/src/paperqa/types.py` 可以看到：

- `Text` 绑定 `Doc`
- `Context` 绑定 `Text`
- `PQASession` 保存 `contexts / references / formatted_answer`
- `populate_formatted_answers_and_bib_from_raw_answer()` 会把上下文 key 转成最终引用

也就是说，citation 不是最终模板拼接出来的装饰，而是从对象模型开始就是系统的一部分。

这对 Lecquy 的含义是：

- 如果后续要做 PaperQA 风格 answer synthesis，不能只靠 `title/source_uri/seq` 的松散 metadata
- 需要先有稳定的 evidence object，再谈 citation render

### 4.3.7 本地代码给当前优先级的直接结论

结合本地源码，当前优先级仍然很明确：

- 第一优先级是 retrieval recall
- 第二优先级是 evidence selection
- 第三优先级才是结构感知 chunk

原因不是抽象“最佳实践”，而是 PaperQA2 的代码就是按这个层次组织的：

1. 先把候选 chunk 找回来
2. 再把 chunk 变成有分数的 `Context`
3. 最后才把筛过的 `Context` 喂给 answer

因此 Lecquy 当前最不该做的，就是跳过 evidence 层，直接把现有 `searchKnowledgeChunks()` 接进 runtime 或回答链路。

## 5. 当前最值得做的 3 个实验方向

下面的 3 个实验，按当前性价比排序。

## 5.1 实验一：提升 retrieval recall，而不是继续停留在单阶段 text-first 排序

### 核心假设

当前 Lecquy 最大问题不是“chunk 已经选出来但排序差一点”，而是“真正有价值的 chunk 很可能根本没进候选池”。

如果候选池里没有正确 evidence，后续 answer / citation 都不会成立。

### 最小实验设计

先不要直接上大规模向量库扩展，先做独立实验层：

1. 保留当前 `pg_trgm + FTS` 作为 retriever A
2. 增加第二路候选生成，二选一即可：
   - 多 query text retrieval
   - 小规模 dense / hybrid retrieval spike
3. 把候选深度从当前常用 `topK=5` 提到 `20-30`
4. 在候选合并后做去重和简单多样性控制，尽量对齐 PaperQA2 `MMR + fetch_k=2*k` 的思路

### 建议观测指标

- recall@5 / recall@10 / recall@20
- gold evidence 首次命中排名
- 同文档重复 chunk 比例
- 候选池覆盖到的文档数

### 为什么它排第一

PaperQA2 的公开结论非常明确：

- 高精度 QA 的上限首先受 recall 约束
- RCS 只有在候选池里已经含有关键 chunk 时才有发挥空间

因此 Lecquy 的第一优先级不该是回答模板，而应该是 candidate recall。

## 5.2 实验二：补一层 PaperQA 风格的 evidence selection / RCS

### 核心假设

即使 retrieval 先不升级到完整 PaperQA2，只要让当前候选 chunk 先经过：

- relevance 打分
- contextual summary
- cutoff 过滤
- final source budgeting

就会显著优于“直接按搜索分数取 topK 原文 chunk”。

### 最小实验设计

对检索出来的前 `20-30` 个候选 chunk，逐个让 LLM 产出结构化结果，格式先尽量贴近 PaperQA2：

```json
{
  "summary": "...",
  "relevance_score": 0,
  "used_excerpt": "..."
}
```

然后：

1. 按 `relevance_score` 重排
2. 过滤掉低于 cutoff 的 chunk
3. 对最终 evidence 做预算控制
4. 默认只保留约 `5` 个 final evidence，和 PaperQA2 的 `answer_max_sources=5` 保持同量级

### 建议观测指标

- top20 候选进入 final evidence 的 precision
- final evidence 中可直接支持回答的比例
- evidence summary 相对原 chunk 的压缩比
- 最终 answer 的引用可追溯性

### 为什么它排第二

这一步是 Lecquy 距离 Paper-QA / PaperQA2 最大的结构性差距之一。

没有 evidence selection，就仍然是“搜索结果展示”；有了 evidence selection，才开始接近“证据驱动回答系统”。

## 5.3 实验三：做结构感知 chunk 实验，而不是只做 chunk size 调参

### 核心假设

当前 `paragraph_text_v1` 的主要问题不是“1000 chars 不够科学”，而是：

- chunk 边界没有 heading / section 语义
- 无 overlap，容易把关键句切散
- metadata 不足，后续 evidence traceability 很弱
- 缺少像 PaperQA2 `pages 1-3` 这种稳定的文档内定位

所以 chunk 实验的重点应该是“边界与元数据”，不是只改一个长度。

### 建议对比的 3 组 chunk 策略

1. `paragraph_text_v1`
2. `simple_overlap_v1`
3. `heading_or_section_aware_v1`

其中第三组至少补齐：

- heading / section 路径
- 邻接 chunk 关系
- 文档内位置
- 更稳定的 citation 元信息
- chunk 算法标识，类似 `ChunkMetadata`

### 建议观测指标

- gold evidence containment rate
- 平均 chunk 长度与重复率
- 单文档 chunk 数
- evidence summary 的可读性与可引用性

### 为什么它排第三

PaperQA2 的公开经验说明，chunk size 本身不是最优先杠杆。

但 Lecquy 当前 chunk 元数据过弱，已经开始限制：

- retrieval 可召回性
- evidence selection 的上下文判断
- 后续 citation traceability

所以 chunk 仍然该做，但应作为“结构实验”，而不是“长度炼丹”。

## 6. 当前不建议优先做的事

当前不建议排到前三的方向：

- 直接接 runtime 主链路
- 把 RAG 和 memory recall 混层
- 先做前端知识库 UI
- 先做复杂 citation 样式渲染
- 一上来就做大规模向量基础设施改造

原因很简单：

- 现在还没有独立质量基线
- 还没有证据层
- 还没有评估口径
- 现在接 runtime 只会把问题提前扩散

## 7. 建议的下一步顺序

建议按下面顺序推进：

1. 先补一个独立评测集
2. 做 retrieval recall 实验
3. 做 evidence selection / RCS 实验
4. 做结构感知 chunk 实验
5. 最后再讨论 answer synthesis 和 runtime integration

## 8. 本轮结论

一句话总结：

Lecquy 当前独立 RAG 已经有了最小 ingest、最小 chunk、最小 text-first search 和真实 PostgreSQL smoke，但它离 Paper-QA 的差距还主要停留在“没有证据层”，离 PaperQA2 的差距则集中在“召回不足 + 缺 RCS + 缺结构化证据组织”。

因此当前最值得做的 3 个实验方向是：

1. retrieval recall 提升
2. PaperQA 风格 evidence selection / RCS
3. 结构感知 chunk 策略

这 3 件事做完，再讨论 answer synthesis，才是合理顺序。
