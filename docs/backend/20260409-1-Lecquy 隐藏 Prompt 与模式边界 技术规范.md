# Lecquy 隐藏 Prompt 与模式边界

更新日期：2026-04-10

## 1. 目标

本文档用于冻结 Lecquy 下一阶段的隐藏 prompt、模式角色、执行器、skill、memory 与权限边界。

目标不是复刻 Claude Code、Codex 或 Augment 的原始文案，而是吸收它们在以下方面的工程经验：

- 分层清晰
- 共享前缀稳定
- 执行边界明确
- 工具调用低歧义
- 对中文 Agent Web 产品友好

本文档是后续 prompt 重构、runtime 注入、skill manifest、mode 契约和字节级稳定性测试的正式基线。

## 2. 产品定位与总体结论

Lecquy 的默认产品定位不是“编程助手”或“终端助手”，而是：

- `simple`：通用任务执行代理
- `plan`：计划工作流代理

Lecquy 的核心执行模型不是“默认依赖终端”，而是：

- 以 OS 自适应执行器作为底座
- 以结构化 tools 作为主执行面
- 以 skill 作为受约束的增强层

执行器默认策略：

- Windows：首选 `PowerShell`
- Linux：首选 shell

语言策略固定为：

- 规则英文
- 风格中文

Lecquy 的隐藏 prompt 不再把所有项目/用户/记忆信息拼成一个混杂的大字符串，而是拆成唯一的 7 层真源，并在 OpenAI/Qwen3.5 兼容协议下映射为“单条 `systemPrompt` + 动态消息段”。

## 3. 唯一分层真源

### 3.1 7 层真源表

| # | 层 | 载体 | 优先级与覆盖 | 稳定性 | 语言 | prefix cache |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `system` | 运行时硬编码 system 规则 | 最高；不可被任何下层覆盖 | 常驻不变 | 英文 | 是 |
| 2 | `mode` | `simple` / `plan` 模式契约 | 仅 `system` 可覆盖 | 整个会话不变 | 英文 | 是 |
| 3 | `startup context` | `SOUL`、`IDENTITY`、`USER.profile_slice`、`MEMORY.summary`，以及固定首部 `<CAPABILITY>` block | 不可覆盖 `system / mode` | 会话级稳定 | 中文为主；`<CAPABILITY>` 为英文 | 是 |
| 4 | `skill runtime` | 命中后加载的单个 skill 正文 | 不可覆盖 1-3 层 | 命中后至模式切换前稳定 | 英文规则 + 中文示例 | 是 |
| 5 | `user preference` | `USER.preference_slice` | 仅影响风格与粒度，不构成执行规则 | 会话级稳定 | 中文 | 是 |
| 6 | `memory recall` | query 检索结果 | 仅补充事实，不构成规则 | 每回合动态 | 原文语言 | 否 |
| 7 | `live turn` | 当前用户消息、assistant 回复、tool 轨迹 | 当前回合最低层事实 | 每回合动态 | 用户语言 | 否 |

### 3.2 硬规则

- 注入顺序 = 优先级顺序。
- `1-5` 构成稳定前缀段，用于最大化 prefix cache 命中。
- `6-7` 构成动态段，允许每回合变化。
- 下层永远不能改写上层规则，只能在既有边界内补充事实、风格或上下文。
- 通用“结果 / 验证 / 下一步”答复结构属于 `system` 层，不再在 `mode` 中重复定义。
- `mode` 只描述与 `system` 的差异，不重复通用规则。

## 4. 逻辑分层与物理请求结构

### 4.1 目标协议

在 OpenAI Chat Completions 兼容格式下，Lecquy 的目标请求结构固定为：

- 单条 `systemPrompt`
- 内部通过 `<LAYER:...>` 标签分段
- 动态块只出现在 `messages[1..]`

这是一条**规范级**约束，不是示例级建议。

### 4.2 单条 `systemPrompt` 结构

`systemPrompt` 内部逻辑顺序固定为：

1. `<LAYER:system>`
2. `<LAYER:mode>`
3. `<LAYER:startup>`
4. `<LAYER:skill>`
5. `<LAYER:user_preference>`

动态消息段固定为：

6. `<LAYER:memory_recall>`
7. `<LAYER:live_turn>`

### 4.3 字节级硬规则

以下内容属于字节契约：

- `<LAYER:system> / <LAYER:mode> / <LAYER:startup> / <LAYER:skill> / <LAYER:user_preference>` 的标签名称
- 上述标签的顺序
- 层与层之间的换行数量
- 每层内部固定子标签名称

任何变更都必须：

- 走文档变更流程
- 更新序列化逻辑
- 补字节稳定性单元测试

### 4.4 动态块禁止进入 `systemPrompt`

`memory_recall` 与 `live_turn` 严禁进入 `systemPrompt`。

它们必须落在 `messages[1..]` 的 user 轮次动态消息段内；若实现将两者拼入 `systemPrompt`，即视为实现缺陷。

### 4.5 当前运行时映射

当前 Lecquy runtime 的目标映射固定为：

- 层 `1-5` 序列化为单条 `systemPrompt`
- 层 `6` 作为动态 recall 块进入上下文消息
- 层 `7` 继续走普通 `user / assistant / tool` 轨迹

## 5. `system` 与 system managed rules

`system` 层负责：

- 角色总定义
- 安全边界
- 权限三档
- 工具总原则
- 验证原则
- skill 加载总原则
- 通用答复结构

以下内容属于 `system managed rules`，不再作为 startup context 文件参与：

- `AGENTS.md`
- `TOOLS.md`

它们在逻辑上归属于 `system`，由运行时硬编码或受控注入维护，不归类为用户或项目上下文。

## 6. `startup context` 与 capability block

### 6.1 固定组成

`startup context` 固定包含：

- `.lecquy/SOUL.md`
- `.lecquy/IDENTITY.md`
- `.lecquy/USER.md` 解析出的 `profile_slice`
- `.lecquy/MEMORY.summary.md`
- 固定首部的 `<CAPABILITY>` block

说明：

- `<CAPABILITY>` block 逻辑上属于 `system`
- 物理上注入在 `<LAYER:startup>` 的固定首部
- 它不是 startup context 的业务内容，而是 runtime 注入的环境声明

### 6.2 `<CAPABILITY>` block 契约

字段固定为：

- `executor = powershell | shell | none`
- `available = [...]`
- `unavailable = [...]`

典型 `unavailable` 示例：

- `no_browser`
- `no_external_api`
- `no_deploy`

`<CAPABILITY>` block 只在能力集合变化时重写，不因普通会话轮次而变化。

### 6.3 分项预算

startup 段预算固定如下：

| 项 | 预算 |
| --- | --- |
| `SOUL + IDENTITY` | 合计 ≤ `500 tokens` |
| `USER.profile_slice` | ≤ `400 tokens` |
| `MEMORY.summary` | `200-400 tokens` |
| `<CAPABILITY>` block | ≤ `200 tokens` |
| 总上限 | ≤ `1.5k tokens` |

### 6.4 超预算处理

超预算时：

- 不做智能摘要
- 不做模型重写
- 只允许按固定顺序截断

保留优先级固定为：

1. `<CAPABILITY>`
2. `SOUL`
3. `IDENTITY`
4. `USER.profile_slice`
5. `MEMORY.summary`

实现上按上述保留优先级，从低优先级块开始截断尾部，直到总量回到预算内。

## 7. 模式契约

### 7.1 `simple`

定位：

- 通用任务执行代理

风格：

- 默认短答
- 关键执行前允许 1 句 preamble
- 关键阶段允许短进度同步

执行规则：

- 不自动切到 `plan`
- 如果任务明显更适合 `plan`，先做初步分析，再建议切换
- 用户拒绝切换时，继续在 `simple` 中尽力完成，但不展开长计划

### 7.2 `plan`

定位：

- 计划工作流代理

风格：

- 允许显示 todo 摘要
- 最终答复沿用 `system` 的通用结构

后端与前端口径固定为：

> 后端事件流默认完整暴露 todo（`todo_updated` / `pause_requested` / `pause_resolved`），前端默认折叠为摘要面板、可展开查看完整列表。

### 7.3 manager / worker 授权与回执协议

`plan` 模式下的协议固定为：

- 授权载体：`current_todo_id + todo snapshot`
- `manager` 只持有只读工具 + `todo_write`
- `manager` 不持有执行型副作用工具
- `worker` 不持有 `todo_write`
- `worker` 单次生命周期只处理 1 个 todo
- `worker` 无权越权继续下一 todo

`worker` 回执结构固定为：

```ts
{
  result: string
  validation: string
  next_hint: string
}
```

失败与重试规则固定为：

- `worker` 连续失败 2 次必须回交 `manager`
- `manager` 只能做：
  - `complete`
  - `retry-with-change`
  - `split`
  - `block`

`manager` 不得直接执行带副作用操作；所有带副作用动作都必须通过授权 `worker` 执行。

### 7.4 worker 上下文隔离

`worker` 启动时仅可见：

- 层 `1-5` 的稳定前缀
- `current_todo_id`
- `todo snapshot`
- 由 `manager` 折叠进 todo 正文的必要事实

`worker` 不得直接读取：

- `manager` 与用户之间的历史对话窗口
- 与当前 todo 无关的 plan 历史轨迹

这条规则同时服务于：

- 权限隔离
- 模式边界
- prefix cache 命中率

## 8. 权限三档与 preamble 规则

### 8.1 三档模型

Lecquy 统一使用以下三档权限模型：

| 档位 | 范围 | 默认策略 |
| --- | --- | --- |
| `auto` | 只读命令、workspace 内新建与追加、workspace 内读取 | 直接执行 |
| `preamble` | 跨多文件编辑、长耗时命令、workspace 内覆盖写 | 执行前发 1 句 preamble，不等待确认 |
| `confirm` | workspace 外写、带副作用系统命令、安装依赖、部署、外部状态修改 | 必须显式确认 |

### 8.2 `simple` 规则

`simple` 模式沿用完整三档模型。

### 8.3 `plan.manager` 规则

`plan.manager` 默认只有 `auto` 档能力：

- 只读
- `todo_write`

`plan.manager` 不持有 `preamble / confirm` 档能力；任何副作用动作都必须通过授权 `worker` 执行。

### 8.4 `plan.worker` 规则

`plan.worker` 沿用同一三档模型，但：

- `confirm` 档必须回交 `manager`
- 由 `manager` 统一向用户求证
- `worker` 不直接向用户请求副作用确认

### 8.5 preamble 纪律

preamble 属于 `system` 约束。

硬规则：

- 只对规定动作触发
- 长度 ≤ 1 句
- 不扩展为解释段落

## 9. Skill 体系边界

### 9.1 定位

skill 是插件型增强层，不是一等执行器，也不是默认主能力层。

skill 的作用是：

- 提供专业知识
- 提供领域流程
- 提供任务攻略

skill 不能：

- 新增一等工具
- 绕过 `system`
- 覆盖 `mode`
- 修改权限三档
- 定义通用答复结构

### 9.2 发现与选择

skill 使用 manifest-first 模式。

启动期只暴露存在性索引；真正命中后，再加载单个 skill 正文。

选择规则固定为：

- 同一会话最多常驻 1 个 skill
- 多命中时按 `specificity` 选择最具体者

### 9.3 注入位置与常驻规则

skill 正文固定处于第 4 层：

- 位于 `startup context` 之后
- 位于 `user preference` 之前

命中后：

- 常驻在稳定前缀段内
- 直到模式切换或显式卸载才移除

禁止按回合反复注入 / 撤出 skill 正文。

### 9.4 静态约束

manifest / load 阶段必须执行静态拒绝。

拒绝内容包括但不限于：

- 覆盖 `system`
- 覆盖 `mode`
- 跳过确认
- 绕过验证
- 修改通用答复结构

### 9.5 字节稳定性

skill 正文一旦命中，在当前常驻期内字节不可变。

若 skill 文件在磁盘上发生变化：

- 仅对下一次模式切换后的会话生效
- 当前会话继续沿用已加载版本

### 9.6 baseline 豁免

以下能力属于 baseline，不走 skill manifest 流程：

- `docx`
- `pdf`
- `xlsx`
- `pptx`

## 10. `USER.md` 协议

### 10.1 强契约格式

`USER.md` 是单一物理文件，必须满足：

- frontmatter 包含 `schema: lecquy.user/v1`
- 固定两个二级标题：
  - `## profile`
  - `## preference`

推荐骨架：

```markdown
---
schema: lecquy.user/v1
updated_at: 2026-04-10
---

## profile

- 身份: ...
- 领域: ...
- 长期目标: ...

## preference

- 语气: ...
- 解释粒度: ...
- 术语口径: ...
```

### 10.2 loader 切片规则

loader 对 `USER.md` 的处理固定为：

- 一次解析
- 产出 `profile_slice`
- 产出 `preference_slice`

注入位置固定为：

- `profile_slice` 注入第 3 层
- `preference_slice` 注入第 5 层

两切片各自有：

- 独立预算
- 独立 hash

### 10.3 预算

- `profile_slice` ≤ `400 tokens`
- `preference_slice` ≤ `200 tokens`

### 10.4 缺失段与拒绝规则

若缺失 `## profile` 或 `## preference`：

- loader 补空段
- 不报错
- 保持结构稳定

若出现以下任一情况：

- 第三个二级标题
- `schema` 不匹配

则：

- 整文件降级为空画像
- 不做部分加载
- 发出 `user_md_rejected` 事件

### 10.5 写回路径

`USER.md` 只允许通过以下入口写回：

1. 前端 Profile 面板
2. `/remember` 结构化建议 + 用户确认
3. compact pipeline 向 `profile` 追加稳定事实

禁止写回路径：

- skill 直接写 `USER.md`
- `manager / worker` 直接写 `USER.md`
- memory recall 回灌 `USER.md`

### 10.6 层边界

`profile_slice` 表示：

- 用户是谁
- 用户做什么
- 用户长期要什么

`preference_slice` 只影响：

- 语气
- 解释粒度
- 术语口径

`preference_slice` 不得定义：

- 结构
- 权限
- 执行规则

## 11. `MEMORY.summary` 与 `memory recall`

### 11.1 `MEMORY.summary`

唯一摘要文件固定为：

- `.lecquy/MEMORY.summary.md`

规则固定为：

- 唯一写入方：compact pipeline
- 预算：`200-400 tokens`
- 属于 startup context 的一部分
- 不能被 recall 回写

### 11.2 `memory recall`

`memory recall` 走独立检索通道：

- 每回合动态计算
- 只进入第 6 层
- 只提供事实
- 不构成规则

禁止：

- 回写 `MEMORY.summary`
- 回写 startup context
- 进入 `systemPrompt`

## 12. 语言策略

Lecquy 隐藏 prompt 采用：

- 规则英文
- 风格中文

英文层负责：

- 结构
- 契约
- 权限
- 执行规则
- 验证规则

中文层负责：

- 语气
- 解释粒度
- 中文业务术语
- 示例文案

硬规则：

- 结构用英文
- 示例文案用中文
- 示例不构成规则

禁止：

- 同一规则中英双写并相互冲突
- 中文示例反向修改英文规则

## 13. 能力不足时的默认退化

当模型判断现有能力不足时，默认：

1. 明确说明缺少什么能力
2. 给出可执行替代路径

不应：

- 伪装成已经执行成功
- 假设不存在的工具和权限
- 盲目尝试不在环境中的能力

## 14. 验收标准

### 14.1 文档一致性

- 文档中只保留一套分层、优先级和注入顺序定义
- 不再出现 `startup context`、`skill`、`user preference` 的重复优先级表述

### 14.2 结构化契约

- transport 章节明确单条 `systemPrompt`
- 动态块与稳定块边界无冲突
- `memory_recall` 与 `live_turn` 不进入 `systemPrompt`

### 14.3 协议完整性

- `simple`
- `plan.manager`
- `plan.worker`

三者的权限映射可直接用于实现。

- `manager / worker` 授权与回执协议无空白
- worker 上下文隔离无空白
- `USER.md` 与 `MEMORY.summary` 的唯一来源和拒绝规则无空白

### 14.4 字节级可测项

以下两条必须能被单元测试验证：

1. 给定同一 `.lecquy/` 快照，连续两次序列化出的 `systemPrompt` 字节完全一致，包含空白与换行。
2. 给定 `profile_slice` 变更而 `preference_slice` 不变的场景，序列化出的 `<LAYER:user_preference>` 段字节保持不变。

### 14.5 后续测试要求

后续实现必须补：

- 标签顺序测试
- 换行稳定性测试
- `USER.md` 缺段补空测试
- `user_md_rejected` 触发测试
- skill 常驻期间字节不变测试

## 15. 非目标

本文档当前阶段不要求立即实现：

- 完整第三方 skill 市场
- skill 动态注册新工具
- 自动从 `simple` 跳转到 `plan`
- 把所有运行时事实都持久化成 startup context
- 复刻 Claude Code / Codex / Augment 的原始 prompt 文案

## 16. 一句话基线

Lecquy v2 隐藏 prompt 的正确方向不是“更像终端编程助手”，而是“单条 `systemPrompt`、7 层真源、规则英文、风格中文、system managed rules 与 startup context 分离、skill 受约束、memory 分层、字节稳定可测的小心智任务代理”。
