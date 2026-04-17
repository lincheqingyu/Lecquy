# 图表渲染问题交接文档

> 已过时：以后请优先查看 [`frontend/20260417-1-Markdown 渲染排障 技术规范.md`](./frontend/20260417-1-Markdown%20渲染排障%20技术规范.md)。
> 这份旧文档只保留迁移前问题背景，不再作为正式排障基线。

## 目标

在 AI 消息卡片中，把 ASCII 框图（`┌─┐│└─┘`）和树状图（`├── └──`）渲染成好看的内联样式，而不是代码块。

## 关键文件

- `frontend/src/components/chat/MessageItem.tsx` — 全部渲染逻辑都在这个文件
- `frontend/src/components/chat/MermaidBlock.tsx` — Mermaid 图表组件（已完成，无问题）
- `frontend/src/index.css` — 主题变量定义（深色/亮色）

## 当前已实现的组件

### 1. `isDiagramContent(text)` — 检测函数

检测文本是否包含 Box Drawing 字符（U+2500–U+257F），≥50% 非空行含此类字符则判定为图表。**此函数逻辑正确，无需修改。**

### 2. `DiagramBlock({ content })` — 图表渲染组件

将整块内容逐字符分段：Box Drawing 字符渲染为灰色（`text-text-muted/60`）且不可选中（`select-none`），文本保持正常颜色。使用 `<pre><code>` + `leading-none` 确保竖线连接。**此组件逻辑正确，无需修改。**

### 3. `MermaidBlock({ code })` — Mermaid 图表组件

处理 ` ```mermaid ` 代码块，异步渲染 SVG，支持深色模式切换。**此组件已完成，无问题。**

## 当前存在的 3 个 BUG（见截图标注）

### BUG 1：` ```markdown ` 代码块中的图表被 `MarkdownPreviewBlock` 包裹

**现象**：图表内容被 AI 输出在 ` ```markdown ` 围栏中时，会先被 `MarkdownPreviewBlock` 匹配，显示一个带 "MARKDOWN" 标签和复制按钮的外框。内部虽然能递归渲染出 DiagramBlock，但外层的 MARKDOWN 卡片壳是多余的。

**根因**：`renderMarkdown()` 中的匹配优先级问题（约第 672 行）：

```typescript
if (segment.language === 'markdown' || segment.language === 'md') {
  return <MarkdownPreviewBlock ... />  // ← 先匹配了这个
}
if (segment.language === 'mermaid') {
  return <MermaidBlock ... />
}
if (!segment.language && isDiagramContent(segment.content)) {
  return <DiagramBlock ... />  // ← 语言是 markdown，永远走不到这里
}
```

**修复方向**：在 `language === 'markdown'` 分支内，先检查 `isDiagramContent(segment.content)`，如果是图表就直接用 `DiagramBlock`，跳过 `MarkdownPreviewBlock`。

### BUG 2：框图仍然被拆分成多个独立块

**现象**：框图（用 `┌─┐│└─┘├┤─` 组成的表格型图）的每个区段之间被拆开渲染，竖线不连接，中间有大间距。

**根因**：`renderTextBlock()` 中的空行处理逻辑已经做了"允许 1 个空行延续"的修复，但可能不够——AI 可能输出 2+ 个空行，或者问题出在别处：框图被 `MarkdownPreviewBlock` 内的 `renderMarkdown()` → `renderTextBlock()` 处理时，`space-y-2` 给每个 `<div>` 加了 8px 间距。

**排查重点**：
1. 查看实际 AI 输出的原始文本，确认框图各行之间有几个空行
2. `renderTextBlock` 返回 `<div className="space-y-2">{nodes}</div>`，即使 DiagramBlock 内部行高紧凑，外层 space-y-2 会给多个连续 DiagramBlock 之间加间距
3. 如果框图被拆成多个 DiagramBlock（每个只有几行），它们之间的竖线自然无法连接

**修复方向**：
- 方案 A：加大空行容忍度（允许 2-3 个空行而非仅 1 个）
- 方案 B（推荐）：在 `splitMarkdownSegments` 层面就识别图表——如果一个 code segment 的内容是图表，直接标记为 `kind: 'diagram'`，这样不经过 renderTextBlock 的逐行处理，避免拆分问题
- 方案 C：在 `renderTextBlock` 中，改用前瞻（lookahead）策略——遇到空行时，向后扫描下一个非空行，如果仍是图表行则继续收集

### BUG 3：出现空的灰色块

**现象**：树状图和框图之间出现一个空的圆角灰色矩形。

**根因**：可能是一个空的 `DiagramBlock`（content 全是空行）或空的 `CodeBlock`（content 为空字符串）被渲染了出来。

**修复方向**：
- 在 `DiagramBlock` 组件开头加 `if (!content.trim()) return null`
- 在 `flushDiagram()` 中已有去尾部空行逻辑，但可能没覆盖"全部都是空行"的情况
- 检查 `CodeBlock` 是否也需要空内容保护

## 渲染流水线（帮助理解数据流）

```
AI 原始文本
  ↓
renderMarkdown(text)
  ↓ normalizeMarkdown → splitMarkdownSegments
  ↓
  ├── segment.kind === 'code'
  │     ├── language === 'markdown' → MarkdownPreviewBlock → 递归 renderMarkdown
  │     ├── language === 'mermaid'  → MermaidBlock
  │     ├── !language && isDiagram  → DiagramBlock  ← BUG1: markdown 围栏走不到这里
  │     └── 其他                    → CodeBlock
  │
  └── segment.kind === 'text'
        ↓ renderTextBlock(逐行处理)
        ├── 空行           → flushDiagram / flushTable / flushList  ← BUG2: 这里拆开了
        ├── Box Drawing 行 → 收集到 diagramLines[]
        ├── 表格行 (|...|)  → 收集到 tableLines[]
        ├── 列表行          → 收集到 listItems[]
        └── 普通文本行      → <p>
```

## 设计要求（用户明确提出）

1. 图表直接内联在消息流中，**不要**卡片/块容器（无边框、无背景、无 MARKDOWN 标签）
2. Box Drawing 字符（`├── └── │ ┌ ┐ └ ┘ ─`）显示为**灰色**，且**不可选中复制**
3. 文本内容保持正常颜色
4. 竖线 `│` 在相邻行之间**无间隙连接**（需要 `leading-none`）
5. 等宽字体确保对齐

## 开发环境

- Monorepo：pnpm workspace
- 前端：React 19 + Vite + Tailwind CSS 4
- TypeScript 严格模式（`tsc -b` 检查）
- 编译命令：`cd frontend && npx tsc -b`（沙箱无法跑 vite build，但 tsc 可以）
- 主题变量在 `frontend/src/index.css`，深色模式通过 `<html class="dark">` 切换
- 前端开发端口：`http://localhost:8000`（FRONTEND_PORT=8000）
