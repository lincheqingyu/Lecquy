# Spec：Tool Call 按时序 Block 渲染 + 自适应聚合

## 0. 背景

当前前端消息渲染把 tool 执行异常作为独立数组追加到消息末尾，导致与正文的时序错位（异常在时间上先发生，视觉上却在后），用户看到的推理链断裂。同时成功的 tool 调用完全不可见，用户无法理解 agent 的推理过程。对 instruct 模型尤其严重：没有 thinking 通道时，tool 卡片群本身就承担"可见推理过程"的职责。

## 1. 目标与非目标

### 目标
- 把消息渲染从"content + errors 两轴"重构为"blocks 按时序一轴"
- 成功 tool 调用以 Codex 轻量单行形态展示，失败 tool 调用以 Claude first-class 形态展示
- 消息内 tool 调用 ≥3 次时，自动出现可折叠聚合头
- 保持现有流式体验（刚修的 #1 贴底逻辑）零回归
- 历史消息不丢、不崩

### 非目标
- 不改后端 pi-ai / vLLM 层，不解决 #3 `</think>` 泄漏（已单独搁置）
- 不改消息编辑 / 重发 / 复制 等现有功能
- 不改思考区展示（已在前一轮重构为 Claude/Codex 极简样式，独立通道）
- 不做 tool 调用的搜索、筛选、分组细节面板（P2 以外特性）
- 不改 Markdown 正文渲染器本身

## 2. 总体架构

```
┌─ useChat.ts ─────────────────────┐      ┌─ MessageItem ────────────────┐
│ WebSocket event →                │      │ renders message.blocks[] →   │
│   blocks[]: append / patch       │ ───→ │   TextBlock | ToolGroupCard  │
│   (time-ordered, immutable)      │      │                              │
└──────────────────────────────────┘      └──────────────────────────────┘
                                                         │
                                                         ▼
                                          ┌─ ToolCallCard ──────────────┐
                                          │ status: running/success/     │
                                          │         error                │
                                          │ collapse / expand            │
                                          └─────────────────────────────┘
```

核心变更：
1. `ChatMessage.content: string` + `ChatMessage.errors?: …` → `ChatMessage.blocks: MessageBlock[]`
2. `useChat` 事件处理从"字段累加"改为"block append / patch"
3. `MessageItem` 渲染从"内容拼接 + 尾部异常"改为"blocks 顺序 map"
4. 新增 `ToolCallCard`、`ToolGroupCard` 两个组件

## 3. 数据结构

### 3.1 Shared 类型（`packages/shared/src/types/chat-message.ts` 或现有位置）

```ts
export type MessageBlockKind = 'text' | 'tool_call'

export type ToolCallStatus = 'running' | 'success' | 'error'

export interface MessageTextBlock {
  kind: 'text'
  /** block 内唯一 id，前端用于 key */
  id: string
  content: string
}

export interface MessageToolCallBlock {
  kind: 'tool_call'
  /** 后端 tool_call id，唯一且稳定 */
  id: string
  /** 工具语义名，如 'execute_sql' / 'read_file' / 'fetch_http' */
  name: string
  /** 工具参数，JSON 序列化后的原始对象；可能流式增量到达 */
  args?: unknown
  status: ToolCallStatus
  /** success 时的返回内容，JSON 原样保存，渲染时再格式化 */
  result?: unknown
  /** error 时的错误摘要，取 error.message 或 first-line */
  errorMessage?: string
  /** error 时可选的完整 stack / detail */
  errorDetail?: string
  /** 起止时间戳（毫秒），用于展示耗时 */
  startedAt?: number
  endedAt?: number
  /** 用户手动控制的展开态；缺省时 UI 按默认规则决定 */
  manualExpanded?: boolean
}

export type MessageBlock = MessageTextBlock | MessageToolCallBlock
```

### 3.2 ChatMessage 结构调整（frontend `hooks/useChat.ts`）

```ts
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  // —— 新增 ——
  blocks: MessageBlock[]
  // —— 保留（独立通道，不变）——
  thinkingContent?: string
  hasThinking?: boolean
  isThinkingExpanded?: boolean
  thoughtDurationMs?: number
  // —— 保留（与 tool 无关的既有字段）——
  attachments?: ChatAttachment[]
  artifacts?: ChatArtifact[]
  createdAt: number
  todos?: …
  // —— 可选：group 折叠态 ——
  toolGroupCollapsed?: boolean
  // —— 废弃字段（见第 9 章迁移）——
  // content?: string     // 迁移期临时保留为 readonly getter
  // errors?: string[]    // 迁移期完全移除
  // toolCalls?: …        // 迁移期完全移除
}
```

### 3.3 Block append / patch 规则（核心不变式）

| 事件 | 操作 |
|---|---|
| 第一个 `text_delta`（或前一个 block 不是 text） | push 新 `MessageTextBlock`，content = delta |
| 后续 `text_delta`（前一个 block 是 text） | 找到最后一个 block（必为 text），content += delta |
| `tool_call_start` | push `MessageToolCallBlock { status: 'running', startedAt: now }` |
| `tool_call_delta`（args 流式） | 找到对应 id 的 block，merge args |
| `tool_call_end` (success) | 找到对应 id 的 block，patch `{ status: 'success', result, endedAt: now }` |
| `tool_call_end` (error) | 找到对应 id 的 block，patch `{ status: 'error', errorMessage, errorDetail, endedAt: now }` |
| `thinking_delta` | **不进 blocks**，累加到 `thinkingContent`（保持现状） |

**不变式**：
- `blocks` 数组**只能尾部 push 和按 id patch，不能 reorder / 不能从中间删**
- text block 相邻两个永远合并为一个（保证渲染时 Markdown 不被 tool 切分污染）
- tool_call id 唯一，patch 通过 id 匹配（不用 index，因为 index 会因为前置 text block 插入而错位）

## 4. 后端契约确认（已探查，当前 `tool_call_*` 不存在）

### 4.1 探查结论

- `shared/src/ws-events.ts` 当前只定义了 `tool_state`，没有 `tool_call_start | tool_call_delta | tool_call_end`
- `backend/src/runtime/session-runtime-service.ts` 当前只通过 `emitToolState()` 向前端广播工具生命周期；payload 不含 `toolCallId`，`end` 也不带原始 `result`
- `backend/src/agent/provider-stream-debug.ts` 与 `@mariozechner/pi-ai` 类型都确认：上游 provider 流里确实存在 `toolcall_start | toolcall_delta | toolcall_end`
- `@mariozechner/pi-agent-core` 的 `tool_execution_start | tool_execution_end` 也都自带 `toolCallId`
- 结论：本章原先列出的三个事件在**当前 WebSocket 契约里并不存在**；能力在上游和 runtime 内部都已经有，只是没有透传给前端

### 4.2 当前后端真实广播契约（现状）

| Runtime 来源 | 当前广播到前端 | 当前 payload | 对 block 渲染的缺口 |
|---|---|---|---|
| `message_update.text_delta` / `thinking_delta` | `step_delta` | `stepId`, `stream`, `content` | 无 |
| `preamble` | `tool_state` `status: 'delta'` | `toolName`, `args`, `detail` | 与真正的 tool args 增量共用一个事件，语义混杂 |
| `confirm_required` | `tool_state` `status: 'delta'` | `toolName`, `args`, `summary='confirm required'`, `detail`, `isError=true` | 同上 |
| `message_update.toolcall_start` | 不广播 | 仅日志 | tool card 无法在模型决定调用时立刻出现 |
| `message_update.toolcall_delta` | `tool_state` `status: 'delta'` | `toolName`, `args` | 没有 `toolCallId`，同名工具无法稳定 patch |
| `message_update.toolcall_end` | 不广播 | 仅日志 | 最终 args 快照没有显式透传 |
| `tool_execution_start` | `tool_state` `status: 'start'` | `toolName`, `args` | 有真实 `toolCallId` 但被丢弃 |
| `tool_execution_end` | `tool_state` `status: 'end'` | `toolName`, `summary`, `detail`, `isError`, `generatedArtifacts`, `artifactTraceItems` | 没有 `toolCallId`；成功时没有原始 `result`；成功/失败共用松散 payload |

### 4.3 精确 diff：`shared/src/ws-events.ts`

把当前“单一 `tool_state` 承载所有工具生命周期”的契约拆成“block 生命周期专用事件 + 兼容保留的辅助事件”：

```diff
 export type ServerEventType =
   | 'session_bound'
   | 'session_restored'
   | 'run_state'
   | 'step_state'
   | 'step_delta'
   | 'todo_state'
   | 'pause_requested'
+  | 'tool_call_start'
+  | 'tool_call_delta'
+  | 'tool_call_end'
   | 'tool_state'
   | 'session_tool_result'
   | 'session_title_updated'
   | 'ping'
   | 'error'
```

```diff
 import type {
   ArtifactTraceItem,
   ChatAttachment,
   GeneratedFileArtifact,
   PausePacket,
+  RunId,
   SerializedTodoItem,
   SessionChannel,
   SessionKind,
   SessionMode,
   SessionRouteContext,
   SessionTitleSource,
   StepDeltaStream,
   StepId,
   StepKind,
   ThinkingConfig,
   WorkflowStatus,
 } from './session.js'
```

```diff
 export interface ServerEventPayloadMap {
+  tool_call_start: {
+    sessionKey: string
+    runId: RunId
+    stepId: StepId
+    toolCallId: string
+    toolName: string
+    args?: unknown
+  }
+  tool_call_delta: {
+    sessionKey: string
+    runId: RunId
+    stepId: StepId
+    toolCallId: string
+    toolName: string
+    args: unknown
+  }
+  tool_call_end:
+    | {
+        sessionKey: string
+        runId: RunId
+        stepId: StepId
+        toolCallId: string
+        toolName: string
+        status: 'success'
+        result: unknown
+        summary?: string
+        detail?: string
+        generatedArtifacts?: GeneratedFileArtifact[]
+        artifactTraceItems?: ArtifactTraceItem[]
+      }
+    | {
+        sessionKey: string
+        runId: RunId
+        stepId: StepId
+        toolCallId: string
+        toolName: string
+        status: 'error'
+        errorMessage: string
+        errorDetail?: string
+      }
   tool_state: {
     sessionKey: string
     runId: string
     stepId?: StepId
     toolName: string
```

补充约束：

- `tool_state` 本轮**不删除**，但语义收缩为辅助通道：只继续承载 `preamble` / `confirm_required` / 迁移期兼容逻辑
- `blocks` 渲染只消费 `tool_call_start | tool_call_delta | tool_call_end`
- `error` 事件继续只表示“整个 run 失败”，不再承载单个工具失败

### 4.4 精确 diff：`backend/src/runtime/session-runtime-service.ts`

#### 4.4.1 扩展 partial tool call 提取函数

当前 `extractPartialToolCall()` 只拿 `toolName` 和 `args`。这里要把 `toolCallId` 一并取出来，并且同时支持 `toolcall_start` / `toolcall_delta`：

```diff
-function extractPartialToolCall(event: AgentEvent): { toolName: string; args: unknown } | null {
-  if (event.type !== 'message_update' || event.assistantMessageEvent.type !== 'toolcall_delta') {
+function extractPartialToolCall(
+  event: AgentEvent,
+): { toolCallId: string; toolName: string; args: unknown } | null {
+  if (
+    event.type !== 'message_update'
+    || (
+      event.assistantMessageEvent.type !== 'toolcall_start'
+      && event.assistantMessageEvent.type !== 'toolcall_delta'
+    )
+  ) {
     return null
   }
 ...
-  const toolName = 'name' in toolCall ? (toolCall as { name?: unknown }).name : undefined
-  const args = 'arguments' in toolCall ? (toolCall as { arguments?: unknown }).arguments : undefined
-  if (type !== 'toolCall' || typeof toolName !== 'string') return null
+  const toolCallId = 'id' in toolCall ? (toolCall as { id?: unknown }).id : undefined
+  const toolName = 'name' in toolCall ? (toolCall as { name?: unknown }).name : undefined
+  const args = 'arguments' in toolCall ? (toolCall as { arguments?: unknown }).arguments : undefined
+  if (type !== 'toolCall' || typeof toolCallId !== 'string' || typeof toolName !== 'string') {
+    return null
+  }
 
   return {
+    toolCallId,
     toolName,
     args,
   }
 }
```

再补一个错误提取 helper，把 `tool_execution_end.result` 映射成前端需要的 `errorMessage`：

```ts
function extractToolErrorMessage(result: unknown): string | undefined {
  if (!result || typeof result !== 'object' || !('content' in result)) return undefined
  const content = (result as { content?: unknown }).content
  if (!Array.isArray(content)) return undefined
  const firstText = content.find(
    (item): item is { type: 'text'; text: string } =>
      Boolean(item)
      && typeof item === 'object'
      && 'type' in item
      && 'text' in item
      && (item as { type?: unknown }).type === 'text'
      && typeof (item as { text?: unknown }).text === 'string',
  )
  return firstText?.text.trim() || undefined
}
```

#### 4.4.2 新增三个专用 emitter

保留现有 `emitStepDelta()`；在 `emitToolState()` 旁边新增：

```ts
private emitToolCallStart(
  sessionKey: string,
  runId: RunId,
  stepId: StepId,
  toolCallId: string,
  toolName: string,
  args?: unknown,
): void

private emitToolCallDelta(
  sessionKey: string,
  runId: RunId,
  stepId: StepId,
  toolCallId: string,
  toolName: string,
  args: unknown,
): void

private emitToolCallEnd(
  sessionKey: string,
  runId: RunId,
  stepId: StepId,
  payload: ServerEventPayloadMap['tool_call_end'],
): void
```

#### 4.4.3 精确替换 `handleAgentEvent()` 分支

```diff
 if (event.type === 'preamble') {
   this.emitToolState(...) // 保持不变，辅助 UI 继续可见
   return
 }
 
 if (event.type === 'confirm_required') {
   this.emitToolState(...) // 保持不变，辅助 UI 继续可见
   return
 }
 
 if (event.type === 'message_update') {
+  if (event.assistantMessageEvent.type === 'toolcall_start') {
+    const partialToolCall = extractPartialToolCall(event)
+    if (partialToolCall) {
+      this.emitToolCallStart(
+        sessionKey,
+        runId,
+        step.stepId,
+        partialToolCall.toolCallId,
+        partialToolCall.toolName,
+        partialToolCall.args,
+      )
+    }
+    return
+  }
+
   if (event.assistantMessageEvent.type === 'text_delta' && event.assistantMessageEvent.delta) {
     this.emitStepDelta(...)
     return
   }
 
   if (event.assistantMessageEvent.type === 'thinking_delta' && event.assistantMessageEvent.delta) {
     this.emitStepDelta(...)
     return
   }
 
-  const partialToolCall = extractPartialToolCall(event)
-  if (partialToolCall) {
-    this.emitToolState(sessionKey, runId, step.stepId, 'delta', partialToolCall.toolName, {
-      args: partialToolCall.args,
-    })
-  }
+  if (event.assistantMessageEvent.type === 'toolcall_delta') {
+    const partialToolCall = extractPartialToolCall(event)
+    if (partialToolCall) {
+      this.emitToolCallDelta(
+        sessionKey,
+        runId,
+        step.stepId,
+        partialToolCall.toolCallId,
+        partialToolCall.toolName,
+        partialToolCall.args,
+      )
+    }
+    return
+  }
+
+  if (event.assistantMessageEvent.type === 'toolcall_end') {
+    const { toolCall } = event.assistantMessageEvent
+    this.emitToolCallDelta(
+      sessionKey,
+      runId,
+      step.stepId,
+      toolCall.id,
+      toolCall.name,
+      toolCall.arguments,
+    )
+    return
+  }
   return
 }
 
 if (event.type === 'tool_execution_start') {
   this.toolArgsByCallId.set(...)
-  this.emitToolState(sessionKey, runId, step.stepId, 'start', event.toolName, { args: event.args })
   return
 }
 
 if (event.type === 'tool_execution_end') {
   const detail = summarizeToolResultDetail(event.result)
   ...
-  this.emitToolState(sessionKey, runId, step.stepId, 'end', event.toolName, {
-    summary: event.isError ? 'tool error' : 'tool completed',
-    detail,
-    isError: event.isError,
-    generatedArtifacts,
-    artifactTraceItems,
-  })
+  if (event.isError) {
+    const errorMessage = extractToolErrorMessage(event.result) ?? detail ?? 'Tool execution failed'
+    this.emitToolCallEnd(sessionKey, runId, step.stepId, {
+      sessionKey,
+      runId,
+      stepId: step.stepId,
+      toolCallId: event.toolCallId,
+      toolName: event.toolName,
+      status: 'error',
+      errorMessage,
+      errorDetail: detail && detail !== errorMessage ? detail : undefined,
+    })
+    return
+  }
+
+  this.emitToolCallEnd(sessionKey, runId, step.stepId, {
+    sessionKey,
+    runId,
+    stepId: step.stepId,
+    toolCallId: event.toolCallId,
+    toolName: event.toolName,
+    status: 'success',
+    result: event.result,
+    summary: 'tool completed',
+    detail,
+    generatedArtifacts,
+    artifactTraceItems,
+  })
 }
```

这里有三个刻意的选择：

1. `toolcall_start / toolcall_delta / toolcall_end` 负责“模型声明了一个 tool call”
2. `tool_execution_end` 负责“这个 tool 真正执行完了，并且有 success/error 结果”
3. `tool_execution_start` 不再额外广播公共事件，避免和 provider 的 `toolcall_start` 双发同一个开始态

### 4.5 边界情况（按当前依赖实现写死）

- 同一个 step 内多次 tool call：`toolCallId` 在 `pi-ai ToolCall.id` 和 `pi-agent-core tool_execution_*` 中都已存在，前端应一律按 id patch，不再按 `toolName` 或 index 猜
- 同名工具重复调用：当前契约下做不到稳定区分；上面 diff 落地后可稳定区分
- tool 被用户后续消息打断：`pi-agent-core` 当前会把剩余调用映射成 `tool_execution_end.isError = true`，文本为 `Skipped due to queued user message.`；后端直接转成 `tool_call_end { status: 'error' }`
- `confirm_required`：仍然先发一条辅助 `tool_state delta` 给 UI 做“待确认”提示，随后被 `tool_execution_end.isError = true` 收敛为同一个 `tool_call_end error`
- `tool_execution_update`：当前 spec v1 不消费；如果后续要展示长时间运行中的实时 stdout / 进度，再单开 `tool_call_output_delta`
- `emitStepDelta()` 保持不变，thinking/text 继续走原通道，不进 tool block

## 5. 前端数据层（`hooks/useChat.ts`）

### 5.1 新增 helper 函数

在 useChat.ts 顶部附近添加：

```ts
import { nanoid } from 'nanoid' // 或项目现有 id 生成器

function appendTextDelta(blocks: MessageBlock[], delta: string): MessageBlock[] {
  const last = blocks[blocks.length - 1]
  if (last?.kind === 'text') {
    // 合并到最后一个 text block
    return [
      ...blocks.slice(0, -1),
      { ...last, content: last.content + delta },
    ]
  }
  // 前一个不是 text，新开一个
  return [...blocks, { kind: 'text', id: nanoid(), content: delta }]
}

function pushToolCallStart(
  blocks: MessageBlock[],
  payload: { toolCallId: string; toolName: string },
): MessageBlock[] {
  return [
    ...blocks,
    {
      kind: 'tool_call',
      id: payload.toolCallId,
      name: payload.toolName,
      status: 'running',
      startedAt: Date.now(),
    },
  ]
}

function patchToolCall(
  blocks: MessageBlock[],
  toolCallId: string,
  patch: Partial<MessageToolCallBlock>,
): MessageBlock[] {
  return blocks.map((b) =>
    b.kind === 'tool_call' && b.id === toolCallId ? { ...b, ...patch } : b,
  )
}
```

### 5.2 替换事件处理逻辑

定位现有 `step_delta`、`tool_state`（或等效）事件处理，改为：

```ts
case 'step_delta': {
  const delta = payload as ServerEventPayloadMap['step_delta']
  const messageId = ensureStepMessage(delta.stepId, delta.kind)
  if (!messageId) return
  const stream = delta.stream ?? 'text'
  
  updateMessage(setMessages, messageId, (message) => {
    if (stream === 'thinking') {
      // 思考通道不变
      return {
        ...message,
        hasThinking: true,
        thinkingContent: (message.thinkingContent ?? '') + delta.content,
      }
    }
    // text 通道 → 走 blocks
    return { ...message, blocks: appendTextDelta(message.blocks, delta.content) }
  })
  return
}

case 'tool_call_start': {
  const payload = … as ServerEventPayloadMap['tool_call_start']
  const messageId = ensureStepMessage(payload.stepId, 'assistant')
  if (!messageId) return
  updateMessage(setMessages, messageId, (message) => ({
    ...message,
    blocks: pushToolCallStart(message.blocks, {
      toolCallId: payload.toolCallId,
      toolName: payload.toolName,
    }),
  }))
  return
}

case 'tool_call_delta': {
  const payload = … as ServerEventPayloadMap['tool_call_delta']
  updateMessage(setMessages, messageId, (message) => ({
    ...message,
    blocks: patchToolCall(message.blocks, payload.toolCallId, {
      args: payload.args, // 全量快照；或做增量合并
    }),
  }))
  return
}

case 'tool_call_end': {
  const payload = … as ServerEventPayloadMap['tool_call_end']
  const patch: Partial<MessageToolCallBlock> = {
    endedAt: Date.now(),
    status: payload.status,
  }
  if (payload.status === 'success') {
    patch.result = payload.result
  } else {
    patch.errorMessage = payload.errorMessage
    patch.errorDetail = payload.errorDetail
  }
  updateMessage(setMessages, messageId, (message) => ({
    ...message,
    blocks: patchToolCall(message.blocks, payload.toolCallId, patch),
  }))
  return
}
```

### 5.3 用户交互回调

新增两个回调，通过 props 向下传递到 `ToolCallCard` / `ToolGroupCard`：

```ts
const handleToggleToolCall = useCallback(
  (messageId: string, blockId: string) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m
        return {
          ...m,
          blocks: m.blocks.map((b) =>
            b.kind === 'tool_call' && b.id === blockId
              ? { ...b, manualExpanded: !getEffectiveExpanded(b) }
              : b,
          ),
        }
      }),
    )
  },
  [],
)

const handleToggleToolGroup = useCallback((messageId: string) => {
  setMessages((prev) =>
    prev.map((m) =>
      m.id === messageId ? { ...m, toolGroupCollapsed: !m.toolGroupCollapsed } : m,
    ),
  )
}, [])
```

`getEffectiveExpanded` 见 6.4。

## 6. 前端渲染层

### 6.1 组件结构

```
MessageItem
  └── MessageBlocksRenderer          (新)
        ├── groupBlocks(blocks)      (helper)
        ├── TextBlock                (即现有 Markdown 渲染封装)
        ├── ToolGroupCard            (新，≥3 tool 时使用)
        │     └── ToolCallCard       (新)
        └── ToolCallCard             (新，<3 tool 时直接用)
```

### 6.2 `groupBlocks` helper

把 blocks 数组按"**连续的** tool_call 段"分组，便于判断是否启用聚合头：

```ts
type RenderGroup =
  | { kind: 'text'; block: MessageTextBlock }
  | { kind: 'tool_single'; block: MessageToolCallBlock }
  | { kind: 'tool_group'; blocks: MessageToolCallBlock[] }

const TOOL_GROUP_THRESHOLD = 3

function groupBlocks(blocks: MessageBlock[]): RenderGroup[] {
  const groups: RenderGroup[] = []
  let currentToolRun: MessageToolCallBlock[] = []
  
  const flush = () => {
    if (currentToolRun.length === 0) return
    if (currentToolRun.length >= TOOL_GROUP_THRESHOLD) {
      groups.push({ kind: 'tool_group', blocks: currentToolRun })
    } else {
      for (const b of currentToolRun) groups.push({ kind: 'tool_single', block: b })
    }
    currentToolRun = []
  }
  
  for (const b of blocks) {
    if (b.kind === 'tool_call') {
      currentToolRun.push(b)
    } else {
      flush()
      groups.push({ kind: 'text', block: b })
    }
  }
  flush()
  return groups
}
```

**注意**：聚合阈值只在**连续的** tool 段内判断。`tool-tool-text-tool-tool-tool` 的第二段是 3 个，前一段 2 个不聚合；这符合"模型多轮调用 vs 偶尔调用"的直觉。

### 6.3 `ToolCallCard` 组件

文件：`frontend/src/components/chat/ToolCallCard.tsx`

```tsx
interface ToolCallCardProps {
  block: MessageToolCallBlock
  onToggle: () => void
  /** 是否处于聚合头折叠态下（视觉简化）*/
  compact?: boolean
}

export function ToolCallCard({ block, onToggle, compact = false }: ToolCallCardProps) {
  const expanded = getEffectiveExpanded(block)
  const isRunning = block.status === 'running'
  const isError = block.status === 'error'
  const isSuccess = block.status === 'success'

  return (
    <div
      className={cn(
        'my-1 overflow-hidden transition-colors',
        isError && 'rounded-md border-l-2 border-destructive bg-destructive/5 pl-2.5 pr-2 py-1.5',
        !isError && 'rounded-md px-2 py-1 hover:bg-surface-raised/60',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-2 text-left text-[13px] text-text-secondary"
      >
        <ToolStatusIcon status={block.status} name={block.name} className="size-3.5 shrink-0" />
        <span className={cn('truncate', isError && 'text-destructive font-medium')}>
          {formatToolTitle(block)}
        </span>
        {block.endedAt && block.startedAt && (
          <span className="ml-auto shrink-0 text-text-muted text-[11px]">
            {formatDuration(block.endedAt - block.startedAt)}
          </span>
        )}
        <ChevronDown
          className={cn(
            'size-3.5 shrink-0 text-text-muted transition-transform',
            expanded && 'rotate-180',
          )}
        />
      </button>
      {expanded && (
        <div className="mt-1.5 border-l-2 border-border pl-2.5 text-[12.5px] leading-relaxed">
          <ToolCallBody block={block} />
        </div>
      )}
    </div>
  )
}

function getEffectiveExpanded(b: MessageToolCallBlock): boolean {
  if (b.manualExpanded !== undefined) return b.manualExpanded
  // 默认规则
  if (b.status === 'error') return true
  return false  // running / success 默认折叠
}

function formatToolTitle(b: MessageToolCallBlock): string {
  if (b.status === 'error') return `${b.name} 执行失败`
  if (b.status === 'running') return `正在执行 ${b.name}…`
  return b.name
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(ms / 1000).toFixed(1)}s`
}
```

### 6.4 `ToolCallBody` 展开内容

```tsx
function ToolCallBody({ block }: { block: MessageToolCallBlock }) {
  return (
    <div className="space-y-2 py-1">
      {block.status === 'error' && block.errorMessage && (
        <div className="text-destructive text-[12.5px]">{block.errorMessage}</div>
      )}
      {block.args !== undefined && (
        <details className="group">
          <summary className="cursor-pointer text-text-muted text-[11.5px] select-none">
            参数
          </summary>
          <pre className="mt-1 max-h-48 overflow-auto rounded bg-surface-raised px-2 py-1.5 text-[11.5px] font-mono">
            {safeStringify(block.args)}
          </pre>
        </details>
      )}
      {block.status === 'success' && block.result !== undefined && (
        <details>
          <summary className="cursor-pointer text-text-muted text-[11.5px] select-none">
            返回
          </summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded bg-surface-raised px-2 py-1.5 text-[11.5px] font-mono">
            {safeStringify(block.result)}
          </pre>
        </details>
      )}
      {block.errorDetail && (
        <details>
          <summary className="cursor-pointer text-text-muted text-[11.5px] select-none">
            详情
          </summary>
          <pre className="mt-1 max-h-64 overflow-auto rounded bg-destructive/5 px-2 py-1.5 text-[11.5px] font-mono text-destructive/90">
            {block.errorDetail}
          </pre>
        </details>
      )}
    </div>
  )
}

function safeStringify(v: unknown): string {
  try { return JSON.stringify(v, null, 2) } catch { return String(v) }
}
```

### 6.5 `ToolGroupCard` 聚合头组件

文件：`frontend/src/components/chat/ToolGroupCard.tsx`

```tsx
interface ToolGroupCardProps {
  blocks: MessageToolCallBlock[]
  collapsed: boolean
  onToggleGroup: () => void
  onToggleToolCall: (blockId: string) => void
}

export function ToolGroupCard({ blocks, collapsed, onToggleGroup, onToggleToolCall }: ToolGroupCardProps) {
  const summary = summarizeGroup(blocks)
  // 注意：即使 group 折叠，失败项仍然单独展开显示（见下方）
  const errorBlocks = blocks.filter((b) => b.status === 'error')
  const hasError = errorBlocks.length > 0

  return (
    <div className="my-2 rounded-md border border-border bg-surface-raised/40">
      <button
        type="button"
        onClick={onToggleGroup}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-text-secondary hover:bg-surface-raised/60"
      >
        <ChevronDown className={cn('size-3.5 transition-transform', !collapsed && 'rotate-180')} />
        <span className={cn('truncate', hasError && 'text-destructive font-medium')}>
          {summary}
        </span>
      </button>
      {!collapsed && (
        <div className="border-t border-border px-2 py-1">
          {blocks.map((b) => (
            <ToolCallCard
              key={b.id}
              block={b}
              onToggle={() => onToggleToolCall(b.id)}
            />
          ))}
        </div>
      )}
      {/* 聚合头折叠但有失败项 —— 失败项依然可见（关键 UX）*/}
      {collapsed && hasError && (
        <div className="border-t border-border px-2 py-1">
          {errorBlocks.map((b) => (
            <ToolCallCard key={b.id} block={b} onToggle={() => onToggleToolCall(b.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function summarizeGroup(blocks: MessageToolCallBlock[]): string {
  const byName = new Map<string, number>()
  let errorCount = 0
  for (const b of blocks) {
    byName.set(b.name, (byName.get(b.name) ?? 0) + 1)
    if (b.status === 'error') errorCount++
  }
  const parts: string[] = []
  for (const [name, count] of byName) parts.push(`${count} 次 ${name}`)
  const base = `调用了 ${blocks.length} 次工具：${parts.join('、')}`
  return errorCount > 0 ? `${base}（${errorCount} 次失败）` : base
}
```

**关键 UX 规则**：聚合头折叠时，**失败子卡片依然保留显示**（第二个 `{collapsed && hasError && ...}` 块），用户无法通过折叠头"隐藏失败"。这是失败 first-class 原则的落地。

### 6.6 `MessageBlocksRenderer` 集成

文件：`frontend/src/components/chat/MessageBlocksRenderer.tsx`

```tsx
interface MessageBlocksRendererProps {
  blocks: MessageBlock[]
  toolGroupCollapsed: boolean
  onToggleToolCall: (blockId: string) => void
  onToggleToolGroup: () => void
}

export function MessageBlocksRenderer({
  blocks,
  toolGroupCollapsed,
  onToggleToolCall,
  onToggleToolGroup,
}: MessageBlocksRendererProps) {
  const groups = groupBlocks(blocks)
  return (
    <>
      {groups.map((g, i) => {
        if (g.kind === 'text') {
          return <TextBlock key={g.block.id} content={g.block.content} />
        }
        if (g.kind === 'tool_single') {
          return (
            <ToolCallCard
              key={g.block.id}
              block={g.block}
              onToggle={() => onToggleToolCall(g.block.id)}
            />
          )
        }
        return (
          <ToolGroupCard
            key={`group-${g.blocks[0].id}`}
            blocks={g.blocks}
            collapsed={toolGroupCollapsed}
            onToggleGroup={onToggleToolGroup}
            onToggleToolCall={onToggleToolCall}
          />
        )
      })}
    </>
  )
}
```

`TextBlock` 就是现有 Markdown 渲染的抽薄封装（把 MessageItem 里原 content 渲染部分提出来），接受 `content: string`。

### 6.7 `MessageItem` 改造

在 assistant 消息分支里，把现有"content markdown + errors 末尾堆叠"的渲染替换为：

```tsx
<MessageBlocksRenderer
  blocks={message.blocks}
  toolGroupCollapsed={message.toolGroupCollapsed ?? false}
  onToggleToolCall={(blockId) => onToggleToolCall?.(message.id, blockId)}
  onToggleToolGroup={() => onToggleToolGroup?.(message.id)}
/>
```

同时 props 增加 `onToggleToolCall`、`onToggleToolGroup`，从 `MessageList` 透传，由 `useChat` 提供。

## 7. 交互规范

| 场景 | 行为 |
|---|---|
| 首次出现 running 态 tool | 折叠态 + spinner 图标；标题 "正在执行 {name}…" |
| running → success | 标题改为 `{name}`，加显耗时；**保持折叠**，不抖动 |
| running → error | 自动展开，红色边框 + 错误摘要；`manualExpanded` 留空 |
| 用户点击失败 tool 头 | 切换 `manualExpanded`（可手动折叠） |
| 用户点击成功 tool 头 | 切换 `manualExpanded`（手动展开看参数/返回） |
| 聚合头出现条件 | 连续 ≥3 个 tool_call block |
| 聚合头默认态 | 展开（`toolGroupCollapsed: false`） |
| 用户折叠聚合头 | 所有成功项隐藏，**失败项仍显示** |
| 用户重新展开聚合头 | 所有子 tool 卡片按各自默认规则展开/折叠 |
| 消息刚生成 vs 历史消息 | 一视同仁，规则相同 |
| 流式中的 spinner | `Loader2` with `animate-spin`，运行时间 >1s 时在标题尾部加显 "(已执行 Xs)" |

## 8. 视觉规范

### 8.1 图标映射（`ToolStatusIcon`）

```tsx
function ToolStatusIcon({ status, name, className }: ...) {
  if (status === 'running') return <Loader2 className={cn(className, 'animate-spin')} />
  if (status === 'error') return <XCircle className={cn(className, 'text-destructive')} />
  // success → 按 tool name 分发
  const Icon = pickToolIcon(name)
  return <Icon className={className} />
}

function pickToolIcon(name: string) {
  if (/sql|query|db/i.test(name)) return Database
  if (/file|read|write/i.test(name)) return FileText
  if (/http|fetch|request/i.test(name)) return Globe
  if (/search/i.test(name)) return Search
  return Wrench // fallback
}
```

### 8.2 颜色 tokens（使用现有 `@theme` 变量，不新增）

| 元素 | Tailwind class |
|---|---|
| 成功卡片 hover | `hover:bg-surface-raised/60` |
| 失败卡片背景 | `bg-destructive/5` |
| 失败左边框 | `border-l-2 border-destructive` |
| 失败主色 | `text-destructive` |
| 聚合头背景 | `bg-surface-raised/40` |
| 聚合头边框 | `border border-border` |
| 展开区分隔线 | `border-l-2 border-border` |
| 耗时 / 次要文字 | `text-text-muted` `text-[11px]` |
| 卡片标题主色 | `text-text-secondary` `text-[13px]` |

如果 `destructive` token 还未定义，在 `index.css` `@theme` 中补：
- `--color-destructive: #dc2626;`（light）
- `.dark { --color-destructive: #f87171; }`

### 8.3 尺寸 / 间距

- 单 tool 卡片 padding：`px-2 py-1`（总高约 28-32px）
- 单 tool 卡片 margin：`my-1`
- 聚合头 padding：`px-3 py-2`
- 聚合头 margin：`my-2`
- 失败卡片 padding：`px-2.5 py-1.5`（比成功略大，强调感）
- 标题字号：`text-[13px]`
- 展开体字号：`text-[12.5px]`

## 9. 迁移与兼容

### 9.1 历史消息

历史消息（从服务端加载时）可能包含旧结构：`content: string` + `errors?: string[]` + `toolCalls?: …`。

在 `useChat.ts` 加载消息的那一层（`loadMessages` / `hydrateMessage` 等入口）添加迁移函数：

```ts
function migrateLegacyMessage(raw: LegacyChatMessage): ChatMessage {
  if (raw.blocks && Array.isArray(raw.blocks)) return raw as ChatMessage
  
  const blocks: MessageBlock[] = []
  // 正文正常转 text block
  if (raw.content) {
    blocks.push({ kind: 'text', id: nanoid(), content: raw.content })
  }
  // 老的 errors 数组 —— 为了不丢信息，转成末尾 error 状态的 tool_call block
  if (raw.errors?.length) {
    for (const err of raw.errors) {
      blocks.push({
        kind: 'tool_call',
        id: nanoid(),
        name: 'unknown',
        status: 'error',
        errorMessage: err,
      })
    }
  }
  return {
    ...raw,
    blocks,
    content: undefined,
    errors: undefined,
    toolCalls: undefined,
  } as ChatMessage
}
```

调用路径：所有从 server 加载 / WebSocket `message_history` 事件进入的消息，过一次 `migrateLegacyMessage`。

### 9.2 服务端持久化

消息落库格式是否改：
- **短期**：不改，持久化层仍存 `content` / `errors`，前端发送到服务端前也做一次 `blocksToLegacy` 反向序列化
- **长期**：若项目已决定用 blocks 作为 canonical 表示，数据库迁移另议（不在本 spec 范围）

前端→后端的新消息（如"重发"）只需要送 user text，不涉及 blocks。

### 9.3 类型迁移守卫

在 `ChatMessage` 类型中将 `content` / `errors` / `toolCalls` 标 deprecated：

```ts
/** @deprecated 请使用 blocks 数组 */
content?: string
/** @deprecated 请使用 blocks 数组中的 tool_call error block */
errors?: string[]
/** @deprecated 请使用 blocks 数组中的 tool_call block */
toolCalls?: never
```

编译期不强制删除，防止周边代码（例如 session store、持久化适配）破裂；所有**新代码**禁止读写这三个字段。

## 10. 测试要点

### 10.1 单元（优先）

- `appendTextDelta`：连续 delta 合并；插入 tool 后新 text delta 新开 block
- `patchToolCall`：找到正确 id 并 patch；id 不存在时不修改数组
- `groupBlocks`：阈值边界（2 vs 3）；非连续 tool 段不聚合
- `summarizeGroup`：多 tool name 统计；失败计数
- `getEffectiveExpanded`：manualExpanded 优先；error 默认展开；success/running 默认折叠
- `migrateLegacyMessage`：content-only / errors-only / 同时有 / 已是新结构（幂等）

### 10.2 组件（`@testing-library/react`）

- `ToolCallCard` running 态：显示 spinner，点击切换展开
- `ToolCallCard` error 态：默认展开，点击可折叠
- `ToolGroupCard` 折叠态：隐藏成功项但**保留失败项**
- `ToolGroupCard` 展开态：所有子 tool 按各自规则

### 10.3 手动回归

- 发一条会触发 3+ tool call 且至少 1 次失败的查询，肉眼验证：
  - 聚合头出现
  - 失败卡片默认展开、红边
  - 正文在 tool 群之后
  - 流式过程中贴底不中断（回归 #1）
  - 思考区展示正常（不干扰）
- 切换旧消息会话：迁移后显示正常，不崩
- dark mode 下所有颜色对比度达标

## 11. 分阶段落地

| 阶段 | 范围 | 目的 |
|---|---|---|
| **P0** | §3 数据结构 + §5 useChat 事件处理 + §6.3/6.4/6.6/6.7 基础渲染（无聚合头） + §9 迁移 | 最小可用，tool 能按时序渲染；<3 tool 时直接平铺 |
| **P1** | §6.2 groupBlocks + §6.5 ToolGroupCard + §7 完整交互规范 | 启用聚合头 |
| **P2** | §10.2/10.3 完整测试 + dark mode 细调 + 耗时格式化微调 | 打磨 |

建议 Codex 一次性完成 P0+P1；P2 在 P0+P1 验收通过后再做。

## 12. 验收标准（必须全部通过）

- [ ] 历史消息加载后显示正常，不崩、不丢信息
- [ ] 新消息流式过程：tool_call_start 立即出现 spinner 卡片
- [ ] tool_call_end success：spinner 变图标，耗时出现，保持折叠
- [ ] tool_call_end error：卡片自动展开，红边 + 错误摘要
- [ ] 用户点击任意 tool 头可切换展开/折叠态（包括失败项）
- [ ] 单消息 3+ tool call 时聚合头出现，<3 时直接平铺
- [ ] 聚合头折叠时成功项隐藏、失败项仍显示
- [ ] 聚合头展开/折叠状态随消息保存（切换会话再回来态一致）
- [ ] 正文 markdown 渲染无变化
- [ ] 思考区（Sparkles 折叠栏）行为无变化
- [ ] 流式贴底逻辑（#1 修复）无回归
- [ ] dark mode 下所有颜色对比度可读
- [ ] TypeScript 严格模式无新 error / warning

## 13. 风险与注意点

| 风险 | 应对 |
|---|---|
| 后端事件契约不完整（无独立 tool_call_end 或错误不带 id） | 先补后端（第 4 章），再做前端；不要用 index 匹配 |
| 流式中 `tool_call_delta` args 量大导致渲染卡顿 | Body 里用 `<details>` 懒渲染 `<pre>`；args 展开才格式化 |
| `messages` 引用每次更新都变，与 #1 滚动 effect 联动 | 已验证不受影响（Effect 2 依赖 messages 是期望行为）|
| 老会话落库格式多样（可能有 errors 字段也有 content 字段混用） | migrateLegacyMessage 做幂等处理，未知字段忽略 |
| 未知 tool name 图标 fallback | 使用 `Wrench` 兜底，保证视觉不崩 |
| 聚合头里 `errorBlocks` 顺序 | 按原 blocks 顺序 filter，不 reorder，保留用户对时序的直觉 |
| error 没有 `errorMessage` 字段 | 渲染用 `block.errorMessage ?? '未知错误'` 兜底 |
| 模型输出 `args` 是字符串（非对象） | `safeStringify` 已兜底；考虑 JSON.parse 失败路径 |

## 14. 明确的不做项（避免 Codex 越权）

- 不重写 Markdown 渲染器
- 不重写 thinking 区域
- 不改 #1 滚动逻辑
- 不改后端 pi-ai 层 / vLLM 层
- 不改持久化 schema
- 不加 tool 调用的筛选 / 搜索 / 导出功能
- 不加 tool 调用重试按钮
- 不加耗时精细到微秒 / 时间戳 tooltip（P2+ 再议）

---

## 给 Codex 的一句话总结

> 把消息渲染从"content + errors 两轴"重构成"blocks 时序一轴"；新增 `ToolCallCard` / `ToolGroupCard`；聚合阈值 3，失败始终 first-class；`useChat` 事件处理按 id patch blocks；迁移旧消息到新结构；不动思考区、不动滚动、不动 Markdown。P0 交付最小可用（无聚合头），P1 加聚合头。

---
