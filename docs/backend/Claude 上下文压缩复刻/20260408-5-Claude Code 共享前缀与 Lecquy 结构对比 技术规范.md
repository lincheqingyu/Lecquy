# Claude Code 共享前缀与 Lecquy 结构对比

更新日期：2026-04-08

## 1. 目标

这份文档聚焦一个问题：

- Claude Code 的共享前缀工程，和 Lecquy 当前 prompt 装配结构，到底差在哪里
- 哪些部分是稳定前缀，哪些部分是运行时变化项
- system prompt、项目上下文、动态上下文的先后顺序是什么
- 如果从“共享前缀稳定性”角度评价，哪一套更成熟

本文不是 Claude Code 默认隐藏 prompt 的逐字还原。

原因很简单：

- Claude Code 的默认 system prompt 没有公开完整原文
- 当前能可靠对比的是结构、分层、装配顺序、上下文生命周期和 cache-friendly 纪律

所以本文件讨论的是：

- prompt stack 的结构
- 共享前缀的边界
- 稳定块与动态块的拆分方式

而不是去伪造一份“Claude Code 完整 system prompt 原文”。

## 2. 先给结论

如果目标是：

- 共享前缀稳定性
- prompt caching 友好
- 长会话上下文工程

那么 Claude Code 的方案更成熟。

如果目标是：

- 透明可见
- 便于部署后覆写
- 更容易审计和排查

那么 Lecquy 当前方案更直观。

最大的结构差异不是 prompt 文案本身，而是分层方式：

- Claude Code 更接近“隐藏且稳定的 system 层 + additive 的项目/用户上下文层 + 按需加载层 + 对话层”
- Lecquy 当前更接近“显式 system prompt 大字符串 + 运行时额外补几块动态 message”

也就是说：

- Claude Code 是分层堆栈
- Lecquy 当前是单串 system prompt 加动态补丁

## 3. 结构总览对比

| 维度 | Claude Code | Lecquy 当前 |
| --- | --- | --- |
| 默认 system prompt | 有，官方内建，默认隐藏 | 由 `buildSystemPrompt()` 显式生成，代码可见 |
| 项目规范入口 | 官方一等入口是 `CLAUDE.md`，并叠加启动期上下文 | `.lecquy/SOUL.md`、`IDENTITY.md`、`USER.md`、`MEMORY.md`、`AGENTS.md`、`TOOLS.md` 会被读出并拼进 system prompt |
| 输出风格 | output style 属于 system 层补丁，并在新 session 生效 | `identity-*`、`role-*`、`extra-instructions` 都直接参与每轮 system prompt 组装 |
| 技能 / 规则 | skill description 先进入启动上下文，全文按需读；规则可按路径懒加载 | skills 摘要直接进 system prompt；项目上下文文件整体进 system prompt |
| 动态上下文 | 用户消息、工具结果、文件读取、hooks 注入、compact summary | memory recall、compact summary、recent tail 在 message 层额外注入 |
| 共享前缀边界 | 更明确区分 system 层、启动期上下文层、对话层 | `buildSystemPrompt()` 先拼一整串，再叠加 context messages |
| cache-friendly 稳定性 | 强，明确围绕稳定前缀和 compaction 设计 | 仍在收口阶段，静态前缀与动态区块边界不够清楚 |
| 可观察性 | 默认 prompt 不透明 | 模板、顺序、上下文来源都可在仓库里直接看到 |
| 可定制度 | 高，但以 Claude Code 官方边界为前提 | 更高，模板和上下文体系都可直接改 |

中文说明：

- Claude Code 的强项在于“结构稳定”，尤其适合长会话和 prefix reuse。
- Lecquy 的强项在于“结构可见”，更适合产品快速迭代和 prompt 工程调试。
- Claude Code 把“系统规则”和“项目/用户上下文”拆得更开；Lecquy 当前把很多原本应该分层的内容，提前合并进了同一个 system prompt 字符串。

## 4. Claude Code 里什么在变，什么不变

### 4.1 相对不变的部分

从共享前缀角度看，Claude Code 里更稳定的是：

- 默认 system prompt 主体
- 已选 output style
- `--append-system-prompt` 这类 system 层附加内容
- 启动时加载的 `CLAUDE.md`
- auto memory
- skill descriptions
- MCP 工具可见性

这些内容未必永远不变，但它们更接近“session 级稳定块”，不会像每轮对话正文那样高频波动。

### 4.2 高频变化的部分

Claude Code 里高变化内容主要是：

- 用户消息
- assistant 回复
- 工具调用轨迹和工具结果
- 文件读取结果
- hooks 注入的 `additionalContext`
- 真正命中后才读取的 skill 全文
- `/compact` 之后生成的结构化 summary

中文说明：

- Claude Code 追求的不是“整个上下文永远不变”
- 它追求的是“最长连续共享前缀尽量稳定”

这和 Lecquy 当前“把项目上下文整体塞进 system prompt，再把 recall / compact 作为动态 message 补上”的思路不同。

## 5. 先后顺序

### 5.1 Claude Code 的高层 prompt stack 顺序

基于官方文档和公开行为，可以高置信度把 Claude Code 的高层装配顺序理解为：

1. tools
2. 默认 system prompt
3. output style / `--append-system-prompt` 之类的 system 层补丁
4. 启动期上下文：`CLAUDE.md`、auto memory、skill descriptions、MCP 工具可见性等
5. 用户提示与后续对话 / 工具轨迹
6. `/compact` 后由结构化 summary 替换旧对话，启动期上下文大多继续保留

这里最重要的不是某一行文字，而是这个分层关系：

- system 层在前
- 启动期上下文层在后
- live conversation 最后进入

### 5.2 Lecquy 当前 system prompt 顺序

`backend/src/core/prompts/system-prompts.ts` 当前的 section 顺序是：

1. `identity`
2. `role directive`
3. `tooling`
4. `tool-call-style`
5. `safety`
6. `skills`
7. `workspace`
8. `documentation`
9. `time`
10. `project context`
11. `runtime`
12. `extra instructions`

这代表 Lecquy 当前把以下内容全部提前拼进了同一个 system prompt：

- 角色
- 工具说明
- workspace 信息
- 文档入口
- 时间
- 项目上下文文件
- runtime 元信息

### 5.3 Lecquy 当前 message 层顺序

`backend/src/runtime/context/augmented-context-builder.ts` 当前行为是：

- 无 compact：`session history -> memory recall -> current user input`
- 有 compact：`memory recall -> compact summary -> recent tail -> current user input`

这说明 Lecquy 当前的动态块在 compact 前后顺序并不一致：

- 同一个 memory recall block，在无 compact 和有 compact 时处于不同相对位置
- 这会削弱共享前缀稳定性

## 6. Lecquy 当前最大的结构问题

当前最大的差异，不是有没有 compact，也不是有没有记忆，而是：

- Claude Code 已经明确区分 system 层、启动期上下文层、对话层
- Lecquy 当前还没有把 `systemPrompt / userContext / systemContext` 真正拆开

这会导致几个直接后果：

1. 项目上下文、时间、文档入口、runtime 信息都和基础系统规则混在一起
2. 难以判断哪些块应该算“共享前缀”
3. 记忆块和 compact 块在 message 层的位置不够稳定
4. 后续想做 cache-friendly 审计或 section 级缓存，会比较被动

再说得更直接一点：

- Claude Code 更像“结构先行”
- Lecquy 当前更像“内容先拼出来再说”

## 7. 谁的方案更好

这个问题要分场景回答。

### 7.1 如果以共享前缀工程成熟度评价

Claude Code 更好。

原因是：

- system 层和动态层边界更清晰
- session 级稳定块和对话级变化块分离得更好
- compact 不是孤立功能，而是上下文工程的一部分
- 更适合 prefix reuse、长会话复用、结构化上下文管理

### 7.2 如果以产品可控性和调试便利性评价

Lecquy 当前方案更实用。

原因是：

- prompt 模板完全可见
- 上下文文件来源明确
- 每个 section 的内容和顺序都容易审计
- 更适合自托管、实验性迭代、快速调 prompt

### 7.3 最终判断

最终判断可以直接落成一句话：

- 架构成熟度：Claude Code 更强
- 产品可控性与透明度：Lecquy 更强

所以 Lecquy 当前最值得借鉴的，不是 Claude Code 的具体措辞，而是它的：

- 分层边界
- 稳定前缀纪律
- 启动期上下文与 live conversation 的拆分方式

## 8. 对 Lecquy 的启发

如果 Lecquy 要继续向 Claude Code 的共享前缀工程靠近，最优先的不是重写 prompt 文案，而是先做结构收口：

1. 先把基础 system 层和项目上下文层拆开
2. 再把 session 级稳定块和每轮动态块拆开
3. 固定 compact 场景和非 compact 场景下的动态块顺序
4. 最后再讨论是否需要 section 级缓存或更细的 cache-friendly 优化

其中优先级最高的是：

- 不要再把越来越多的项目上下文继续堆进单个 system prompt 字符串
- 先建立“哪些是稳定前缀、哪些是动态块”的边界

## 9. 对照仓库锚点

本文结论主要锚定这些 Lecquy 当前实现：

- `backend/src/core/prompts/system-prompts.ts`
- `backend/src/core/prompts/context-files.ts`
- `backend/src/runtime/context/augmented-context-builder.ts`
- `docs/backend/Claude 上下文压缩复刻/20260408-4-Claude 上下文压缩复刻 Lecquy 对标分析 技术规范.md`

## 10. 参考资料

- Claude Code Output Styles: <https://code.claude.com/docs/en/output-styles>
- Claude Code Memory: <https://code.claude.com/docs/en/memory>
- Claude Code Context Window: <https://code.claude.com/docs/en/context-window>
- Claude Code Hooks: <https://code.claude.com/docs/en/hooks>
- Anthropic Prompt Caching: <https://platform.claude.com/docs/en/build-with-claude/prompt-caching>
