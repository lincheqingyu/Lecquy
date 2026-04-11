# Lecquy 隐藏 Prompt 文档评审指令

更新日期：2026-04-09

## 1. 目的

本文档用于把 [`20260409-1-Lecquy 隐藏 Prompt 与模式边界 技术规范.md`](./20260409-1-Lecquy%20隐藏%20Prompt%20与模式边界%20技术规范.md) 交给 Claude 做正式架构评审前，先统一：

- 评审目标
- 产品定位
- 参考方向
- 参考文档
- 借鉴目标
- 评估原则
- 评估标准
- Claude 的输出格式

这样做的原因是：

- 不让评审退化成“文风意见”
- 不让 Claude 按 CLI 编程助手的默认偏见来审 Web Agent 产品
- 不让 Claude 忽略 Lecquy 当前已有的 runtime、memory、mode 和 tool 边界

## 2. 评审对象

本次主评审对象是：

- [`20260409-1-Lecquy 隐藏 Prompt 与模式边界 技术规范.md`](./20260409-1-Lecquy%20隐藏%20Prompt%20与模式边界%20技术规范.md)

评审目标不是润色文案，而是判断这份规范是否：

- 架构自洽
- 与 Lecquy 产品定位一致
- 可落地到当前代码基线
- 能提高最终任务完成率
- 不会把系统重新拉回“终端编程助手”路线

## 3. 产品定位

Claude 在评审时，必须以以下产品定位为准：

### 3.1 Lecquy 不是什么

Lecquy 不是：

- Claude Code 的复刻版
- 终端优先的编程助手
- skill-first 的插件市场 agent
- 只能服务代码仓库的 coding agent

### 3.2 Lecquy 是什么

Lecquy 是：

- 面向中文用户的 Agent Web 产品
- 多模式任务代理
- 以 `simple / plan` 为主模式边界
- 以 OS 自适应执行器作为底座
- 以结构化 tools 作为主执行面
- 以 skill 作为受约束的增强层

### 3.3 当前冻结的核心定位

- `simple`：通用任务执行代理
- `plan`：计划工作流代理
- Windows 默认执行器：`PowerShell`
- Linux 默认执行器：shell
- 规则层：英文
- 风格层：中文
- baseline：无 skill 也必须可用

## 4. 参考方向

Claude 在评审时，应按以下方向理解“借鉴”，而不是理解成“照搬”。

### 4.1 要借鉴的方向

- 分层清晰
- 共享前缀稳定
- startup context 与 system 分离
- mode 契约明确
- 工具选择低歧义
- skill 受约束
- 权限和副作用边界明确
- 对长会话和 memory recall 友好

### 4.2 不要误判的方向

不要把以下方向当成默认正确：

- 默认把产品角色定义成 CLI 编程助手
- 默认把 shell 当成唯一执行器
- 默认把 skill 当成中心执行能力
- 默认让第三方 skill 覆盖 mode 或 system 规则
- 默认把所有 `.lecquy/*` 一起拼进 system prompt
- 默认让完整 `MEMORY.md` 长期常驻

## 5. 参考文档

Claude 在评审前应阅读以下文档。

### 5.1 目标文档

- `/Users/hqy/Documents/zxh/projects/Lecquy/docs/backend/20260409-1-Lecquy 隐藏 Prompt 与模式边界 技术规范.md`

### 5.2 Lecquy 内部参考文档

- `/Users/hqy/Documents/zxh/projects/Lecquy/docs/backend/20260408-7-Claude Code 能力借鉴路线 开发规划.md`
- `/Users/hqy/Documents/zxh/projects/Lecquy/docs/backend/20260408-13-Simple Plan 模式分析 技术规范.md`
- `/Users/hqy/Documents/zxh/projects/Lecquy/docs/backend/20260408-16-上下文压缩与稳定化 技术规范.md`
- `/Users/hqy/Documents/zxh/projects/Lecquy/docs/backend/Claude 上下文压缩复刻/20260408-5-Claude Code 共享前缀与 Lecquy 结构对比 技术规范.md`

### 5.3 外部 prompt 参考文档

- `/Users/hqy/Documents/zxh/github/system-prompts-and-models-of-ai-tools/Anthropic/Claude Code/Prompt.txt`
- `/Users/hqy/Documents/zxh/github/system-prompts-and-models-of-ai-tools/Open Source prompts/Codex CLI/openai-codex-cli-system-prompt-20250820.txt`
- `/Users/hqy/Documents/zxh/github/system-prompts-and-models-of-ai-tools/Augment Code/gpt-5-agent-prompts.txt`

## 6. 借鉴目标

Claude 在评审时，应明确区分“借什么”和“不借什么”。

### 6.1 从 Claude Code 借什么

- `system -> startup context -> live conversation` 的分层意识
- 简洁输出纪律
- 工具优先级
- todo / task discipline
- cache-friendly 共享前缀意识

### 6.2 从 Codex 借什么

- preamble / progress update 纪律
- plan 与执行节奏
- sandbox / approval 思维
- 验证与最终答复结构

### 6.3 从 Augment 借什么

- tasklist trigger
- 保守信息搜集
- incremental planning
- 执行与验证约束

### 6.4 明确不借什么

- 终端中心身份
- CLI-first 交互假设
- 让第三方 skill 过度主导执行
- 把英语 agent prompt 原文直接翻译后照搬

## 7. 评估原则

Claude 必须按以下原则评审，且优先级按顺序从高到低。

### 7.1 产品匹配优先于文案优雅

如果某条规则听起来像成熟 agent prompt，但不符合 Lecquy 的产品定位，应判为问题。

### 7.2 架构边界优先于措辞细节

要优先审：

- system 和 startup context 是否混层
- mode 和 skill 是否越权
- memory 是否污染稳定前缀

不要把主要精力放在：

- 某句中文是否更顺
- 某个标题是否更好看

### 7.3 可落地性优先于理想设计

Claude 需要结合当前 Lecquy 已有的：

- runtime 事件流
- `simple / plan`
- manager / worker
- tool 注册方式
- memory recall builder

判断规范是否能实现，而不是只给理想答案。

### 7.4 成功率优先于功能幻觉

评审重点要落在：

- 是否会提升任务完成率
- 是否会降低误调用工具
- 是否会减少模式冲突
- 是否会减少 skill 干扰

### 7.5 安全边界优先于自动化野心

如果某条规则会让：

- `simple` 越权写文件
- `plan.worker` 绕过 manager
- 第三方 skill 覆盖权限策略

应判为高优先级问题。

### 7.6 共享前缀稳定优先于上下文堆料

如果某条设计会让：

- startup context 高频变化
- 完整 `MEMORY.md` 常驻
- recall block 打断稳定块

应明确指出其对 cache-friendly 稳定性的破坏。

## 8. 评估标准

Claude 应按以下 6 个维度评分，每项 `1-5` 分，并给出一句理由。

### 8.1 产品匹配度

看是否符合：

- 中文 Agent Web 产品
- 多模式任务代理
- 非终端中心

### 8.2 分层清晰度

看是否清晰区分：

- `system`
- `mode`
- `startup context`
- `skill`
- `memory recall`

### 8.3 执行可落地性

看是否能落到当前 Lecquy runtime、tools、mode、memory 链路。

### 8.4 安全与权限完整性

看是否正确处理：

- 写入确认
- 副作用命令确认
- manager / worker 授权关系
- skill 越权风险

### 8.5 成功率支撑度

看是否有利于：

- 减少错误模式选择
- 减少错误 tool 调用
- 减少无效 skill 干扰
- 提高用户目标完成率

### 8.6 长会话与稳定前缀友好度

看是否有利于：

- startup context 稳定
- memory 分层
- recall 与 compact 的长期可治理性

## 9. 判定标准

Claude 最终需要给出总体判定：

- `通过`：可以作为实现基线，仅有低风险改进点
- `有条件通过`：总体方向对，但存在若干必须先修的问题
- `不通过`：存在根本性定位或架构问题

若判定为 `有条件通过` 或 `不通过`，必须明确列出：

- 哪些是必须先修
- 哪些是可以后补

## 10. Claude 的输出要求

Claude 的评审输出必须遵守以下格式：

### 10.1 Findings First

先列问题，再给总结。

问题必须：

- 按严重性排序
- 明确指出对应章节或规则
- 说明风险
- 给出最小修正建议

### 10.2 不接受泛泛建议

不要输出这类内容：

- “整体不错，可以继续优化”
- “建议再细化一些”
- “某些地方还可以更明确”

除非明确指出：

- 哪一节
- 为什么不清楚
- 不清楚会导致什么实现风险

### 10.3 必须区分三类问题

每个问题应标注属于：

- `定位问题`
- `边界问题`
- `实现问题`

### 10.4 允许无问题结论

如果 Claude 认为没有高风险问题，可以明确说：

- “未发现阻断性问题”

但仍应说明：

- 剩余风险
- 哪些是实现阶段最容易跑偏的点

## 11. 可直接复制给 Claude 的评审指令

下面这段文本可直接交给 Claude。

```md
请你以“架构评审者 / prompt system reviewer”的角色，审阅下面这份文档：

- `/Users/hqy/Documents/zxh/projects/Lecquy/docs/backend/20260409-1-Lecquy 隐藏 Prompt 与模式边界 技术规范.md`

在审阅前，请先阅读以下参考文档：

- `/Users/hqy/Documents/zxh/projects/Lecquy/docs/backend/20260408-7-Claude Code 能力借鉴路线 开发规划.md`
- `/Users/hqy/Documents/zxh/projects/Lecquy/docs/backend/20260408-13-Simple Plan 模式分析 技术规范.md`
- `/Users/hqy/Documents/zxh/projects/Lecquy/docs/backend/20260408-16-上下文压缩与稳定化 技术规范.md`
- `/Users/hqy/Documents/zxh/projects/Lecquy/docs/backend/Claude 上下文压缩复刻/20260408-5-Claude Code 共享前缀与 Lecquy 结构对比 技术规范.md`
- `/Users/hqy/Documents/zxh/github/system-prompts-and-models-of-ai-tools/Anthropic/Claude Code/Prompt.txt`
- `/Users/hqy/Documents/zxh/github/system-prompts-and-models-of-ai-tools/Open Source prompts/Codex CLI/openai-codex-cli-system-prompt-20250820.txt`
- `/Users/hqy/Documents/zxh/github/system-prompts-and-models-of-ai-tools/Augment Code/gpt-5-agent-prompts.txt`

请严格以以下产品定位作为评审前提：

1. Lecquy 不是终端优先的编程助手，也不是 Claude Code 的复刻版。
2. Lecquy 是面向中文用户的 Agent Web 产品。
3. Lecquy 当前的主模式是：
   - `simple`：通用任务执行代理
   - `plan`：计划工作流代理
4. Lecquy 的执行底座是 OS 自适应执行器：
   - Windows：`PowerShell`
   - Linux：shell
5. Lecquy 的目标不是 skill-first，而是：
   - 结构化 tools 是主执行面
   - skill 是受约束的增强层
6. Lecquy 的语言策略是：
   - 规则英文
   - 风格中文

请按以下借鉴方向理解评审：

- 借鉴 Claude Code 的分层意识、共享前缀纪律、todo discipline
- 借鉴 Codex 的 preamble、plan、approval、验证结构
- 借鉴 Augment 的 tasklist trigger、信息搜集纪律、增量规划
- 不要默认 Lecquy 应该变成 CLI 编程助手
- 不要默认完整 `MEMORY.md` 应该常驻
- 不要默认第三方 skill 可以覆盖 mode 或 system 规则

请按以下原则评审：

1. 产品匹配优先于文案优雅
2. 架构边界优先于措辞细节
3. 可落地性优先于理想设计
4. 成功率优先于功能幻觉
5. 安全边界优先于自动化野心
6. 共享前缀稳定优先于上下文堆料

请重点审以下问题：

- `system / mode / startup context / skill / memory recall` 是否分层清楚
- `simple / plan` 的模式边界是否自洽
- `manager / worker` 授权关系是否清楚
- `skill` 是否被限制在正确优先级
- `USER.md / MEMORY.md` 的边界是否合理
- 是否仍残留“终端编程助手中心化”的隐性假设
- 是否有会降低任务完成率的设计
- 是否有会降低 cache-friendly 稳定性的设计

请用以下格式输出：

1. 先给 Findings，按严重性排序
2. 每条 Findings 标注：
   - 类型：`定位问题` / `边界问题` / `实现问题`
   - 严重级别：高 / 中 / 低
   - 对应章节
   - 问题说明
   - 风险
   - 最小修正建议
3. 然后给一个总体结论：
   - `通过`
   - `有条件通过`
   - `不通过`
4. 最后给 6 个维度的评分（1-5 分）并附一句理由：
   - 产品匹配度
   - 分层清晰度
   - 执行可落地性
   - 安全与权限完整性
   - 成功率支撑度
   - 长会话与稳定前缀友好度

注意：

- 不要主要评价文风
- 不要泛泛而谈
- 不要复述文档内容
- 如果没有高风险问题，可以明确说“未发现阻断性问题”，但仍要指出最容易在实现阶段跑偏的点
```

## 12. 一句话要求

这次给 Claude 的评审，不是让它帮忙润色，而是让它站在“产品定位 + 架构边界 + 可实现性 + 成功率”四条线上，审出真正会让 Lecquy 跑偏的地方。
