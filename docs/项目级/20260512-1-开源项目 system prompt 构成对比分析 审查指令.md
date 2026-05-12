# 开源项目 system prompt 构成对比分析 审查指令

> 更新日期：2026-05-12
> 类型：审查指令（喂给 Codex 执行）
> 关联：
> - [`/CLAUDE.md`](../../CLAUDE.md) — Lecquy 项目守则（必读，尤其 §1 / §2 / §3 / §8）
> - [`/AGENTS.md`](../../AGENTS.md) — Codex 入口文件，第一部分是 CLAUDE.md 镜像
> - [`20260508-5-人格基线 USER SOUL MEMORY 撰写指引.md`](./20260508-5-人格基线%20USER%20SOUL%20MEMORY%20撰写指引.md) — Lecquy 第一版人格基线撰写指引

---

## 0. 给 Codex 的执行约束（先看这里）

读这份指令前，**先读 `/AGENTS.md` 第一部分（CLAUDE.md 镜像）**，确认你理解 Lecquy 的两条核心：

1. **长期愿景**：Lecquy 是 kira 一个人的 JARVIS，是唯一入口；Codex / Claude Code 最终在 kira 日常里**消失**（不是被重写，是被 Lecquy 自己长出的 harness 绕过 / 包掉）。
2. **近期形态**：单 agent + 工具调度；当前正在设计自己的 system prompt 文件体系，需要参考开源项目的实证做法。

本次任务的产出是**一份审查报告**，**不是代码改动**。不要修改任何 Lecquy 仓库内的代码或 prompt，只输出分析报告。

任务边界（不做以下事情，否则违反 CLAUDE.md §2.1）：

- 不要建议 Lecquy 引入鉴权 / OAuth / 多租户 / 插件市场 / MCP 完整协议
- 不要建议 frontend 重构或 UI 改进
- 不要建议在 Lecquy 内部复刻 Codex / Claude Code 的"通用框架"部分（IDE 集成、跨平台分发、企业能力等）
- 不要分析被审项目的 runner / tool dispatch / subagent runtime 等执行层代码，**只看 prompt 类产物**

时间预算建议：5 个项目共 4-6 小时。

---

## 1. 背景与目的

Lecquy 正在设计自己的 system prompt 文件体系，初步候选 6 个模块（详见 [`/AGENTS.md` 第一部分 §1](../../AGENTS.md)）：

| 文件 / 库 | 候选定位 | 初判范围 |
|---|---|---|
| `soul.md` | 实体性格底色（"我是谁"） | global |
| `identity.md` | 实体职能定位（"我做什么"） | global |
| `user.md` | kira 是谁 / 偏好 / 红线 | global |
| `memory.db` | 长期记忆 + 召回 | 存储 global / 召回 per-agent |
| `role.md` | 当前 agent 的具体使命 | per-agent |
| `tools.md` | 工具白名单 + 用法纪律 | per-agent |

**待决的 5 个设计问题**（这次审查要给出实证建议）：

1. **soul / identity 是否合并成 `core.md`**：单人项目里两份纯人格类文档是不是过细？
2. **`user.md` 是单文件 + role 过滤注入，还是物理拆分（`user-tech.md` / `user-personal.md` / `user-preferences.md`）**？
3. **memory 是否需要按 category tag 分类**，召回时按 role 过滤？
4. **tools 纪律部分（"修改前先 read"、"git commit 用中文"）是否从 tools.md 独立成 `tools-discipline.md`**，避免每个新 role 复制一遍？
5. **`agents.md` 是否需要存在**？还是 agent 索引靠目录结构就够？

请用 5 个开源项目的实际做法来回答这 5 个问题，**不要凭直觉答**。

---

## 2. 分析范围

只分析以下 5 个本地路径下的项目，**只看 system prompt 相关产物**（system message / instruction file / agent definition / persona definition / 行为约束文档），**不分析其工具实现代码**：

| 项目 | 本地路径 | 性质 |
|---|---|---|
| hermes-agent | `/Users/hqy/Documents/zxh/github/hermes-agent` | 自我进化型 agent 框架 |
| Kuberwastaken-src | `/Users/hqy/Documents/zxh/github/Kuberwastaken-src` | 逆向工程的 Claude Code 源码 |
| openclaw | `/Users/hqy/Documents/zxh/github/openclaw` | 开源 Claude Code-like 工具 |
| opencode | `/Users/hqy/Documents/zxh/github/opencode` | 开源 coding agent（sst/opencode 系） |
| system-prompts-and-models-of-ai-tools | `/Users/hqy/Documents/zxh/github/system-prompts-and-models-of-ai-tools` | 公开 system prompt 合集（Cursor / v0 / Claude Code / Windsurf 等） |

**入口定位策略**：先用 `rg` / `fd` 在每个仓库 grep 下列关键词，定位到 prompt 文件，再读：

```
"system prompt"   "SYSTEM_PROMPT"   "systemPrompt"   "system_prompt"
"You are"   "you are"               "Identity"        "identity"
"Persona"   "persona"               "Role"            "role"
"Instructions" "instructions"       "AGENTS.md"      "CLAUDE.md"
".cursorrules"  ".windsurfrules"    "AGENT.md"
```

辅助 glob：`**/*.md`、`**/prompts/**`、`**/system/**`、`**/agent/**`。

如果某个项目根本没有结构化的 system prompt（纯散落在代码里），**如实记录"该项目 prompt 散落在代码 X / Y / Z 处，未做结构化"**，不要硬凑结构。

---

## 3. 单项目分析框架（每个项目都要回答的 6 个问题）

对 5 个项目逐个展开下面 6 个问题。**每个项目独立一节**，便于横向对照。

### Q1. 入口在哪里？

- 列出该项目 system prompt 的**所有源文件路径**（相对项目根，必须完整路径，便于回查）
- 区分类型：markdown 文档 / 代码内字符串字面量 / 模板文件（如 jinja / handlebars）/ 多份文件组合
- 是否有"用户级 override"机制（类似 CLAUDE.md / AGENTS.md / `.cursorrules`）？文件名是什么、放在哪一级目录？

### Q2. 组成部分有哪些？

把 system prompt **解构成命名模块**。参考分类（不强制套用，发现新模块就如实命名）：

- **identity / persona**（你是谁）
- **role / mission**（你做什么）
- **environment**（运行环境信息：OS / cwd / git 状态 / 时间）
- **user profile**（用户是谁、偏好、红线）
- **tool inventory**（工具清单 / 白名单）
- **tool usage discipline**（工具用法规范、调用纪律）
- **code style / output rules**（输出格式、回复风格）
- **examples / few-shot**（示例对话或代码）
- **memory / history**（动态注入的长期记忆或会话历史）
- **safety / refusals**（安全边界、拒绝模板）

对每个识别出的模块，**用 1-2 句话概括内容主旨**。

### Q3. 组成顺序是什么？

给一个**顺序列表**，从 system prompt 拼接的**最前面到最后面**，按模块编号：

```
1. <模块名> — <一句话说明>
2. <模块名> — ...
...
```

然后**用 2-3 句话解释顺序背后的设计意图**：哪些模块在前因为优先级最高（容易被模型"记住"）？哪些在后因为是 fallback / 例外处理？是否有"动态部分包夹静态部分"的结构？

### Q4. 哪些是静态、哪些是动态？

把 §Q2 的每个模块标三档之一：

- **静态**（编译进二进制 / 写死在源码字符串里，最终用户改不了）
- **半动态**（用户可通过配置文件 / 项目级 override 文件追加或覆盖，例如 CLAUDE.md / `.cursorrules`）
- **完全动态**（每次调用根据当前会话状态生成：当前打开文件列表、git 状态、最近错误、注入的记忆等）

如果同一模块有静态 + 动态混合（例如"工具清单的描述是静态，但启用哪些工具是动态决定"），如实拆开说明。

### Q5. 设计意图是什么？

每个项目的核心设计哲学是什么？例如：

- Claude Code 重视"安全 + 工具调用规范"
- Cursor 重视"代码上下文密集注入"
- hermes-agent 重视"自我进化 + 反思循环"
- v0 重视"输出格式硬约束（特定 JSX 风格）"

如果项目本身有 README / DESIGN / paper 说明这个，**引用原文 + 标注出处**。否则从 prompt 结构反推，明确写"以下为反推结论，非项目原文"。

### Q6. 引用核心片段

每个项目摘 **200-500 字最具代表性的 prompt 片段**，用代码块原样贴出（保留英文原文，不要翻译）。
便于 kira 直接读到原文判断风格。

---

## 4. 跨项目对比表

完成单项目分析后，做一张横向对比表。每行一个维度，每列一个项目，单元格内容简短即可（Y / N / 简短描述）：

| 维度 | hermes | Kuberwastaken | openclaw | opencode | system-prompts 合集 |
|---|---|---|---|---|---|
| 是否有独立 identity / persona 模块 | | | | | |
| 是否有独立 role / mission 模块 | | | | | |
| identity 和 role 是否合并 | | | | | |
| 是否有 user profile 模块 | | | | | |
| user profile 是否分场景过滤注入 | | | | | |
| 工具用法规范是否独立于工具白名单 | | | | | |
| 是否注入长期 memory（跨会话） | | | | | |
| 注入的 memory 是否分 category tag | | | | | |
| 是否支持用户级 override 文件（CLAUDE.md 类） | | | | | |
| 是否有"all agents 索引"文件 | | | | | |
| 静态 / 动态比例（粗估） | | | | | |
| 拼接顺序的共性模式（如先 identity 后 tool） | | | | | |

表后用 200-400 字总结**共性 + 差异**：5 个项目里哪些做法明显是行业标准（4-5 个都这么做）？哪些是少数派但有亮点？

---

## 5. 映射到 Lecquy 的 5 个待决问题

针对 §1 的 5 个待决问题，**每个问题给出基于开源项目的实证建议**。结构：

### 5.1 soul / identity 是合并成 `core.md` 还是保留两份？

- **5 个项目里有几个把"人格"和"职能"合并？合并的怎么命名？**
- **保留两份的边界是怎么划的？**
- **结论**（给 kira 的具体建议）：合并 / 保留 / 看情况，理由是什么，来源项目是哪个

### 5.2 `user.md` 单文件 + role 过滤 vs 物理拆分？

- **有项目维护 user profile 吗？如何组织？**
- **是否有按场景过滤注入的机制？怎么实现的（系统消息切换 / 元数据筛选 / role 配置）？**
- **结论**

### 5.3 memory 是否打 category tag、按 role 召回？

- **注入 memory 的项目里，有谁对记忆做分类？分类粒度多细？**
- **召回时是否根据当前 agent / role 过滤？**
- **结论**

### 5.4 tools 纪律是否从 tools.md 独立成 `tools-discipline.md`？

- **5 个项目里，工具用法纪律和工具白名单是写在一起还是分开？**
- **如果分开，怎么分？文件名是什么？**
- **结论**

### 5.5 `agents.md` 是否需要存在？

- **有项目维护一个"all agents index"文件吗？还是靠目录结构（如 `.agents/<name>/role.md`）？**
- **结论**：Lecquy 是否需要 `agents.md`

每条结论**必须有项目引用**（"参考 X 项目 Y 文件的做法"），不要凭直觉。

---

## 6. 借鉴 / 不借鉴清单

最后产出两份清单，**这是给 kira 的最终行动产物**。

### 6.1 建议借鉴

列出 **5-10 条具体的、可执行的借鉴点**，每条格式：

```
- [借鉴点]
  - 来源：<项目名 / 文件路径>
  - 落到 Lecquy 哪个模块：soul.md / role.md / tools.md / 召回逻辑 / 其他
  - 借鉴理由：（一段话，明确说为什么这条对单人 JARVIS 路线有价值）
```

### 6.2 明确不借鉴

列出 **3-7 条 Lecquy 不应借鉴的设计**，每条格式：

```
- [不借鉴点]
  - 来源：<项目名 / 文件路径>
  - 不借鉴理由：（明确对应 CLAUDE.md §2.1 哪条红线，或者明确说"这条服务大众的复杂度，单人不需要"）
```

通常不借鉴的理由会是：

- 服务多用户的复杂度（多租户 prompt 切换、企业鉴权类）
- 通用框架性（MCP 完整协议、IDE 集成、插件市场）
- 和"懂 kira"无关的输出格式约束（如 v0 的 JSX 强约束）
- 和 CLAUDE.md §2.1 长期红线冲突

---

## 7. 输出要求

### 7.1 输出文件

**单一文件**：`docs/项目级/20260512-2-开源项目 system prompt 构成对比分析 审查报告.md`

如果发现单文件超过 1500 行，拆分成主报告 + 附录（附录放每个项目的 Q6 大段引用），主报告控制在 800-1200 行。

### 7.2 文件头部元信息（必须有）

```markdown
# 开源项目 system prompt 构成对比分析 审查报告

> 更新日期：2026-05-12（或实际完成日期）
> 类型：审查报告
> 关联：
> - [本次审查指令](./20260512-1-开源项目 system prompt 构成对比分析 审查指令.md)
> - [CLAUDE.md](../../CLAUDE.md)
> - [AGENTS.md](../../AGENTS.md)
> 执行者：Codex
> 总耗时：约 X 小时
```

### 7.3 报告章节结构

```
1. 执行摘要（500 字以内，给"没时间读全文"的 kira）
2. 各项目分析
   2.1 hermes-agent（Q1-Q6）
   2.2 Kuberwastaken-src（Q1-Q6）
   2.3 openclaw（Q1-Q6）
   2.4 opencode（Q1-Q6）
   2.5 system-prompts-and-models-of-ai-tools（Q1-Q6，对该仓库内每个子项目做简版分析）
3. 跨项目对比表（§4）
4. Lecquy 5 个待决问题的实证建议（§5）
5. 借鉴清单（§6.1）
6. 不借鉴清单（§6.2）
7. 附录：原文引用集（如果主体太长拆出来）
```

### 7.4 严禁的事

- **不要修改任何 Lecquy 仓库内的代码或配置**
- **不要修改任何被审项目的代码**
- **不要建议 Lecquy 引入鉴权 / OAuth / 多租户 / 通用 MCP 协议 / 插件市场**
- **不要建议 Lecquy frontend 重构**
- **不要分析被审项目的执行层代码（runner、tool dispatch、subagent runtime），只看 prompt**
- **不要把"Lecquy 应该做 X 通用能力"作为结论**——Lecquy 的护城河是"懂 kira"，不是通用能力
- **不要因为某个项目代码很复杂就推荐复刻**——记住 CLAUDE.md §2.1："不重写面向多用户的通用 Agent 框架"

---

## 8. 工作方法建议

### 8.1 每个项目预算

| 项目 | 预算 |
|---|---|
| hermes-agent | 60-90 分钟（要看自我进化机制怎么写进 prompt） |
| Kuberwastaken-src | 45-60 分钟（已是 Claude Code 反编译，结构应该最清晰） |
| openclaw | 30-45 分钟（参考 Claude Code，但看其简化幅度） |
| opencode | 30-45 分钟 |
| system-prompts 合集 | 60-90 分钟（合集很大，挑 3-5 个最有代表性的子项目分析即可，如 Cursor / v0 / Claude Code / Windsurf） |

### 8.2 不要做的事

- 不要试图通读全项目代码——只 grep / find 定位 prompt 文件，精读它们
- 不要把工具实现代码当成 prompt 来分析——只看"喂给模型的字符串"
- 不要担心"这个项目我不熟悉"——你要做的是结构分析，不是功能复刻

### 8.3 推荐工具链

```bash
# 在每个项目根目录跑
rg -l "system.*prompt|SYSTEM_PROMPT|systemPrompt" --type-not lock
rg -l "You are " --type md --type ts --type js --type py
fd -e md -e txt -e json . | xargs rg -l "identity\|persona\|role"
```

### 8.4 边读边记

建议每读完一个项目就立刻写完它的章节，不要等 5 个全读完再写。**理由**：prompt 类内容读多了会串味儿，时间一长记不清是哪个项目的设计。

---

## 9. 完成后的下一步（由 kira 执行，Codex 不动）

审查报告交付后，kira 会：

1. 阅读报告，重点看 §4 对比表 + §5 五个问题结论 + §6 借鉴清单
2. 拍板 §1 列的 5 个待决问题
3. 把决策落入 `docs/项目级/20260512-N-Agent 设置面板与 per-agent / global 分层 决策沉淀.md`（具体 N 由 kira 当时编号）
4. 必要时回头修订 CLAUDE.md / AGENTS.md

**Codex 完成审查报告后停止，不要主动建议下一步代码改动，等 kira 决策。**

---

## 10. 检查清单（交付前 Codex 自查）

提交报告前，逐条勾选：

- [ ] 5 个项目全部覆盖，没有遗漏
- [ ] 每个项目都回答了 Q1-Q6 六个问题
- [ ] §4 对比表 12 行维度都填了，没有空格
- [ ] §5 五个问题每个都给了结论 + 项目引用
- [ ] §6.1 至少 5 条借鉴点
- [ ] §6.2 至少 3 条不借鉴点
- [ ] 没有任何"建议 Lecquy 做通用 X"类结论
- [ ] 没有修改 Lecquy 仓库或被审项目的任何文件
- [ ] 文件头部元信息齐全
- [ ] 文件名严格遵守 `20260512-2-...审查报告.md` 格式
- [ ] 完成后同步把链接加入 `docs/README.md` 当前主线段落
