# System Prompt 重新开发指导

> 更新日期：2026-05-18
> 类型：技术规范
> 关联：[20260513-7-系统提示词模块再合并与缓存命中优化 决策沉淀](../../项目级/20260513-7-系统提示词模块再合并与缓存命中优化%20决策沉淀.md)

## 1. 背景

本轮重做 system prompt，不是继续给现有拼接逻辑打补丁，而是把后端 prompt 构建、会话快照、运行时更新、API replay transcript 和 provider adapter 边界重新收拢。

核心决策已经在 `20260513-7` 钉死：

- 每个会话创建后生成一次 `FrozenSystemSnapshot`。
- 同一会话内，API 请求的 `system` 字段保持字节级稳定，直到 compact / resnapshot。
- 会话中途可变内容不再改写 system，而是在下一次用户问题前插入 `<system_prompt_update>`。
- `<system_prompt_update>` 采用 `cumulative since snapshot`，不是 `delta-since-previous`。
- compact 时把最新 update 吸收到新的 `FrozenSystemSnapshot`，历史 update 归零。

本文件是给 Codex / Claude Code / 后续 Lecquy 自身实现用的开发指导。执行时以本文为切入点，以 `20260513-7` 为决策来源。

## 2. 目标

### 2.1 必须完成

1. 建立稳定的 `FrozenSystemSnapshot` 生成、持久化和复用路径。
2. 建立 `<system_prompt_update>` 生成器，支持相对 snapshot 的累积变化。
3. 分离用户可见 transcript、API replay transcript、runtime augmentation。
4. 固定 OpenAI-compatible messages 为默认主路径。
5. 将 Anthropic `cache_control` 限定为 provider adapter 的可选优化，不进入核心 prompt 结构。
6. 给 snapshot / update / replay 增加确定性测试，防止后续实现漂移。

### 2.2 不做

- 不重新设计 `.lecquy/` 文件体系。
- 不引入多用户、鉴权、限流、Gateway 或租户隔离。
- 不为 provider 差异污染核心 prompt 数据结构。
- 不为了清理而直接删除 `.lecquy/system-prompt/` 或旧 prompt 代码。
- 不做 frontend 展示改造，除非后续明确要求。

## 3. 核心路线

### 3.1 FrozenSystemSnapshot

`FrozenSystemSnapshot` 是会话级不可变 system prompt 快照。

创建时机：

- 新会话创建时。
- compact 后重新开上下文窗口时。
- 用户显式要求重置 / 重建会话上下文时。

同一 snapshot 生命周期内，下列内容不得改写 API `system` 字段：

- BASE / role / tooling / safety / AGENTS / TOOLS。
- `SOUL.md`、`IDENTITY.md`、`USER.md`、`MEMORY.summary.md` 的已快照内容。
- skills index、workspace rules、mode directive 的已快照内容。
- 创建 snapshot 时的当前日期和时区。

这意味着跨日、核心文件修改、mode 切换等事件，都不直接重写 system，而是进入 `<system_prompt_update>`。

### 3.2 system_prompt_update

`<system_prompt_update>` 是 synthetic context block，插在最新用户问题之前。

它必须满足：

- role 使用 `user` 或内部 context message，不使用 `tool`。
- tag 名固定为 `<system_prompt_update>`。
- 内容是相对 `FrozenSystemSnapshot` 创建时点的累积变化。
- 未变字段直接省略，不写 `none` / `null` / 空行。
- 最新 block 单独读 + FrozenSystemSnapshot，即可得到当前等价状态。
- 不允许覆盖 BASE / TOOLS / AGENTS / safety / tool permission。

推荐序列：

```text
system: <FrozenSystemSnapshot.systemText>
...
user: <system_prompt_update priority="high" source="lecquy">
Current date: 2026-05-18
Changed files since snapshot:
- USER.md: 新增偏好"文档日期必须使用当前真实日期，不得沿用会话创建日期"。
</system_prompt_update>
user: <current user message>
```

如果同一 snapshot 下第 5 轮新增 X，第 10 轮新增 Y，第 10 轮的最新 block 必须展示 X + Y 的当前累积差异，而不是只展示 Y。

### 3.3 MemoryRecall

MemoryRecall 不进入 system。

每轮召回结果放入最新用户消息附近的低优先级 context block，例如：

```text
<retrieved_memory priority="low">
- ...
</retrieved_memory>
```

MemoryRecall 是短期相关上下文，不是 system 规则；它可以每轮变化，也不应该牺牲 system cache prefix。

### 3.4 Provider Adapter

核心 prompt builder 只产出 provider-neutral 的结构：

- `systemText`
- replay messages
- update blocks
- memory blocks
- tool result blocks

OpenAI-compatible / vLLM / llama.cpp / DeepSeek / Qwen / GLM 是默认兼容目标。

Anthropic 差异只允许在 adapter 层处理：

- 是否把 system 拆成 content blocks。
- 是否加 `cache_control`。
- 是否映射 tool result 格式。

核心层不得出现“为了 Anthropic 改变 system 分层”的实现。

## 4. 代码改造边界

第一轮实现前，先审查这些路径，不要凭记忆改：

- `backend/src/core/prompts/system-prompts.ts`
- `backend/src/core/prompts/prompt-module-files.ts`
- `backend/src/core/prompts/prompt-serializer.ts`
- `backend/src/core/prompts/context-files.ts`
- `backend/src/runtime/session-runtime-service.ts`
- `backend/src/runtime/context/augmented-context-builder.ts`
- `backend/src/memory/prompt-injector.ts`
- `backend/src/agent/vllm-model.ts`
- `.lecquy/system-prompt/`
- `.lecquy/SOUL.md`
- `.lecquy/IDENTITY.md`
- `.lecquy/USER.md`
- `.lecquy/MEMORY.summary.md`
- `.lecquy/AGENTS.md`
- `.lecquy/TOOLS.md`

旧模块在迁移完成前只允许包一层兼容，不允许直接删除。删除必须等到测试覆盖 snapshot / update / replay 后单独立项。

## 5. 数据契约

### 5.1 SystemPromptSnapshot

建议最小结构：

```ts
type SystemPromptSnapshot = {
  sessionId: string;
  snapshotId: string;
  createdAt: string;
  timeZone: string;
  mode: "simple" | "manager" | "worker";
  modelId?: string;
  sourceHashes: {
    base: string;
    tools: string;
    agents: string;
    soul: string;
    identity: string;
    user: string;
    memorySummary: string;
    skillsIndex: string;
  };
  systemText: string;
  contentHash: string;
};
```

要求：

- `contentHash` 由最终 `systemText` 计算。
- 同一输入下必须稳定生成同一 `systemText` 字节。
- snapshot 创建后不得原地 mutate。

### 5.2 SystemPromptUpdate

建议最小结构：

```ts
type SystemPromptUpdate = {
  sessionId: string;
  baseSnapshotId: string;
  generatedAt: string;
  changedSinceSnapshot: {
    currentDate?: string;
    timeZone?: string;
    mode?: string;
    modelId?: string;
    files?: Array<{
      path: "SOUL.md" | "IDENTITY.md" | "USER.md" | "MEMORY.summary.md";
      cumulativeSummary: string;
    }>;
    activeSkill?: string;
    attachments?: string;
  };
  serializedText: string;
  contentHash: string;
};
```

要求：

- `changedSinceSnapshot` 只包含相对 snapshot 已变化字段。
- `files[].cumulativeSummary` 是当前最终状态相对 snapshot 的完整差异。
- 没有变化时不生成 update。
- 序列化顺序固定，避免缓存和测试不稳定。

### 5.3 Transcript 分层

至少区分三层：

- `visibleTranscript`：用户界面显示的真实 user / assistant 消息。
- `apiReplayTranscript`：发给模型的完整消息序列，包含 synthetic context。
- `runtimeAugmentation`：本轮临时注入块，如 memory、update、附件摘要。

不要把 `<system_prompt_update>` 存成用户真的说过的话；它是系统运行时上下文。

## 6. 阶段拆解

### P0：入口同步与审计

目标：先让实现者不会读错规则。

动作：

- 同步 `CLAUDE.md` / `AGENTS.md` 中 system prompt 最新约束。
- 更新 `docs/README.md` 对 `20260513-7` 的摘要，避免继续描述旧 `<env>` 方案。
- 审查第 4 节代码路径，画出现有 prompt 构建链路。
- 写出当前 system messages 的实际序列样例。

验收：

- 文档入口不再出现“动态 system 末位 env 块”作为推荐方案。
- 旧方案只作为历史背景存在。

### P1：Snapshot Builder

目标：能在会话创建时生成稳定 `FrozenSystemSnapshot`。

动作：

- 建立 snapshot builder。
- 固定 source file 读取顺序和序列化格式。
- 给 snapshot 加 `contentHash`。
- 接入 session runtime 存储。

验收：

- 同一输入重复构建，`systemText` 和 `contentHash` 完全一致。
- 同一会话内发送多轮消息，API `system` 字节不变。

### P2：SystemPromptUpdate Builder

目标：把核心文件和运行时变化转成 cumulative update。

动作：

- 对比当前源文件 hash 和 snapshot source hash。
- 为 `SOUL.md` / `IDENTITY.md` / `USER.md` / `MEMORY.summary.md` 生成稳定 diff 摘要。
- 支持跨日、mode、active skill、附件摘要等 runtime update。
- 只在有变化时生成 block。

验收：

- 未变化时不输出 `<system_prompt_update>`。
- 未变字段不输出占位。
- 同一 snapshot 下多次修改同一文件，最新 block 展示相对 snapshot 的完整累积变化。

### P3：Replay Transcript 分离

目标：API replay 可靠，用户界面不污染。

动作：

- 将 visible transcript 和 API replay transcript 分层。
- 在 replay 中把 update 放在当前用户消息前。
- MemoryRecall 放在低优先级 block，不进入 system。
- 工具结果保留 provider-neutral 内部结构，再由 adapter 转换。

验收：

- UI 历史不显示 `<system_prompt_update>`。
- API 日志能看到 update 位于最新用户问题前。
- MemoryRecall 每轮可变，但 system hash 不变。

### P4：Compact / Resnapshot

目标：压缩后重建干净 snapshot。

动作：

- compact 时读取当前最新 cumulative update。
- 把当前等价状态吸收到新的 `FrozenSystemSnapshot`。
- 清除旧 update block 对新窗口的逻辑影响。

验收：

- compact 后首轮请求没有旧 `<system_prompt_update>` 残留。
- 新 snapshot 的 `systemText` 已包含 compact 前最新有效状态。

### P5：Provider Adapter

目标：兼容主流 API，同时不污染核心结构。

动作：

- OpenAI-compatible adapter 作为默认路径。
- Anthropic adapter 独立处理 `system` content block 和 `cache_control`。
- vLLM / llama.cpp / 国产模型 API 走 OpenAI-compatible 近似路径。

验收：

- OpenAI-compatible 请求不包含 Anthropic 专属字段。
- Anthropic `cache_control` 只在 Anthropic adapter 内出现。
- 核心 snapshot / update 测试不依赖具体 provider。

## 7. 验收用例

必须覆盖：

1. 新会话创建后，连续发送两轮普通消息，`system` 字节完全一致。
2. 修改 `USER.md` 后发送新问题，`system` 字节不变，replay 中出现 `<system_prompt_update>`。
3. 同一 snapshot 下先新增 X 再新增 Y，最新 update 展示 X + Y。
4. 同一 snapshot 下新增 X 后删除 X，最新 update 不再展示 X。
5. 未变字段不输出 `none` / `null`。
6. 跨日后发送新问题，日期变化只出现在 update，不改写原 system。
7. compact 后生成新 snapshot，旧 update 不再重复注入。
8. OpenAI-compatible / vLLM 路径不出现 Anthropic `cache_control`。

## 8. 风险与防护

| 风险 | 防护 |
|---|---|
| 把 update 实现成 delta-since-previous | 单测断言同一 snapshot 下最新 block 是 cumulative since snapshot |
| 为了“即时生效”直接改 system | 单测断言会话内 system hash 不变 |
| 把 update 存成用户真实消息 | transcript 分层，UI 只读 visible transcript |
| 用 tool role 注入 update | 固定 update 为 synthetic user/context block |
| provider 差异污染核心结构 | adapter 层单独处理 Anthropic / OpenAI-compatible |
| 旧 prompt 文件被提前删除 | 迁移完成前只包兼容层，删除单独立项 |
| AGENTS.md / CLAUDE.md 不同步 | P0 先同步入口规则再动实现 |

## 9. 开发纪律

- 每次动 prompt 行为，必须先补或更新对应测试。
- prompt 序列化必须稳定，禁止依赖对象遍历的偶然顺序。
- 所有新增系统块都要说明 priority、source、生命周期和是否进入用户可见历史。
- 任何 provider 专属字段必须停在 adapter 层。
- 如果实现中发现 `20260513-7` 与本文冲突，以 `20260513-7` 的决策为准，并回头修本文。

## 10. 第一轮建议任务

第一轮不要直接大改 runtime。建议按下面顺序执行：

1. 同步 `AGENTS.md` 与 `CLAUDE.md` 中 system prompt 最新规则。
2. 给现有 prompt 构建链路写一份审查报告，列出实际调用路径和历史包袱。
3. 新增 snapshot / update 的类型和纯函数序列化测试。
4. 用兼容层把旧 prompt builder 包成 `FrozenSystemSnapshot`。
5. 再接入 session runtime 和 API replay。
