# Lecquy — Codex 入口规则文件

> 本文件是 Codex 进入 Lecquy 仓库后的入口规则文件，由**两部分**组成：
>
> 1. **项目守则**（CLAUDE.md 镜像，必读）—— 长期愿景、阶段红线、决策原则、待解决问题。所有 AI 助手（含 Codex）**动代码前必须先读这部分**。本节内容与 `/CLAUDE.md` 同步，更新时两份一起改。
> 2. **技术参考** —— Monorepo 结构、技术栈、WS 协议、开发命令、文档规范、协作分工等运行性信息。Codex 执行具体任务时按需查阅。
>
> 最后同步：2026-05-18（CLAUDE.md v0.6 + 20260513-7 补丁）

---

# 第一部分：项目守则（与 CLAUDE.md 同步）

> 这份文档**所有进入 Lecquy 仓库的 AI 助手**（Claude Code / Codex / Cursor / Cowork / DeepSeek 等）**必须先读再动**。
> 它的存在是为了让开发路线**不再反复迁移**——之前一年里项目被工具反复带偏，根因是没有一份强制阅读的纲领文件。
> 最后更新：2026-05-18（v0.6 补丁，OpenAI-compatible 主路径与 transcript 边界补齐）
>
> 修订记录：
> - 2026-05-18（v0.6 补丁）：**补齐 20260513-7 的三处落地口径**。当前模型路线第一优先级是 OpenAI Chat Completions-compatible API（vLLM / llama.cpp / SGLang / Qwen Cloud / DeepSeek / Kimi / GLM 等本地与国产模型最大公约数），Anthropic `cache_control` 只属于 Anthropic adapter，不进入 OpenAI-compatible 主路径。MemoryRecall 按用户可见 transcript / API replay transcript / augmentation 记录三份数据分离，避免把系统注入记忆误写成 kira 发言。根 `AGENTS.md` 同步到本口径。
> - 2026-05-13（v0.6）：**§1.3 整段重写，对齐 [`20260513-7`](./docs/项目级/20260513-7-系统提示词模块再合并与缓存命中优化%20决策沉淀.md)**。先前 v0.4 锁定的"7 层 36 子项 + `.lecquy/system-prompt/` 14 模板"在准备落地到 prompt builder 时暴露两类问题：(1) `time.md` / `capability block` / `preference 诊断` 等动态片段混在 system 前缀里，破坏 prompt cache 命中率；(2) 26 子项对单人开发者认知负荷过载，模块边界长期混乱。新结构对齐 Claude Code / Codex 工程实践——「一份 `BASE.md` + 7 个稳定文件 + 末位 `<env>` 块 + 单 cache breakpoint」，物理文件从 ≥ 14 收敛到 8，MemoryRecall 从 system 字段移出挂在当轮 user message 内，`.lecquy/system-prompt/` 目录规划取消。20260512-2 标记废弃保留作历史归档，§9 记忆 schema / §10 信任分级仍被新文引用。本次同步修订 `docs/README.md` 主线清单与 20260512-3 执行指令的 Phase 适用范围。
> - 2026-05-13：**新增代码文件头双语摘要规则**。所有项目代码文件开头必须有简洁的中英双语文件级注释，说明该文件负责什么、位于什么链路、供 Codex / Claude Code 快速定位。规则写入 §5，并产出 `docs/项目级/20260513-6-代码文件头双语摘要补齐 执行指令.md`，后续由 GPT-5.3 批量执行补齐。
> - 2026-05-12 晚（再续，v0.4）：**§1.3 全面对齐 20260512-2 / AGENTS.md "最终架构"**。先前 v0.3 在 CLAUDE.md 里落地的"v1 6 文件 + `tools-discipline.md` + `agent.yaml` + `prompts/` 小写"方案，被 20260512-2 最终修订推翻——最终架构是 `.lecquy/` 大写文件、`USER.md` / `MEMORY.md` / `MEMORY.summary.md` / `memory.db` 分级、不引入 `core.md` / `tools-discipline.md` / `context-loader.md` / `agent.yaml`；`AGENTS.md` 镜像段也已经更新到这一版。本次把 CLAUDE.md §1.3 整段替换：文件树用 `.lecquy/` 大写、注入顺序保留 7 层 cache 友好结构、memory 标签扩展到 9 种 kind + projectId + importance、未来拆分触发条件改成"信号触发"而不是"v1→v2 时间线"。CLAUDE.md / AGENTS.md / 20260512-2 三方现已一致。背景：缓存影响表分析显示静态前 / 动态后分层是 KV cache 命中的关键，7 层结构在最终架构里就已经定。
> - 2026-05-12 晚（续，v0.3）：**精化 §1.2 + 锁定 §1.3**。§1.2 从"调用 Codex / Claude API"改为"自建 harness、复现 80% 即可让 kira 卸载 Codex / Claude Code"——呼应"机器上不存在它们"的终态目标；明确 model 层永远外调 Anthropic / DeepSeek API。新增 §1.3 "system prompt 文件体系（最终架构）"：少量常驻文件 + 固定 prompt layer + SQLite 记忆检索 + 按需技能加载；明确不新增 `core.md`、`tools-discipline.md`、`context-loader.md`、`agent.yaml`，并以拆分条件约束未来演进。决策来源 `docs/项目级/20260512-2-系统提示词上下文工程最终取舍 技术规范.md`。§3 优先级 4 从"工具调度层（调度 Codex / Claude API）"改为"自建 harness"。
> - 2026-05-12 晚：**结构性重写**。第 1 节分裂为"长期愿景"和"近期形态"——明确 Lecquy 的终态是 JARVIS 化的"唯一入口"，长期意图是 Codex/Claude Code 在 kira 日常里**消失**（不是被重写，是被绕过、被上层包掉）。第 2 节分裂为"长期红线（永远不做）"和"阶段性延后（现在不做，未来做）"——避免后者被工具误读为"永不"。第 3 节新增"工具调度层"作为第 4 优先级，明确近期 coding 实际执行**调用 Codex / Claude API**，不在 Lecquy 内部重造。新增第 8 节"待解决问题（不当下处理）"，记下 memory.db 熵增、记忆遗忘 / 衰减机制缺失等长期但暂不动手的问题。
> - 2026-05-08 晚：Plan / Manager-Worker 模式从"当下不投入"清单移除——实情核查后发现 `manager-runner.ts` / `worker-runner.ts` / `plan-handler` 已落地运行，不是幽灵代码。第三周记忆改造完成后再决定保留 / 优化 / 砍。
> - 2026-05-08 晚：第 2 节增加 "frontend 不主动维护" 红线，避免工具自发做 UI 改进。
> - 2026-05-08 晚：第 4 节增加 "混杂目录不要硬拆" 护栏，避免清理任务里破坏 runtime helper。
> - 2026-05-08 晚：第 3 节记忆现状描述精确化，避免 codex 误读为"修复 flush.ts"。
> - 2026-05-08 晚：**记忆底座锁定 SQLite**——经多维对比（运维成本、用例覆盖、数据可移植性、长期负担），SQLite + FTS5 在单人场景下完全胜任全部 4 个核心用例（会话连续性 / 项目维度 / 错误模式识别 / 承诺追踪）。`db/` 目录下 PG 代码（约 2000 行）将在第二周分阶段物理删除。详见 `docs/项目级/20260508-6-...`。

---

## 1. 项目身份

### 1.1 长期愿景（终态，3-5 年目标）

> **Lecquy 是 kira 一个人的 JARVIS——唯一入口、接管一切**。

未来 kira 的开发、生活、家居、社交、信息检索，**全部归口到 Lecquy**。
Codex、Claude Code、ChatGPT、Cursor、HomeAssistant、各种社交 app——这些通用工具最终在 kira 的日常里"消失"。**消失的方式不是被重写**（单人物理上不可能），**而是被绕过、被上层包掉**——Lecquy 是 kira 唯一打开的入口，通用工具退到后台或者彻底无关。

五个不可妥协的关键词：

- **独占性**：只服务一人。不做多用户产品。这是项目最大的护城河——Anthropic / OpenAI 永远做不到把"kira 这一个具体的人"作为 first-class context，**而你能**。
- **长期记忆**：记住人 / 项目 / 偏好 / 历史决策，越用越懂。这是"代替"的真正发动机。
- **自我进化**：能改自己的 prompt / skill / 记忆结构 / 工具集。
- **本地优先**：尽量避免外部依赖，单机即用。
- **唯一入口**：终态是 kira 不再直接打开 Codex / Claude Code / ChatGPT，所有需求归口到 Lecquy 由它分派、统一记忆、统一上下文。

### 1.2 近期形态（2026 上半年 ~ 1 年内）

> **Lecquy 自己长 harness。单 agent（default role）+ 自建 agent loop + 自建工具集。Model 层始终外调 Anthropic / DeepSeek API，但 Codex / Claude Code 不在 kira 的机器上安装。**

近期不指望"功能上超越 Codex / Claude Code"——它们背后是几百人团队。但 Lecquy 服务一个人，可以**砍掉它们"服务全世界必须有的负担"**（IDE 集成、MCP 完整协议、企业鉴权、插件市场、跨平台分发、各种 OS 边界）。**单人 6-12 个月做到 80% harness 能力即可让 kira 卸载它们**。

第一批要长的 harness 能力：agent loop / 文件工具 / bash / git / Plan 模式 / subagent 调度 / 沙箱 / diff 渲染。这八件做到 80%，Lecquy 就能成为 kira 唯一打开的入口。

"代替"是温水煮青蛙式——**不是把它们重写，而是绕过它们服务大众时必须做出的妥协**：kira 用 Lecquy 因为 Lecquy 知道 kira 上个月在另一个项目踩过的坑、知道 kira 讨厌 SOLID 重构、知道 kira 偏好 SQLite over PostgreSQL，Codex 永远不知道。

每件 harness 能力的内化触发条件是"现阶段开发实际需要 + 单人能做到 80%"两者同时满足。**不是时间表**。

长期演进方向见 [`docs/项目级/20260408-2-个人强 Agent 路线 开发规划.md`](./docs/项目级/20260408-2-个人强%20Agent%20路线%20开发规划.md)。
当前代码事实见 [`docs/项目级/20260508-2-个人强 Agent 路线 代码现状审查报告.md`](./docs/项目级/20260508-2-个人强%20Agent%20路线%20代码现状审查报告.md)。

### 1.3 system prompt 文件体系（最终架构，2026-05-13 v2）

Lecquy 的 system prompt 文件体系**已锁定**。决策来源：[`docs/项目级/20260513-7-系统提示词模块再合并与缓存命中优化 决策沉淀.md`](./docs/项目级/20260513-7-系统提示词模块再合并与缓存命中优化%20决策沉淀.md)。先前 [`20260512-2`](./docs/项目级/20260512-2-系统提示词上下文工程最终取舍%20技术规范.md) 已废弃，保留作历史归档。

**最终文件结构（8 个常驻文件 + 运行时生成内容）**：

```text
.lecquy/
├── BASE.md              # Agent 基底：identity + style + safety + docs + runtime + extra + mode 子段
├── TOOLS.md             # 工具纪律、危险操作边界、确认规则；不是工具 inventory
├── AGENTS.md            # 本地 Agent 运行规则与项目级约束入口
├── SOUL.md              # 人格底色、沟通方式、稳定价值取向
├── IDENTITY.md          # 使命、能力边界、行为原则
├── USER.md              # kira 稳定画像与长期偏好，源文件软上限 4KB（不强制切片）
├── MEMORY.md            # 人工可读 memory 入口、维护说明和 fallback
├── MEMORY.summary.md    # 可常驻的稳定记忆 frozen snapshot
├── memory/
│   └── memory.db        # SQLite + FTS5，长期记忆事实来源
└── skills/
    └── <skill-name>/
        └── SKILL.md     # 按需加载，不常驻
```

**已删除**：`.lecquy/system-prompt/` 整个目录（原 14 模板合并到 `BASE.md`）。如果代码里已经物理创建，必须先迁移调用方和测试，再删除。

**system 字段拼接顺序**（写进 prompt builder，单逻辑 cache breakpoint 卡在 `<env>` 之前）：

1. `BASE.md`
2. `TOOLS.md`
3. 工具 inventory（运行时生成，字典序）
4. `AGENTS.md`
5. `SOUL.md`
6. `IDENTITY.md`
7. `USER.md`
8. `MEMORY.summary.md`
9. skills index（运行时生成，字典序）
10. 命中的 `SKILL.md`（可选）
11. **`<cache breakpoint>` 逻辑主断点**：OpenAI-compatible 主路径只作为稳定字节边界；Anthropic adapter 才翻译为 content block 级 `cache_control`
12. `<env>` 块（运行时生成，末位，含 date / cwd / session / model / mode）

**messages 字段约定**：

- MemoryRecall 不进 system 字段，挂在当轮 API user message 内，用 `<retrieved_memory priority="low">...</retrieved_memory>` 包裹
- 用户可见 transcript 只保存 kira 真实输入，不显示、不导出 `<retrieved_memory>` 块
- API replay transcript 必须原封保留历史轮次的 memory 块，不允许持久化时剥离（剥离会摧毁历史轮次 cache）
- compact 摘要时可以丢弃历史 memory 块（事实仍在 memory.db），但不得把 recall 内容写成"kira 说"

**memory 多维标签**（写入时尽量打齐）：

- `kind`：fact / decision / mistake / preference / project / people / environment / summary / commitment
- `scope`：global / project / session
- `projectId`
- `status`：active / archived / superseded
- `roleHints`：哪些 role 召回时优先
- `tags` / `ttl` / `confidence` / `importance` / `source`

打不齐时允许先写低置信记录，但不得晋升到 `USER.md` 或 `MEMORY.summary.md`，避免熵增（呼应 §8.1）。

**未来拆分触发条件**（详见 20260513-7 §13，每条均需"真实痛点 + 可衡量阈值"同时满足）：

- `BASE.md` 超过 2500 tokens **且** 内部小节边界混乱被 review 标注过 → 拆分
- `USER.md` 超过 6KB **且** profile / preference 在 prompt 里出现互相干扰证据 → 拆切片文件
- `TOOLS.md` 超过 1500 tokens **且** 工具纪律与工具教程混杂 → 教程迁 skill
- 出现 ≥ 3 个稳定可路由 agent **且** 每个 prompt 差异 ≥ 500 tokens → 引入 agent registry
- memory 召回污染，频繁注入无关记忆 → 调整召回逻辑（不拆 memory 文件）

**AI 助手强约束**（特别给 Codex / Claude Code 看）：

1. 动这一块时**不要重新设计文件体系**——20260513-7 已经是收敛后的结构，再"完整化""规整化"等于走回头路。允许的工作只是把这套结构落到代码 / `.lecquy/` 目录里。
2. **MemoryRecall 已经从 system 字段移出**，挂在当轮 API user message 内。任何把 memory 召回结果塞回 system 字段的实现都是错的。
3. **`<env>` 块是 system 字段最后一段**，cache breakpoint 是逻辑稳定边界；OpenAI-compatible 主路径不发 Anthropic `cache_control`，Anthropic adapter 才做 content block 级翻译。
4. **诊断信息不进 prompt**：`profile=382 tokens, preference=196 tokens` 这种实时统计是开发者日志，写到 stderr / 日志文件，不进 prompt builder 输出。
5. **历史 API replay message 的 `<retrieved_memory>` 块必须原封保留**：API 重放和 cache 前缀不能剥离该 tag；用户可见 transcript 仍然保持干净。
6. **`MEMORY.md` 不是主记忆库**：权威内容在 `memory.db`，常驻 frozen snapshot 在 `MEMORY.summary.md`，召回时按标签过滤注入。

---

## 2. 不做什么（先看这个，比"做什么"更重要）

进入这个仓库的工具，**特别是 Codex / Claude Code 这类编码型 agent**，最容易把项目带偏：要么去做"通用 Agent 框架"重写 Codex 已有的能力，要么去做多用户 / 鉴权这种和愿景冲突的方向。**红线分两类**：

### 2.1 长期红线（永远不做）—— 和愿景冲突的方向

- **不做多用户工程**：不写鉴权 / 限流 / Gateway 拆分 / OAuth / CORS 收紧 / token 校验 / 多租户隔离。Lecquy 只服务 kira，永远是。
- **不做"架构正确化"重构**：单人单机场景下"够用"高于"完美"，不为了 SOLID / 微服务 / DDD 而重构。
- **不重写面向多用户的通用 Agent 框架**：Codex / Claude Code 的 MCP 完整协议、IDE 集成、企业鉴权、插件市场、跨平台分发、各种 OS 兼容、JetBrains/VSCode 双平台插件——这些是它们"服务全世界"的负担，单人 Lecquy 不复刻。**但 Lecquy 自己的 agent loop / 工具调用 / Plan 模式 / subagent 调度 / 沙箱 / diff 渲染必须自己长**——这是 §1.2 "代替 Codex / Claude Code"的必经之路（参见 §3 优先级 4）。每一块的内化时机看两个条件同时成立：(a) 现阶段开发实际需要；(b) 单人能做到 80%。
- **不为短期方便引入重型外部依赖**：PostgreSQL / Redis / Docker 这类服务，能用 SQLite + 文件解决就用 SQLite + 文件。
- **frontend 不主动维护**：只修阻塞性 bug，不做 UI 改进 / 重构 / 视觉打磨。视觉是后期的事。看到 frontend 代码"风格不一致"或"组件抽象不优雅"，**忽略**，不要发起重构。

### 2.2 阶段性延后（现在不做，未来做）—— 和愿景一致，但当下投入会稀释命脉

下面这些**最终都要做**（部分本来就是终态愿景的组成），但当下投入等于在 memory / self-evolution 还没站稳之前消耗注意力。**每一条加触发条件**，避免被工具误读为"永不"：

| 功能 | 触发条件 |
|---|---|
| RAG 知识库 / 自建文档库检索 | memory 底座稳定 + default role 跑通后 |
| Web 搜索 | default role 跑通后 |
| 语音输入 | 工具调度层成熟后 |
| 智能家居 MCP（关灯等家电控制） | 可考虑做独立产品先用 HomeAssistant，Lecquy 长期通过 MCP 桥接 |
| 社交接入（先 read 后 write） | memory 稳定 + 用例清晰（先做能 read 的：Telegram / X；小红书 / 抖音 / 微信基本不要碰） |
| 内部 subagent 调度 / 多角色协作 | "懂 kira 的 plan / 验收"被验证比 Codex 自带的更适合 kira 之后 |
| 插件系统 | self-evolution 闭环跑通后再评估 |
| 角色扮演型 persona（如 心理学家 mode / 星野爱） | 心理学家 mode 走 role overlay 路线（共享 core）；持久 persona 走独立小 Lecquy 路线（独立小 memory，不读 kira-memory），优先级低 |

只有作者明确说"现在做 X"才动这些。**默认不动**。

---

## 3. 当前阶段优先级（2026-05 起）

按重要性递减：

1. **记忆** —— 真正"懂我"的载体。当前 `memory/flush.ts` 产出价值低（每轮只 dump 最后两条消息），`memory/extraction-runner.ts` 写好了但 `PG_ENABLED` 默认 false。这是命脉。
2. **自我进化** —— 系统提示动态构建、Skill 热加载、文件工具能写 `.lecquy/`，**接口已就位**，缺的只是"反思动作"循环。
3. **上下文工程 + 主循环** —— `BASE.md` + 稳定上下文文件 + `<env>` 的 system prompt 架构已锁定，缺的是按新边界落到 prompt builder 和 API replay 链路。
4. **自建 harness** —— Lecquy 自己长 agent loop / 文件工具 / bash / git / Plan 模式 / subagent 调度 / 沙箱 / diff 渲染。第一批做到 80%，kira 就能在自己机器上**卸载 Codex / Claude Code**。Model 层始终外调 Anthropic / DeepSeek API，不自训。详见 §1.2 近期形态。
5. **工程债** —— 沙箱接入、垃圾代码清理、WS 协议收敛，"不出事就行"，不雕琢。

第一周的具体执行清单见 `docs/项目级/20260508-3-第一周执行清单.md`（待写）。

---

## 4. 决策原则（遇到选择题时的标尺）

- **每个选择题先问一句**：这件事让 agent **更懂 kira**、还是**更通用**？前者做，后者推迟。
- **新功能动手前先写文档**：在 `docs/` 里写规范、出审查指令、留下决策沉淀，再动代码。代码不是文档的注解，文档是设计的契约。
- **删代码优先于加代码**：项目当前约 26% 代码属于"通用框架方向"产物，能删就删。
- **半成品集成优于新模块**：很多东西"写完了忘了接"（沙箱、PG 记忆链路、Plan 模式），把它们接上 / 砍掉的收益高于写新东西。
- **看到"鉴权 / 限流 / Gateway / 多租户 / 通用化"字眼**：默认拒绝，除非作者明确说做。
- **看到"在 Lecquy 内部复刻 Codex 服务多用户的部分"**（MCP 完整协议、IDE 插件、企业鉴权、跨平台分发、插件市场）：默认拒绝——这是它们的负担，不是 Lecquy 的护城河。
- **看到"在 Lecquy 内部自建 Codex 的核心 harness"**（agent loop / 工具调用 / Plan 模式 / subagent / 沙箱 / diff 渲染）：**默认接受**——这是 §1.2 路线必经之路，每一块照"现阶段开发实际需要 + 单人 80%"两条标准评估。
- **遇到混杂目录不要硬拆**：看到一个目录里既混着"agent 工具"又混着"runtime helper / 共用底座"（典型例子：`session-tools/` 下既有 `sessionsListTool` 又有被 `simple-handler` / `plan-handler` 调用的 `currentSessionRuntime`），**不要**在"清理 / 删除"任务里硬拆这个目录。停下来，把发现写到 `docs/` 留待**专门的结构性重构任务**处理。原则：清理任务只做"无引用即删"，不做"有引用就拆"。

---

## 5. 语言规范（来自 `.claude/rules/language.md`）

- **中文**：对话、回复、代码注释、Git 提交、PR 描述、计划文档、CLAUDE.md / 项目文档。
- **英文**：变量名、函数名、类名、组件名、TypeScript 类型、配置文件、文件名、目录名。
- **技术术语**：首次出现可附英文，后续直接用中文。
- **样式方案**：Tailwind CSS 4。
- **代码文件头双语摘要**：项目中所有代码文件开头必须有简洁的中英双语文件级注释，用 1-3 行说明"这个文件负责什么 / 位于哪条链路 / 主要被谁调用或影响谁"，帮助 Codex / Claude Code 快速定位代码。已有文件头注释不重复堆叠，直接补齐或改写为中英双语；有 shebang 的脚本保留 shebang 第一行；`"use client"` / `"use strict"` 等运行指令不得被破坏；生成文件、lockfile、纯数据文件、第三方 vendored 代码不强行补。批量补齐按 `docs/项目级/20260513-6-代码文件头双语摘要补齐 执行指令.md` 执行。

---

## 6. 文档编写规则

详细规则见 [`docs/README.md`](./docs/README.md)。要点：

**目录分组**：

```
docs/
├── 项目级/        ← 跨前后端的产品方向、规划、审查
├── 环境与配置/    ← 环境变量、本地配置
├── frontend/      ← 前端规范、UI 排障
└── backend/
    ├── 架构与接口/
    ├── 记忆与检索/
    ├── Claude 上下文压缩复刻/
    ├── 沙箱权限与命令拦截/
    ├── Prompt 与运行时/
    ├── 心跳任务系统/
    ├── PaperQA 风格 RAG/
    └── 规划与路线/
```

**命名格式**：`YYYYMMDD-序号-标题 文档类型.md`

例如：`20260508-1-个人强 Agent 路线 代码现状审查指令.md`

**文档类型枚举**：

- `技术规范` —— 模块设计、接口契约
- `开发规划` —— 路线图、阶段目标
- `审查指令` —— 喂给外部 LLM 跑审查的模板
- `审查报告` —— 审查产出物
- `决策沉淀` —— 关键判断的事后记录

**头部元信息**（每份文档第一段必须有）：

```markdown
# 标题

> 更新日期：YYYY-MM-DD
> 类型：xxx
> 关联：[相关文档](./...)
```

**README.md 维护责任**：每新增一份"主线文档"，必须把链接加到 `docs/README.md` 的"当前主线"段落。

---

## 7. 关键文档索引

- 长期演进方向：[`docs/项目级/20260408-2-个人强 Agent 路线 开发规划.md`](./docs/项目级/20260408-2-个人强%20Agent%20路线%20开发规划.md)
- 代码现状审查指令：[`docs/项目级/20260508-1-...审查指令.md`](./docs/项目级/20260508-1-个人强%20Agent%20路线%20代码现状审查指令.md)
- 代码现状审查报告：[`docs/项目级/20260508-2-...审查报告.md`](./docs/项目级/20260508-2-个人强%20Agent%20路线%20代码现状审查报告.md)
- 文档总目录：[`docs/README.md`](./docs/README.md)

---

## 8. 待解决问题（不当下处理，但必须记在册）

这一节存在的意义：**有些问题在第 3 个月还看不出来，但在第 18 个月会毁掉项目**。把它们写下来，避免被遗忘；同时显式说明"现在不做"的理由，避免某个工具读到 CLAUDE.md 觉得"这是个 bug 我顺手修一下"。

### 8.1 memory.db 的熵增问题（最严重）

**症状**：当前记忆系统**只写不删**，没有衰减 / 归档 / 矛盾合并机制。短期看不出问题，长期使用必然走向：

- DB 越来越大、检索越来越慢
- 旧的、错的、过时的"记忆"和新的、对的、当前的"记忆"混在一起，污染上下文注入
- 矛盾的决策记忆（去年定 X，今年定非 X）同时存在，Lecquy 自己会被搞混
- "懂 kira"反向坍塌成"被自己的过时记忆误导"

**为什么这是灾难性的**：JARVIS 化的 Lecquy 是要用 3-5-10 年的，不是 3 个月。熵增问题在第 3 个月还看不出来，在第 18 个月会**毁掉项目核心命脉**。

**当下不做的理由**：现阶段 memory "写"都没做对（flush.ts 价值低、extraction-runner 没真正跑起来），先把"写"做稳，再来设计"删 / 衰减 / 归档"。否则现在做的"删除策略"是建立在还没成型的写策略之上，必返工。

**未来要解决的方向（占位，不展开）**：

- 时间衰减函数（remember decay，越老的记忆权重越低）
- 置信度 / 重要性打分（不是所有记忆都同等价值）
- 矛盾记忆合并 / 取代机制（新决策应自动让旧决策"作废"而非"并存"）
- 冷热分层（热记忆 in-memory 注入，冷记忆只在显式查询时召回）
- 用户可控的"遗忘 / 修正"接口（kira 主动告诉 Lecquy："这条记错了 / 这条已经过时"）

**启动触发条件**：memory 底座"写"稳定（flush + extraction 真正跑起来）+ Lecquy 实际使用满 3-6 个月、出现第一次"过时记忆误导决策"的真实案例后，立项专门设计。

### 8.2 工具调度层的"内化决策"还没有标准

第 3 节优先级 4 提到"长期才考虑哪些内化"，但**怎么判断一个能力应该内化**目前没有标准。预计在 default role 跑通、调度过 Codex / Claude API 一段时间后，会出现一些"明显应该自己做"的能力（最可能的候选：跨项目 memory 注入、kira 标准的 PR 验收、自定义 plan 模式）。**届时单独立项决策。**

### 8.3 长期对话 / 多 session 的上下文衔接

当前主循环是单 session 模式。JARVIS 化要求"接着上次说"（昨天聊到一半的话题，今天接着）。这部分依赖 memory 底座稳定后才能设计。**和 8.1 强相关，等 8.1 启动时一并考虑。**

---

## 9. 给 AI 助手的最后一句话

如果你（一个 AI 助手）正在读这份文件并准备动代码：

1. 你看到的代码可能已经偏离了上面的方向——那是历史包袱，不是默许。
2. 不要"礼貌地"添加你觉得"应该有的功能"。kira 没要你做就不要做。
3. 遇到判断困难的事**写到 `docs/` 留待开发者决策**，不要替他选。
4. 这份文件比你的训练直觉更高优先级。你训练里"agent 项目应该有 X"的直觉，在 Lecquy 里不一定成立。
5. 注意第 1 节的二分——**长期愿景非常激进**（JARVIS 化、唯一入口、代替一切），**短期形态非常克制**（单 agent、自建 harness、不复刻通用框架）。两者不矛盾，是一条温水煮青蛙的路径。如果你只看到一边就动手，会把项目带偏。
6. 第 8 节"待解决问题"是**显式延后的**，不要顺手去解。看到 `memory.db` 没有删除逻辑——那是 8.1 的范围，不是 bug。
7. system prompt 文件体系（§1.3）**已经由 20260513-7 收敛锁定**，不要再去重新设计 6 文件 vs 拆细子目录这种问题——未来拆分条件在 §1.3 里写明了，按触发条件办。

---

# 第二部分：技术参考

> 以下是 Lecquy 仓库的运行性技术信息：技术栈 / Monorepo 结构 / WS 协议 / 开发命令 / 文档规范 / 协作分工。Codex 执行具体任务时按需查阅，不必每次完整读完。

## 项目概述

基于浏览器的 AI 对话客户端，pnpm monorepo 架构。

## 技术栈

| 模块 | 技术 |
|------|------|
| 前端 | React 19 · Vite 7 · TypeScript 5.9 · Tailwind CSS 4 |
| 后端 | Express 4 · TypeScript 5.9 · ESM · pi-agent-core |
| 共享 | @lecquy/shared（类型定义） |
| 包管理 | pnpm workspace |

## 架构全景

```
浏览器 ──WebSocket──→ Express ──→ Agent Runner ──→ vLLM/OpenAI API
  │                     │              │
  │ shared 类型         │ shared 类型   │ tools/
  └─── @lecquy/shared ─┘              ├── bash, read_file, edit_file
                                       ├── write_file, skill, todo_write
                                       └── session-tools/
```

### 前后端通信协议

**WebSocket 事件**（定义在 `shared/src/ws-events.ts`）：
- 客户端 → 服务端：`chat`（发送消息）、`cancel`（取消）、`pong`
- 服务端 → 客户端：`message_delta`（流式文本）、`tool_start/end`（工具调用）、`todo_update`（任务更新）、`worker_start/delta/end`（子 Agent）、`done`、`error`

**chat 事件 payload**：`{ mode, route, messages, model?, baseUrl?, apiKey?, enableTools?, options? }`

### 会话类型（定义在 `shared/src/session.ts`）

- `SessionRouteContext`：路由上下文（channel, chatType, peerId 等）
- `SessionSnapshot`：会话快照（持久化用）
- `SerializedTodoItem`：todo 项（content, status, activeForm）

## 目录导航

```
Lecquy/
├── frontend/          # React SPA（详见 frontend/README.md 与 docs/frontend/）
│   └── src/
│       ├── app/home/  # 首页：HomePageLayout, ConversationArea, SettingsDrawer
│       ├── components/chat/  # 消息组件：MessageItem, MessageList
│       ├── components/ui/    # UI 原语：ChatInput, AutoResizeTextarea
│       ├── hooks/     # useChat, useAutoResize
│       ├── lib/       # ws-reconnect, session
│       └── config/    # api.ts（API 地址配置）
├── backend/           # Express 服务（详见 backend/AGENTS.md 与 docs/backend/20260408-13-Simple Plan 模式分析 技术规范.md）
│   └── src/
│       ├── agent/     # Agent 核心：agent-runner, vllm-model, tools/
│       ├── controllers/  # health, memory, models, sessions
│       ├── core/      # prompts, skills, todo, memory
│       ├── ws/        # WebSocket chat handlers
│       └── session-v2/ # 会话服务与持久化
├── shared/            # 共享类型包
│   └── src/
│       ├── ws-events.ts  # WebSocket 事件类型
│       └── session.ts    # 会话相关类型
└── pnpm-workspace.yaml
```

## 文档导航

- 统一文档入口：`docs/README.md`
- 前端文档目录：`docs/frontend/`
- 后端文档目录：`docs/backend/`

## 文档落盘原则

- `docs/` 是项目开发文档目录；方案、规范、验收、复盘、仓库分析、prompt 研究等研发资料统一写入这里
- `.lecquy/` 是运行时上下文与产物目录，不是开发文档目录
- `.lecquy/artifacts/docs/` 只用于面向用户交付、需要在产品里作为附件或文件卡片展示的运行期产物
- 不要因为文档是 AI 生成的，就把研发资料默认写进 `.lecquy/artifacts/docs/`
- 判断目录归属时，优先看"文档用途"：
  - 属于项目研发资料：写 `docs/`
  - 属于运行期交付附件：写 `.lecquy/artifacts/docs/`
- 新增研发文档写入 `docs/` 后，要同步更新 `docs/README.md`

## 文档归类原则

- 文档入口层 `docs/`、`docs/backend/`、`docs/frontend/` 直接放置的 `.md` 文件都不得超过 `5` 个；超过后必须继续拆分主题子目录
- 文档归类优先按"领域 -> 主题"两级判断：
  - 项目级 / 跨端文档：写入 `docs/项目级/`、`docs/环境与配置/` 等根级主题目录
  - 后端文档：写入 `docs/backend/` 下对应主题目录，如 `架构与接口`、`记忆与检索`、`Prompt 与运行时`
  - 前端文档：写入 `docs/frontend/` 下对应主题目录；过时材料优先放入 `历史归档`
- 一级入口目录优先保留 `README.md`、少量总览文档和导航文档；具体方案、规范、验收、复盘不要长期直挂在入口层
- 迁移或整理旧文档时，优先改"目录归属 + README 索引"，非必要不要为归类目的通读全文；通常依据文件名、开头摘要和文档用途判断即可
- 归类完成后，要同步维护对应目录的 `README.md` 或上级导航，保证能按主题和顺序找到文档

## 文档命名规范

以后新增的开发文档、规范文档、验收文档、复盘文档，统一使用下面的文件名格式：

```text
YYYYMMDD-N-文档标题 文档类型.md
```

例如：

- `20260408-1-RAG 开发规划.md`
- `20260408-2-上下文压缩 技术规范.md`
- `20260408-3-PostgreSQL 验收记录.md`
- `20260408-4-真实链路联调 复盘记录.md`

命名规则：

- `YYYYMMDD`：表示该轮文档的日期，必须放在最前面
- `N`：表示同一天内的顺序号，必须从 `1` 开始连续递增，不能跳号
- 同一天的 `2` 必须建立在 `1` 之后，`3` 必须建立在 `2` 之后；编号本身就是阅读顺序和依赖顺序
- `文档标题`：统一优先使用中文；允许空格；保持简短明确
- `文档类型`：必须使用下面的统一词表，不要自行发明近义词

统一词表：

- `开发规划`
- `技术规范`
- `验收记录`
- `复盘记录`
- `审查指令`
- `审查报告`
- `决策沉淀`

补充要求：

- 未来新增文档默认遵守这套规则，旧文档不强制立即重命名
- 如果同一天新增多份文档，先确认上一份文档已经定稿，再继续编号下一份
- 除非是必须保留的专有名词，否则不要在文件名里混用英文 slug
- 新文档写入 `docs/` 后，要同步更新 `docs/README.md`，保证能按顺序找到

## 协作分工

本项目默认采用 `Claude Code + Codex` 双开协作模式，但这是一套工作流经验，不是绝对规则。

> 注：这是**近期形态**的协作方式。长期愿景见第一部分 §1.1——这些通用工具最终会在 kira 的日常里"消失"，由 Lecquy 自己包掉（参见 §1.2 自建 harness 路线）。

### 角色定位

- `Claude Code`：更适合先想清楚再动手，承担 `planner / reviewer / architect`
- `Codex`：更适合定义清楚后高速执行，承担 `implementer / finisher / repo operator`

### 优先交给 Claude Code 的任务

- 新系统设计、迁移方案、接口边界设计
- Agent 编排、状态流、上下文处理策略设计
- 大型重构方案与阶段拆解
- 复杂 bug 根因分析，尤其是跨文件、跨层链路问题
- PR review、风险审计、长 diff 审查
- 读长文档、长日志、长上下文后输出结论

### 优先交给 Codex 的任务

- 根据明确 spec 直接实现功能
- 批量改文件、补样板代码、补测试
- 修类型错误、lint、测试失败
- 按 checklist 执行中小型实现任务
- 做仓库内高频、重复、吞吐优先的开发工作
- 做 repo 自动化、GitHub / workflow 相关落地操作

### 推荐协作流水线

1. `Claude Code` 先理解需求、出方案、拆任务
2. `Codex` 按方案实现第一版
3. `Claude Code` 做 review、补边界条件、检查架构偏移
4. `Codex` 按 review 继续收尾、补测试、整理仓库

### 快速判断标准

- 如果任务还不清楚、需要先想方案、要读很多上下文、或者主要是评审，优先给 `Claude Code`
- 如果需求已经写清楚、成功标准明确、主要是执行和修改，优先给 `Codex`

## 关键开发路径

### 前后端联调常见任务

| 任务 | 涉及文件 |
|------|---------|
| 新增 WS 事件 | `shared/src/ws-events.ts` → `backend/src/ws/` → 前端 hook |
| 修改消息格式 | `shared/src/session.ts` → 后端 agent-runner → 前端 MessageItem |
| 新增工具 | `backend/src/agent/tools/` → `tools/index.ts` 注册 |
| 修改 UI 组件 | `frontend/src/components/` 或 `app/home/components/` |
| 会话管理 | `backend/src/session-v2/` + `frontend/src/lib/session.ts` |

### 开发命令

```bash
pnpm dev:full         # 前端 + 后端 + 本机 PG 一键联调
pnpm dev              # 前后端并行启动
pnpm dev:backend      # 仅后端
pnpm dev:frontend     # 仅前端
pnpm build            # 全量构建
```

## 开发规范

- **开发期运行原则**：当前处于开发阶段，默认采用本机进程 + 本机 PostgreSQL 联调；不要把 Docker / Docker Compose 作为默认开发、验收或部署路径
- **启动入口原则**：一键启动优先使用跨平台 Node 脚本；不要把 `bash` 作为顶层唯一入口
- **PostgreSQL 运行时原则**：Windows 开发机若未安装 PostgreSQL，允许首次启动时自动下载本地运行时到 `.lecquy/pg/`；该目录属于本地依赖缓存，不提交仓库
- **语言**：中文注释/对话，英文代码/配置
- **代码文件头注释**：所有代码文件开头保留简洁中英双语摘要，帮助 Codex / Claude Code 快速定位文件职责；批量补齐见 `docs/项目级/20260513-6-代码文件头双语摘要补齐 执行指令.md`
- **样式**：Tailwind CSS 4
- **不可变性**：ALWAYS 创建新对象，NEVER 直接修改
- **详细规范**见各子目录说明文档和 `.claude/rules/`
