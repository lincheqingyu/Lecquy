# Tool Call Block Rendering · 第二轮整改 Spec（v2）

> 本 spec 用于 Codex 顺序执行。请严格按 P0 → P1 → P2 → P3 分阶段提交，每阶段独立可验证、独立可回滚。

## 0. 背景与决策摘要

第一轮实现后发现 5 项 UX 偏差（见第一轮 review）。用户最终决策：

- 问题 #3（tool 之间的正文处理）→ **方案 A**：Narration 合并进 tool group 顶部（Claude Code 风格）
- 问题 #5（实时 vs 重载不一致）→ **快速止血 + 中期修复并行**

本 spec 将四批改动合并为 4 个提交（P0/P1/P2/P3），每批内部强调最小 diff、无回归。

## 1. 改动约束（所有阶段通用）

1. 仅动 `frontend/src/components/chat/ToolCallCard.tsx`、`ToolGroupCard.tsx`、`MessageItem.tsx`、`frontend/src/lib/message-blocks.ts`、`shared/src/session.ts`、以及后端落库合并点（P3 指明）。
2. 不改 `useChat.ts` 的 WebSocket 事件入库路径（P0/P1/P2 阶段），P3 如需后端落库补全由后端侧同步改动。
3. 视觉 token 一律走现有 `text-text-*` / `border-border` / `bg-user-bubble` 等语义 token；**禁止**再引入 `surface-raised` 类外壳色。
4. 图标只允许用 lucide-react，不新增库。
5. 保持中文注释、英文命名（见 `.claude/rules/language.md`）。

## 2. P0 · Tool 卡片 UI 简化（问题 #1 / #2 / #4）

### 目标

- 删除参数/返回值展示（#1）
- 外壳与正文同层，取消 hover 反色（#2）
- 成功态去"勾选"观感，失败态保留醒目但轻量（#4）

### 2.1 `frontend/src/components/chat/ToolCallCard.tsx`

**整体改写后的目标形态**：

- 成功态/运行态：**单行**（图标 + 标题 + 耗时），不可展开、无 chevron
- 失败态：**默认展开一次错误消息**；存在 `errorDetail` 时保留 chevron 以查看详情，否则去 chevron
- 永远不显示 `args` / `result`

#### 2.1.1 删除内容

- 删除 `ToolCallBody` 组件（L48-83）整块
- 删除 `safeStringify`（L16-22）
- 删除 import：`AlertCircle` 保留；`CheckCircle2` 删除；新增 `Wrench`（已有，保留）

#### 2.1.2 `formatToolTitle` 调整

```ts
function formatToolTitle(block: MessageToolCallBlock): string {
  if (block.status === 'running') return `正在调用 ${block.name}`
  if (block.status === 'error')   return `${block.name} 执行失败`
  if (block.status === 'unknown') return `已调用 ${block.name}`   // ← P2 阶段启用
  return `已调用 ${block.name}`
}
```

> P0 阶段不必加 `unknown` 分支，P2 再补。但统一文案为"已调用 xxx"，避免与"思考完成"共用 CheckCircle2 的视觉混淆。

#### 2.1.3 `ToolStatusIcon` 调整

```tsx
function ToolStatusIcon({ block }: { block: MessageToolCallBlock }) {
  if (block.status === 'running') {
    return <LoaderCircle className="size-3.5 shrink-0 animate-spin text-text-muted" />
  }
  if (block.status === 'error') {
    return <AlertCircle className="size-3.5 shrink-0 text-[#b44a4a] dark:text-[#f2b8b8]" />
  }
  // success / unknown 均用 Wrench，与"勾选"语义区分
  return <Wrench className="size-3.5 shrink-0 text-text-muted" />
}
```

#### 2.1.4 `getEffectiveToolCallExpanded` 语义收窄

只对"有可展开内容的错误卡"生效：

```ts
export function getEffectiveToolCallExpanded(block: MessageToolCallBlock): boolean {
  if (block.status !== 'error') return false
  if (typeof block.manualExpanded === 'boolean') return block.manualExpanded
  return true
}
```

#### 2.1.5 主体 JSX 简化

- 根 `div` 外壳：去掉 `hover:bg-surface-raised/60`
- 错误态外壳：改为左边线 + 极浅 tint

```tsx
return (
  <div
    className={clsx(
      'overflow-hidden',
      compact ? 'my-0.5' : 'my-1',
      isError
        ? 'border-l-2 border-[#b44a4a] bg-transparent pl-2.5 pr-1 py-1 dark:border-[#f2b8b8]'
        : 'py-1',
    )}
  >
    <button
      type="button"
      onClick={hasExpandable ? onToggle : undefined}
      disabled={!hasExpandable}
      className={clsx(
        'flex w-full items-center gap-2 text-left text-[13px] text-text-secondary',
        !hasExpandable && 'cursor-default',
      )}
    >
      <ToolStatusIcon block={block} />
      <span className={clsx('truncate', isError && 'font-medium text-[#b44a4a] dark:text-[#f2b8b8]')}>
        {formatToolTitle(block)}
      </span>
      {durationLabel && (
        <span className="ml-auto shrink-0 text-[11px] text-text-muted">{durationLabel}</span>
      )}
      {hasExpandable && (
        <ChevronDown
          className={clsx(
            'size-3.5 shrink-0 text-text-muted transition-transform',
            expanded && 'rotate-180',
          )}
        />
      )}
    </button>

    {expanded && isError && (
      <div className="mt-1 space-y-1 pl-5 text-[12.5px] leading-relaxed">
        {block.errorMessage && (
          <div className="text-[#8e3d3d] dark:text-[#f2b8b8]">{block.errorMessage}</div>
        )}
        {block.errorDetail && (
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap text-[11.5px] text-text-muted">
            {block.errorDetail}
          </pre>
        )}
      </div>
    )}
  </div>
)
```

其中：

```ts
const hasExpandable = block.status === 'error' && Boolean(block.errorMessage || block.errorDetail)
```

### 2.2 `frontend/src/components/chat/ToolGroupCard.tsx`

#### 目标形态

- 去掉"卡片外壳"观感：没有圆角大块、没有反色背景
- 仅保留左侧细线 + 行高适中的折叠头
- 展开区不再给二级背景，纯粹列项

#### 具体 diff

```diff
-    <div className="my-2 overflow-hidden rounded-2xl border border-border bg-surface-raised/40">
+    <div className="my-2 border-l-2 border-border pl-2">
       <button
         type="button"
         onClick={onToggleGroup}
-        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-text-secondary transition-colors hover:bg-surface-raised/60"
+        className="flex w-full items-center gap-2 py-1 text-left text-[13px] text-text-secondary"
       >
         <ChevronDown
           className={clsx(
             'size-3.5 shrink-0 transition-transform',
             !collapsed && 'rotate-180',
           )}
         />
         <span className={clsx('truncate', hasError && 'font-medium text-[#b44a4a] dark:text-[#f2b8b8]')}>
           {summarizeGroup(blocks)}
         </span>
       </button>

       {!collapsed && (
-        <div className="border-t border-border px-2 py-2">
+        <div className="mt-0.5">
           {blocks.map((block) => (
             <ToolCallCard
               key={block.id}
               block={block}
               compact
               onToggle={() => onToggleToolCall(block.id)}
             />
           ))}
         </div>
       )}
     </div>
```

> 注：P1 会在此基础上再加 narration 位。P0 先只做视觉降噪。

### 2.3 验收标准（P0）

1. 打开一条含 skill/execute_sql 的历史消息，tool 卡片单行显示"已调用 execute_sql"，无 chevron、无参数、无结果、无 hover 反色。
2. 失败的 tool 卡默认展开错误消息，左侧有细红线；不存在 `errorDetail` 时 chevron 不出现。
3. 多个连续 tool 调用被 `ToolGroupCard` 聚合时，聚合头不再是胶囊卡片，而是一行 + 左侧细线。
4. 明暗主题下所有颜色都使用现有 token；关键字搜索 `surface-raised` 在这两个文件中归零。

## 3. P1 · Narration 合并（问题 #3 方案 A）

### 目标

模型在 tool 调用**之间**产生的解释性正文（"我先查 A 再查 B 然后…"），不应作为最终答案气泡再次出现。
最终答案定义为：**最后一个 tool_call 之后的连续 text block 序列**。其余 text block 即 narration。

### 3.1 `frontend/src/lib/message-blocks.ts`

#### 3.1.1 扩展类型

```ts
export type RenderGroup =
  | { kind: 'text'; block: MessageTextBlock }
  | { kind: 'tool_single'; block: MessageToolCallBlock; narration?: MessageTextBlock[] }
  | { kind: 'tool_group'; blocks: MessageToolCallBlock[]; key: string; narration?: MessageTextBlock[] }
```

> 约定：`narration` 是该 tool_single / tool_group **紧邻之前**的 text block 集合（按原顺序），尚未归入最终答案。

#### 3.1.2 `groupMessageBlocks` 重构

```ts
export function groupMessageBlocks(blocks: MessageBlock[]): RenderGroup[] {
  // 先定位"最后一个 tool_call"的下标
  let lastToolIndex = -1
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].kind === 'tool_call') {
      lastToolIndex = i
      break
    }
  }

  const groups: RenderGroup[] = []
  let pendingNarration: MessageTextBlock[] = []
  let currentToolBlocks: MessageToolCallBlock[] = []

  const flushToolBlocks = () => {
    if (currentToolBlocks.length === 0) {
      // 如果有悬空 narration 但无 tool，说明全部 text 都是 final answer，由外层 loop 追加
      return
    }
    const narration = pendingNarration.length > 0 ? pendingNarration : undefined
    if (currentToolBlocks.length >= TOOL_GROUP_THRESHOLD) {
      groups.push({
        kind: 'tool_group',
        blocks: currentToolBlocks,
        key: getToolGroupKey(currentToolBlocks),
        narration,
      })
    } else if (currentToolBlocks.length === 1) {
      groups.push({ kind: 'tool_single', block: currentToolBlocks[0], narration })
    } else {
      // 2 个 tool：仍按 single 展示，但只把 narration 挂到第一个
      currentToolBlocks.forEach((block, index) => {
        groups.push({
          kind: 'tool_single',
          block,
          narration: index === 0 ? narration : undefined,
        })
      })
    }
    currentToolBlocks = []
    pendingNarration = []
  }

  blocks.forEach((block, index) => {
    if (block.kind === 'tool_call') {
      currentToolBlocks.push(block)
      return
    }

    // block.kind === 'text'
    if (lastToolIndex >= 0 && index > lastToolIndex) {
      // 最后一个 tool 之后 → final answer，直接作为 text group
      flushToolBlocks()
      groups.push({ kind: 'text', block })
      return
    }

    if (lastToolIndex < 0) {
      // 整条消息没有 tool → 直接作为正文
      groups.push({ kind: 'text', block })
      return
    }

    // tool 之间/之前的 text → narration，先缓存
    if (currentToolBlocks.length > 0) {
      // 当前正在收集一批 tool，遇到 text：先 flush 再把 text 作为下一批的 narration
      flushToolBlocks()
    }
    pendingNarration.push(block)
  })

  flushToolBlocks()
  return groups
}
```

> 语义梳理：
>
> - `lastToolIndex < 0`：没有 tool，所有 text 正常渲染。
> - `index > lastToolIndex`：final answer，独立 text group。
> - 其它 text：narration，挂到紧邻其后的 tool_single / tool_group 顶部。
> - 如果某条消息"只有 narration、没有最终 text 块"（极少见），narration 仍然附在最后那个 tool_group 上，不丢失内容。

### 3.2 `ToolGroupCard` / `ToolCallCard` 的 narration props

#### 3.2.1 共用 narration 渲染器（放到 `ToolCallCard.tsx` 顶部，export 给 group 复用）

```tsx
import type { MessageTextBlock } from '../../lib/message-blocks'

interface NarrationProps {
  blocks: MessageTextBlock[]
  forceVisible?: boolean  // 对失败 tool，前置 narration 会强制展示
}

export function ToolNarration({ blocks, forceVisible }: NarrationProps) {
  if (!blocks.length) return null
  return (
    <div
      className={clsx(
        'mb-1 space-y-1 text-[12.5px] leading-relaxed',
        forceVisible ? 'text-text-secondary' : 'text-text-muted',
      )}
    >
      {blocks.map((block) => (
        <div key={block.id} className="whitespace-pre-wrap">{block.content}</div>
      ))}
    </div>
  )
}
```

> 首版用纯文本渲染（不走 markdown），避免 narration 里的标题/引用覆盖正文观感。如后续模型会在 narration 里贴代码块，再升级到简化 markdown。

#### 3.2.2 `ToolGroupCard` 接收并渲染

```diff
 interface ToolGroupCardProps {
   blocks: MessageToolCallBlock[]
   collapsed: boolean
+  narration?: MessageTextBlock[]
   onToggleGroup: () => void
   onToggleToolCall: (blockId: string) => void
 }
```

渲染位置：**在折叠头之前**（narration 属于 tool 链路的前置解释，放在最上层最贴合 Claude Code 的时序）。

```tsx
return (
  <div className="my-2 border-l-2 border-border pl-2">
    {narration && <ToolNarration blocks={narration} />}
    <button ...>
      ...
    </button>
    {!collapsed && (...)}
  </div>
)
```

#### 3.2.3 `ToolCallCard`（tool_single）也接收 narration

```diff
 interface ToolCallCardProps {
   block: MessageToolCallBlock
+  narration?: MessageTextBlock[]
   onToggle: () => void
   compact?: boolean
 }
```

渲染位置：同样在按钮之前。对失败 tool，`forceVisible` 设 `true`：

```tsx
return (
  <div className={...}>
    {narration && <ToolNarration blocks={narration} forceVisible={block.status === 'error'} />}
    <button ...>
      ...
    </button>
    ...
  </div>
)
```

### 3.3 `MessageItem.tsx` 渲染层接线

```diff
           if (group.kind === 'tool_single') {
             return (
               <ToolCallCard
                 key={group.block.id}
                 block={group.block}
+                narration={group.narration}
                 onToggle={() => onToggleToolCall?.(message.id, group.block.id)}
               />
             )
           }

           const collapsed = message.collapsedToolGroupKeys?.includes(group.key) ?? false
           return (
             <ToolGroupCard
               key={group.key}
               blocks={group.blocks}
+              narration={group.narration}
               collapsed={collapsed}
               onToggleGroup={() => onToggleToolGroup?.(message.id, group.key)}
               onToggleToolCall={(blockId) => onToggleToolCall?.(message.id, blockId)}
             />
           )
```

### 3.4 验收标准（P1）

1. "先查张三再查李四，发现王五未上线，最终回答：xxx" 这种消息：
   - final answer "xxx" 独占最后一个 text group，作为正文气泡展示
   - 前面的解释文字作为灰色 narration 出现在 tool_group 顶部
   - 不会在气泡里重复出现
2. 仅 1 次 tool 调用的消息：narration 挂在 `ToolCallCard` 顶部
3. 没有 tool 的纯文本消息：渲染完全不变
4. 失败 tool 的前置 narration（"我尝试查询张三的最新订单"）以 `text-text-secondary` 而非 muted 显示，强调与错误的因果
5. 历史加载 + 实时流式渲染结果结构完全一致（由 P2/P3 共同保证）

## 4. P2 · 问题 #5 快速止血（状态值加 unknown）

### 目标

从历史消息重载得到的 tool_call 目前被硬编码为 `status: 'success'`，导致：

- 显示"勾选"图标与"耗时"字段（耗时其实为 undefined 所以不显示，但语义仍错）
- 与实时流失败时走 `status: 'error'` 的真值路径不一致

中期前先让历史 tool 走"中性态"。

### 4.1 `frontend/src/lib/message-blocks.ts`

```diff
-export type ToolCallStatus = 'running' | 'success' | 'error'
+export type ToolCallStatus = 'running' | 'success' | 'error' | 'unknown'
```

```diff
     if (part.type === 'toolCall') {
       blocks = [...blocks, {
         kind: 'tool_call',
         id: part.id,
         name: part.name,
         args: part.arguments,
-        status: 'success',
+        status: 'unknown',
       }]
     }
```

### 4.2 UI 对 unknown 的处理

- `ToolCallCard.formatToolTitle`：unknown 与 success 共用"已调用 {name}"文案（见 P0 §2.1.2）
- `ToolStatusIcon`：unknown 与 success 共用 `Wrench` 图标（见 P0 §2.1.3）
- `ToolGroupCard.summarizeGroup`：补 unknown 分支

```ts
function summarizeGroup(blocks: MessageToolCallBlock[]): string {
  const runningCount = blocks.filter((b) => b.status === 'running').length
  const errorCount = blocks.filter((b) => b.status === 'error').length
  const unknownCount = blocks.filter((b) => b.status === 'unknown').length
  const successCount = blocks.filter((b) => b.status === 'success').length

  if (runningCount > 0) return `${blocks.length} 次工具调用，${runningCount} 个仍在执行`
  if (errorCount > 0)   return `${blocks.length} 次工具调用，${errorCount} 个失败`
  if (unknownCount === blocks.length) return `${blocks.length} 次工具调用`
  return `${blocks.length} 次工具调用，${successCount + unknownCount} 个已完成`
}
```

- `ToolGroupCard` 的错误标记 `hasError`：unknown 不算错

### 4.3 验收标准（P2）

1. 历史消息中所有 tool 卡文案为"已调用 xxx"，图标为 `Wrench`，无耗时、无展开
2. 实时流式里正常结束的 tool 仍显示 `success` 路径（一致使用 Wrench 图标文案"已调用 xxx"；若后续想区分可在 P3 之后重新决策，P0~P2 先统一）
3. 实时流式里失败的 tool 仍然保留左红线 + "执行失败" 文案

## 5. P3 · 问题 #5 中期修复（shared 类型 + 后端落库）

### 目标

从历史消息恢复时能拿到真实 status / errorMessage / durationMs，前端彻底不需要 `unknown`。

### 5.1 `shared/src/session.ts`

```diff
 export interface SessionToolCallContentBlock {
   readonly type: 'toolCall'
   readonly id: string
   readonly name: string
   readonly arguments: Record<string, unknown>
   readonly thoughtSignature?: string
+  // 工具执行完成后由后端回填；历史数据缺失时前端按 'unknown' 处理
+  readonly status?: 'success' | 'error'
+  readonly errorMessage?: string
+  readonly errorDetail?: string
+  readonly durationMs?: number
+  readonly startedAt?: number
+  readonly endedAt?: number
 }
```

> 字段全部 optional，向后兼容旧数据。

### 5.2 后端落库合并 `session_tool_finished`

**定位**：后端在 assistant message 持久化时，需要把对应 `SessionToolFinishedEntry` 的 status/detail/timestamps 合并进 `SessionToolCallContentBlock`。

**提示给 Codex**：

1. 全仓搜 `session_tool_finished` 的生产与消费点，定位当前落库逻辑（候选路径：`backend/src/session/**`、`backend/src/agent/**`）
2. 在 assistant message 组装阶段：以 `toolCall.id` 为键、查同 runId/stepId 内的 `session_tool_finished`，把：
   - `status: 'completed' → 'success'` / `'failed' → 'error'`
   - `detail → errorMessage`（failed 时）或 `errorDetail`（长文）
   - `startedAt / endedAt`（如事件有时间戳）合并为 `durationMs`
3. 若 `session_tool_invoked` 也带时间戳，用它作为 `startedAt`
4. 对**历史已落库**数据不做迁移，由前端 `unknown` 兜底

### 5.3 前端 `blocksFromAssistantContent` 升级

```ts
if (part.type === 'toolCall') {
  const startedAt = part.startedAt
  const endedAt = part.endedAt
  blocks = [...blocks, {
    kind: 'tool_call',
    id: part.id,
    name: part.name,
    args: part.arguments,
    status: part.status ?? 'unknown',
    errorMessage: part.errorMessage,
    errorDetail: part.errorDetail,
    startedAt,
    endedAt,
  }]
}
```

### 5.4 验收标准（P3）

1. 新会话完成一轮含失败 tool 的对话后，刷新页面：失败态、错误消息、耗时全部与实时流式一致
2. 旧会话（P3 上线前已落库）仍走 `unknown` 兜底，不报错、不报类型错
3. shared schema 无 breaking change（字段均 optional）

## 6. 执行顺序与提交建议

| 阶段 | 改动范围 | 风险 | 回滚粒度 |
| ---- | ---- | ---- | ---- |
| P0   | `ToolCallCard.tsx` / `ToolGroupCard.tsx` | 低（纯 UI） | 独立 commit |
| P1   | `message-blocks.ts` / `ToolCallCard.tsx` / `ToolGroupCard.tsx` / `MessageItem.tsx` | 中（groupMessageBlocks 语义变化） | 独立 commit |
| P2   | `message-blocks.ts` + 两个 Card 的 unknown 分支 | 低 | 独立 commit |
| P3   | `shared/src/session.ts` + 后端落库合并 + 前端回填 | 中（跨包） | 独立 commit，先 shared 再后端再前端 |

**建议提交信息**（中文）：

1. `fix(chat): 精简 tool 卡片外观并去除参数/返回展示`
2. `feat(chat): 将 tool 之间的解释文字合并为 tool group 前置 narration`
3. `fix(chat): 历史 tool 调用状态回退到 unknown 中性态`
4. `feat(chat): 后端落库 tool 调用结果状态，前端加载后可还原真实成功/失败`

## 7. 风险与注意点

1. **P1 语义边界**：如果模型在"最后一个 tool 之后"继续插入空白 text block（空 delta），要确保不被当成正文气泡。可在 `groupMessageBlocks` 之前过滤 `block.content.trim() === ''`（推荐在 `appendTextDelta` 层保持不变，只在 group 时跳过空块）。
2. **P1 2-tool 边界**：当 tool 数量 < THRESHOLD 时目前拆成多个 `tool_single`。本 spec 只把 narration 挂到第一个，若之后改成仍要聚合呈现，应把 2-tool 的 `tool_single` 改回 `tool_group` 或新增 `kind: 'tool_pair'`。
3. **P2 状态统一风险**：`unknown` 与 `success` 在 UI 上已经合并，意味着一旦后续想让 `success` 显示耗时（比如专门强调执行时间），需要反转此决定。若在 P3 完成后想区分，建议仅在 `success` 有 `durationMs` 时展示耗时。
4. **P3 跨包改动**：shared 包是类型源头，确保 `pnpm -r build` 能通过；前端 `tsc --noEmit` 必须过，避免字段扩散导致 downstream 类型错。
5. **narration markdown**：本 spec 首版不渲染 markdown，避免 narration 覆盖正文视觉。若用户反馈 narration 里有代码块/列表损失阅读性，再升级到 `renderMarkdown`。

## 8. 非目标（本轮不做）

- 不做 tool 调用的耗时柱状图 / 细粒度时间线（Claude Code 风格的第二层）
- 不做 tool args / result 的任何开关（哪怕 debug 模式）— 如需调试请走浏览器 devtools 或后端日志
- 不改 `useChat.ts` 的事件追加逻辑
- 不迁移旧会话数据
- 不处理 vLLM `</think>` 泄漏（已搁置）

## 9. 澄清（可选，不阻塞执行）

问题 #5 "实时 vs 重载不一致" 在快速止血后的残余现象，如仍存在请用户指出具体场景（历史 tool 顺序乱、narration 错位、某些工具的 args 仍被渲染等），再决定是否加一轮 P4。
