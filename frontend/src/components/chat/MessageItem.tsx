import clsx from 'clsx'
import { Check, ChevronDown, ChevronUp, Copy, ListTodo, RotateCcw, Sparkles } from 'lucide-react'
import { useEffect, useState, type FocusEvent, type ReactNode } from 'react'
import { MermaidBlock } from './MermaidBlock'
import type { ChatMessage } from '../../hooks/useChat'
import { buildAttachmentPreviewUrl } from '../../lib/chat-attachments'
import { blocksToText, groupMessageBlocks } from '../../lib/message-blocks'
import type { ChatAttachment } from '@lecquy/shared'
import { ArtifactCard } from '../artifacts/ArtifactCard'
import { ArtifactTrace } from '../artifacts/ArtifactTrace'
import {
  AttachmentFileCard,
  CHAT_ATTACHMENT_CARD_BODY_CLASS,
  CHAT_ATTACHMENT_CARD_PREVIEW_CLASS,
  CHAT_ATTACHMENT_CARD_SIZE_CLASS,
} from '../files/AttachmentFileCard'
import type { ChatArtifact } from '../../lib/artifacts'
import { ToolCallCard } from './ToolCallCard'
import { ToolGroupCard } from './ToolGroupCard'

interface MessageItemProps {
  message: ChatMessage
  isLastAssistant?: boolean
  onResendUser?: (messageId: string) => void
  onToggleThinking?: (messageId: string) => void
  onToggleTodo?: (messageId: string) => void
  onTogglePlanTask?: (messageId: string, todoIndex: number) => void
  onToggleToolCall?: (messageId: string, blockId: string) => void
  onToggleToolGroup?: (messageId: string, groupKey: string) => void
  onOpenAttachment?: (messageId: string, attachmentIndex: number, attachment: ChatAttachment) => void
  onOpenArtifact?: (messageId: string, artifactIndex: number, artifact: ChatArtifact) => void
  onDownloadArtifact?: (artifact: ChatArtifact) => void
  activeAttachmentKey?: string | null
}

const THOUGHT_TIMER_INTERVAL_MS = 100

function formatAttachmentMeta(attachment: ChatAttachment): string {
  const sizeLabel = attachment.size ? `${Math.max(1, Math.round(attachment.size / 1024))} KB` : null

  if (attachment.kind === 'image') {
    return sizeLabel ? `图片 · ${sizeLabel}` : '图片'
  }

  const mime = attachment.mimeType.toLowerCase()
  let typeLabel = '文档'
  if (mime.includes('pdf')) typeLabel = 'PDF'
  else if (mime.includes('wordprocessingml')) typeLabel = 'DOCX'
  else if (mime.includes('spreadsheetml') || mime.includes('ms-excel')) typeLabel = 'Excel'
  else if (mime.includes('markdown')) typeLabel = 'Markdown'
  else if (mime.includes('json')) typeLabel = 'JSON'
  else if (mime.startsWith('text/')) typeLabel = '文本'

  return sizeLabel ? `${typeLabel} · ${sizeLabel}` : typeLabel
}

/**
 * 检测文本是否为 ASCII 图表内容（框图或树状图）。
 * 框图使用 Unicode Box Drawing 字符（┌─┐│└─┘├┤┬┴┼ 等），
 * 树状图使用 ├──、└── 等缩进树形结构。
 *
 * 阈值放宽：只要有 ≥ 2 行包含图表字符，并且占比 ≥ 30%，即视为图表。
 * 原本 50% 阈值在"带解释性文字的树" 场景下容易失效（例如根节点 + 多行描述 + 少量分支行）。
 */
function isDiagramContent(text: string): boolean {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) return false

  // Box Drawing 区间 U+2500–U+257F 以及常见树状图模式
  const boxDrawingRegex = /[\u2500-\u257F]/
  const diagramLineCount = lines.filter(l => boxDrawingRegex.test(l)).length
  if (diagramLineCount < 2) return false
  return diagramLineCount >= lines.length * 0.3
}

function isStandaloneDiagramMarkdown(text: string): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  if (/(^|\n)\s*`{3,}/m.test(trimmed)) return false

  const hasMarkdownStructure = /(^|\n)\s*(#{1,6}\s+|---+\s*$|\*\*\*+\s*$|[-*]\s+|\d+\.\s+|>\s+|\|.+\|\s*$)/m.test(trimmed)
  if (hasMarkdownStructure) return false

  return isDiagramContent(trimmed)
}

/**
 * 图表块组件 —— 内联渲染 ASCII 框图和树状图。
 * - 简单盒子图改为结构化边框，避免中英混排导致右侧竖线错位
 * - 树状图改为 CSS 导线渲染，避免原始 │ 字符造成行距抖动
 * - 复杂 ASCII 图表保留等宽兜底展示
 */
interface ParsedTreeLine {
  depth: number
  label: string
  hasBranch: boolean
}

interface TreeDiagramNode {
  id: string
  label: string
  hasBranch: boolean
  children: TreeDiagramNode[]
}

function splitDiagramSections(content: string): string[][] {
  // 代码围栏行（``` 或 ```lang）在图表内容里视为视觉分隔符，避免它们被当成树节点文本
  const isFenceLine = (line: string) => /^`{3,}[^`]*$/.test(line.trim())
  return normalizeDiagramLines(content).reduce<string[][]>((groups, line) => {
    if (!line.trim() || isFenceLine(line)) {
      if (groups[groups.length - 1]?.length) groups.push([])
      return groups
    }
    if (!groups[groups.length - 1]) groups.push([])
    groups[groups.length - 1].push(line)
    return groups
  }, [[]]).filter(group => group.length > 0)
}

function normalizeDiagramLines(content: string): string[] {
  const rawLines = content.replace(/\r\n/g, '\n').split('\n')

  while (rawLines.length > 0 && !rawLines[0].trim()) rawLines.shift()
  while (rawLines.length > 0 && !rawLines[rawLines.length - 1].trim()) rawLines.pop()

  if (rawLines.length === 0) return []

  const minIndent = rawLines
    .filter(line => line.trim())
    .reduce((smallest, line) => {
      const indentMatch = line.match(/^[ \t]*/)
      const indentLength = indentMatch?.[0].length ?? 0
      return Math.min(smallest, indentLength)
    }, Number.POSITIVE_INFINITY)

  if (!Number.isFinite(minIndent) || minIndent <= 0) {
    return rawLines
  }

  return rawLines.map(line => line.slice(minIndent))
}

function extractBoxSectionContent(lines: string[]): string | null {
  if (lines.length < 3) return null

  const top = lines[0].trim()
  const bottom = lines[lines.length - 1].trim()

  const topIsBox = /^[┌╭][─━═\s]*[┐╮]$/.test(top)
  const bottomIsBox = /^[└╰][─━═\s]*[┘╯]$/.test(bottom)

  if (!topIsBox || !bottomIsBox) return null

  const middle = lines.slice(1, -1)
  if (middle.length === 0) return null

  const innerLines = middle.map((line) => {
    const trimmedEnd = line.trimEnd()
    const withoutLeft = trimmedEnd.replace(/^\s*[│┃]\s?/, '')
    const withoutRight = withoutLeft.replace(/\s?[│┃]\s*$/, '')
    return withoutRight.trimEnd()
  })

  return normalizeDiagramLines(innerLines.join('\n')).join('\n')
}

function buildBoxDiagram(content: string): string[] | null {
  const sections = splitDiagramSections(content)
  if (sections.length === 0) return null

  const innerContents = sections.map(extractBoxSectionContent)
  if (innerContents.some((section) => section == null)) {
    return null
  }

  return innerContents as string[]
}

function parseTreeLine(line: string): ParsedTreeLine | null {
  if (!line.trim()) return null

  let rest = line
  let depth = 0

  while (rest.startsWith('│   ') || rest.startsWith('    ')) {
    depth += 1
    rest = rest.slice(4)
  }

  const branchMatch = rest.match(/^([├└])(?:[─━═]{2,})\s?(.*)$/)
  if (branchMatch) {
    return {
      depth,
      hasBranch: true,
      label: branchMatch[2].trimEnd(),
    }
  }

  const paddedBranchMatch = rest.match(/^(\s+)([├└])(?:[─━═]{2,})\s?(.*)$/)
  if (paddedBranchMatch && paddedBranchMatch[1].length >= 2) {
    return {
      depth: depth + 1,
      hasBranch: true,
      label: paddedBranchMatch[3].trimEnd(),
    }
  }

  return {
    depth,
    hasBranch: false,
    label: rest.trim(),
  }
}

function buildTreeDiagram(content: string): TreeDiagramNode[][] | null {
  const sections = splitDiagramSections(content)
  if (sections.length === 0) return null

  let nodeId = 0
  const groups = sections.map((section) => {
    let parsedLines = section.map(parseTreeLine).filter((line): line is ParsedTreeLine => Boolean(line))
    const branchCount = parsedLines.filter(line => line.hasBranch).length
    if (parsedLines.length === 0 || branchCount === 0) return null

    // 根节点归并：若首行是 depth=0 且无分支字符的纯文本（例如 "Lecquy System"），
    // 后续存在 depth=0 的分支行，则把首行视作 root，其余行整体下沉一级，
    // 避免 root 与首层兄弟节点被渲染成平级列表。
    if (parsedLines.length >= 2) {
      const head = parsedLines[0]
      const restHasTopLevelBranch = parsedLines
        .slice(1)
        .some(line => line.depth === 0 && line.hasBranch)
      if (head.depth === 0 && !head.hasBranch && restHasTopLevelBranch) {
        parsedLines = [
          head,
          ...parsedLines.slice(1).map(line => ({ ...line, depth: line.depth + 1 })),
        ]
      }
    }

    const root: TreeDiagramNode = {
      id: 'root',
      label: '',
      hasBranch: false,
      children: [],
    }
    const stack: Array<{ depth: number; node: TreeDiagramNode }> = [{ depth: -1, node: root }]

    parsedLines.forEach((line) => {
      const normalizedDepth = Math.min(line.depth, Math.max(0, stack.length - 1))
      while (stack.length > normalizedDepth + 1) {
        stack.pop()
      }

      const node: TreeDiagramNode = {
        id: `tree-node-${nodeId++}`,
        label: line.label,
        hasBranch: line.hasBranch,
        children: [],
      }
      stack[stack.length - 1].node.children.push(node)
      stack.push({ depth: normalizedDepth, node })
    })

    return root.children
  })

  const validGroups = groups.filter((group): group is TreeDiagramNode[] => group != null && group.length > 0)
  return validGroups.length > 0 ? validGroups : null
}

function RawDiagramBlock({ content }: { content: string }) {
  const boxDrawingTest = /[\u2500-\u257F]/

  // 将整块内容逐字符分段：连续的绘图字符 vs 连续的普通字符（含换行）
  const segments: ReactNode[] = []
  let isBox = false
  let buffer = ''
  let key = 0

  const flush = () => {
    if (!buffer) return
    if (isBox) {
      segments.push(
        <span key={key++} className="text-text-muted/60 select-none" aria-hidden="true">{buffer}</span>,
      )
    } else {
      segments.push(<span key={key++}>{buffer}</span>)
    }
    buffer = ''
  }

  for (const char of content) {
    const charIsBox = boxDrawingTest.test(char)
    if (buffer && charIsBox !== isBox) flush()
    isBox = charIsBox
    buffer += char
  }
  flush()

  return (
    <pre className="overflow-x-auto whitespace-pre font-mono text-sm leading-relaxed text-text-primary">
      <code>{segments}</code>
    </pre>
  )
}

interface DiagramCopyControl {
  copied: boolean
  onCopy: () => void
}

function DiagramCard({
  children,
  copyControl,
}: {
  children: ReactNode
  copyControl?: DiagramCopyControl
}) {
  return (
    <div className="relative rounded-md border border-diagram-line px-6 py-5 pr-16">
      {copyControl ? (
        <button
          type="button"
          onClick={copyControl.onCopy}
          className={[
            'absolute right-3 top-3 inline-flex h-7 w-7 items-center justify-center rounded-md',
            'bg-surface text-text-primary transition-all hover:bg-surface-alt',
            'opacity-0 shadow-sm group-hover/diagram:opacity-100 group-focus-within/diagram:opacity-100',
          ].join(' ')}
          aria-label="复制图表"
          title="复制图表"
        >
          {copyControl.copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
      ) : null}
      {children}
    </div>
  )
}

function TreeNodeList({ nodes, showGuide }: { nodes: TreeDiagramNode[]; showGuide: boolean }) {
  return (
    <div className={clsx('space-y-0.5', showGuide && 'relative ml-1.5')}>
      {showGuide ? (
        <span
          aria-hidden="true"
          className="absolute bottom-[0.55rem] left-[7px] top-[0.95rem] w-px bg-diagram-line"
        />
      ) : null}
      {nodes.map(node => (
        <div key={node.id}>
          <div
            className={clsx(
              'relative whitespace-pre-wrap break-words font-mono text-sm leading-relaxed text-text-primary',
              showGuide && 'pl-[26px]',
            )}
          >
            {showGuide ? (
              <span
                aria-hidden="true"
                className="absolute left-[7px] top-[0.95rem] h-px w-[18px] bg-diagram-line"
              />
            ) : null}
            {renderInlineMarkdown(node.label)}
          </div>
          {node.children.length > 0 ? (
            <div className="pt-1">
              <TreeNodeList nodes={node.children} showGuide />
            </div>
          ) : null}
        </div>
      ))}
    </div>
  )
}

function TreeDiagramGroups({ groups }: { groups: TreeDiagramNode[][] }) {
  return (
    <div className="space-y-3">
      {groups.map((nodes, index) => {
        const showGuide = nodes.length > 0 && nodes.every(node => node.hasBranch)
        return <TreeNodeList key={`tree-group-${index}`} nodes={nodes} showGuide={showGuide} />
      })}
    </div>
  )
}

function TreeDiagramBlock({
  groups,
  copyControl,
}: {
  groups: TreeDiagramNode[][]
  copyControl?: DiagramCopyControl
}) {
  return (
    <div className="space-y-4">
      {groups.map((nodes, index) => (
        <DiagramCard key={`tree-card-${index}`} copyControl={index === 0 ? copyControl : undefined}>
          <TreeDiagramGroups groups={[nodes]} />
        </DiagramCard>
      ))}
    </div>
  )
}

function DiagramSectionContent({ content }: { content: string }) {
  const treeGroups = buildTreeDiagram(content)
  if (treeGroups) {
    return <TreeDiagramGroups groups={treeGroups} />
  }

  return <RawDiagramBlock content={content} />
}

function BoxSectionBlock({ section }: { section: string }) {
  return (
    <DiagramCard>
      <DiagramSectionContent content={section} />
    </DiagramCard>
  )
}

function BoxDiagramBlock({
  sections,
  copyControl,
}: {
  sections: string[]
  copyControl?: DiagramCopyControl
}) {
  return (
    <div className="space-y-4">
      {sections.map((section, index) => {
        if (index === 0) {
          return (
            <DiagramCard key={`box-section-${index}`} copyControl={copyControl}>
              <DiagramSectionContent content={section} />
            </DiagramCard>
          )
        }

        return <BoxSectionBlock key={`box-section-${index}`} section={section} />
      })}
    </div>
  )
}

function DiagramContent({
  content,
  copyControl,
}: {
  content: string
  copyControl?: DiagramCopyControl
}) {
  const boxSections = buildBoxDiagram(content)
  if (boxSections) {
    return <BoxDiagramBlock sections={boxSections} copyControl={copyControl} />
  }

  const treeGroups = buildTreeDiagram(content)
  if (treeGroups) {
    return <TreeDiagramBlock groups={treeGroups} copyControl={copyControl} />
  }

  return (
    <DiagramCard copyControl={copyControl}>
      <RawDiagramBlock content={content} />
    </DiagramCard>
  )
}

function DiagramBlock({ content }: { content: string }) {
  // 空内容保护：避免渲染出空的灰色块
  if (!content.trim()) return null

  const [copied, setCopied] = useState(false)

  const handleCopyDiagram = async () => {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="group/diagram mx-2">
      <DiagramContent content={content} copyControl={{ copied, onCopy: handleCopyDiagram }} />
    </div>
  )
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
  // 空内容保护：避免渲染出空的代码块
  if (!code.trim()) return null

  const [copied, setCopied] = useState(false)

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <pre
      className="group/code relative mx-2 overflow-x-auto rounded-xl border border-border bg-surface-alt px-4 py-3 text-xs leading-relaxed"
    >
      <button
        type="button"
        onClick={handleCopyCode}
        className={[
          'absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md',
          'bg-surface-alt text-text-primary transition-all hover:bg-surface',
          'opacity-0 group-hover/code:opacity-100 group-focus-within/code:opacity-100',
        ].join(' ')}
        aria-label="复制代码"
        title="复制代码"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      {language ? (
        <div className="mb-2 pr-16 text-[11px] uppercase tracking-wide text-text-muted">{language}</div>
      ) : (
        <div className="mb-2 pr-16" />
      )}
      <code>{code}</code>
    </pre>
  )
}

function normalizeMarkdown(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n+```/g, '\n```')
    .replace(/```\n+/g, '```\n')
}

type MarkdownSegment =
  | { kind: 'text'; content: string }
  | { kind: 'code'; content: string; language?: string }

function splitMarkdownSegments(text: string): MarkdownSegment[] {
  const lines = text.split('\n')
  const segments: MarkdownSegment[] = []

  let inCode = false
  let fenceLength = 0 // 当前代码块开启时的反引号数量
  let nestedDepth = 0 // 嵌套代码块深度（处理 LLM 输出嵌套 ``` 的场景）
  let language = ''
  let buffer: string[] = []
  // markdown/md 语言围栏的外层关闭行号
  // -1 表示未启用前瞻特殊处理（按原通用规则处理）
  let markdownOuterCloseIdx = -1

  const flushText = () => {
    const content = buffer.join('\n')
    if (content.trim()) {
      segments.push({ kind: 'text', content })
    }
    buffer = []
  }

  const flushCode = () => {
    const content = buffer.join('\n')
    segments.push({ kind: 'code', content, language: language || undefined })
    buffer = []
  }

  // 计算行首连续反引号数量
  const countLeadingBackticks = (line: string): number => {
    const match = line.match(/^`{3,}/)
    return match ? match[0].length : 0
  }

  // 判断某行是否是裸反引号围栏（``` 后无语言标识）
  const isBareFence = (line: string): boolean => {
    const count = countLeadingBackticks(line)
    return count >= 3 && line.slice(count).trim() === ''
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const backtickCount = countLeadingBackticks(line)

    if (!inCode && backtickCount >= 3) {
      // 开启代码块
      flushText()
      inCode = true
      fenceLength = backtickCount
      nestedDepth = 0
      language = line.slice(backtickCount).trim()
      markdownOuterCloseIdx = -1

      // markdown/md 围栏专项前瞻：
      // LLM 输出常见嵌套 ```markdown + ``` + 内容 + ``` + ```（全部 3 反引号），
      // 此时第一个裸 ``` 其实是内层打开，而非关闭外层。
      // 通过前瞻统计裸 ``` 的个数：奇数 → 最后一个才是外层关闭，前面都是内层 toggle。
      if (language === 'markdown' || language === 'md') {
        const bareFenceIdxs: number[] = []
        for (let j = i + 1; j < lines.length; j++) {
          if (isBareFence(lines[j])) bareFenceIdxs.push(j)
        }
        if (bareFenceIdxs.length >= 1 && bareFenceIdxs.length % 2 === 1) {
          markdownOuterCloseIdx = bareFenceIdxs[bareFenceIdxs.length - 1]
        }
      }
      continue
    }

    if (inCode && backtickCount >= 3) {
      const trailing = line.slice(backtickCount).trim()

      if (trailing !== '') {
        // 有语言标识（如 ```python）：嵌套代码块开启，深度 +1
        nestedDepth++
        buffer.push(line)
        continue
      }

      // 裸 ``` —— markdown/md 围栏走前瞻驱动的分支
      if (markdownOuterCloseIdx >= 0) {
        if (i === markdownOuterCloseIdx) {
          flushCode()
          inCode = false
          fenceLength = 0
          nestedDepth = 0
          language = ''
          markdownOuterCloseIdx = -1
          continue
        }
        // 其余裸 ``` 均视为内层嵌套的一部分，保留为内容
        buffer.push(line)
        continue
      }

      // 纯关闭标记（如 ```）
      if (nestedDepth > 0) {
        // 先关闭内层嵌套
        nestedDepth--
        buffer.push(line)
        continue
      }

      // 外层反引号数量匹配检查：>= 开启时的数量才关闭
      if (backtickCount >= fenceLength) {
        flushCode()
        inCode = false
        fenceLength = 0
        nestedDepth = 0
        language = ''
        continue
      }
    }

    buffer.push(line)
  }

  if (inCode) {
    // 流式输出时未闭合代码块：将尾部仍按代码块渲染，避免闪烁成普通文本。
    flushCode()
  } else {
    flushText()
  }

  return segments
}

function renderInlineMarkdown(text: string): Array<string | ReactNode> {
  const parts: Array<string | ReactNode> = []
  // 支持：行内代码、加粗、斜体、删除线、图片、链接
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|!\[[^\]]*\]\([^)]+\)|\[[^\]]+\]\([^)]+\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let key = 0

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }
    const token = match[0]
    if (token.startsWith('`') && token.endsWith('`')) {
      parts.push(
        <code key={`code-${key++}`} className="rounded-md border border-border bg-surface px-1.5 py-0.5 text-[0.9em]">
          {token.slice(1, -1)}
        </code>,
      )
    } else if (token.startsWith('**') && token.endsWith('**')) {
      parts.push(<strong key={`strong-${key++}`} className="font-semibold">{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('~~') && token.endsWith('~~')) {
      parts.push(<del key={`del-${key++}`} className="text-text-secondary line-through">{token.slice(2, -2)}</del>)
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(<em key={`em-${key++}`} className="italic">{token.slice(1, -1)}</em>)
    } else if (token.startsWith('![')) {
      // 图片：![alt](url)
      const m = token.match(/^!\[([^\]]*)\]\(([^)]+)\)$/)
      if (m) {
        parts.push(
          <img
            key={`img-${key++}`}
            src={m[2]}
            alt={m[1]}
            className="my-1 inline-block max-h-80 max-w-full rounded-lg"
          />,
        )
      } else {
        parts.push(token)
      }
    } else if (token.startsWith('[')) {
      const m = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (m) {
        parts.push(
          <a
            key={`a-${key++}`}
            href={m[2]}
            target="_blank"
            rel="noreferrer"
            className="text-accent-text underline underline-offset-2"
          >
            {m[1]}
          </a>,
        )
      } else {
        parts.push(token)
      }
    } else {
      parts.push(token)
    }
    lastIndex = regex.lastIndex
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }
  return parts
}

function TableBlock({ raw, headers, alignments, rows }: {
  raw: string
  headers: string[]
  alignments: Array<'left' | 'center' | 'right'>
  rows: string[][]
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(raw)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="group/table relative mx-2 overflow-x-auto rounded-xl border border-border bg-surface-alt px-2 py-2">
      <button
        type="button"
        onClick={handleCopy}
        className={[
          'absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md',
          'bg-surface-alt text-text-primary transition-all hover:bg-surface',
          'opacity-0 group-hover/table:opacity-100 group-focus-within/table:opacity-100',
        ].join(' ')}
        aria-label="复制表格"
        title="复制表格"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border">
            {headers.map((h, i) => (
              <th
                key={i}
                style={{ textAlign: alignments[i] }}
                className="px-3 py-1.5 font-semibold text-text-primary"
              >
                {renderInlineMarkdown(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-border/50">
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  style={{ textAlign: alignments[ci] }}
                  className="px-3 py-1.5 text-text-secondary"
                >
                  {renderInlineMarkdown(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderTextBlock(block: string, blockIndex: number): ReactNode {
  const lines = block.split('\n')
  const nodes: ReactNode[] = []
  let listType: 'ul' | 'ol' | null = null
  let listItems: ReactNode[] = []
  let listKey = 0
  let tableLines: string[] = []
  let tableKey = 0
  let diagramLines: string[] = []
  let diagramPendingBlanks = 0 // 图表块内待定空行数
  let diagramKey = 0
  // 延迟 paragraph：当下一个非空行是图表行时，
  // 把当前 paragraph 当作图表的根节点吸入 diagramLines，避免根与树被割裂。
  let pendingParagraphLine: string | null = null
  let pendingParagraphKey = 0

  // Box Drawing 区间 U+2500–U+257F
  const boxDrawingLineRegex = /[\u2500-\u257F]/

  const flushPendingParagraph = () => {
    if (pendingParagraphLine === null) return
    const text = pendingParagraphLine
    pendingParagraphLine = null
    nodes.push(
      <p key={`pp-${blockIndex}-${pendingParagraphKey++}`} className="whitespace-pre-wrap break-words leading-relaxed">
        {renderInlineMarkdown(text)}
      </p>,
    )
  }

  const flushDiagram = () => {
    if (diagramLines.length === 0) return
    // 去掉尾部空行
    while (diagramLines.length > 0 && !diagramLines[diagramLines.length - 1].trim()) {
      diagramLines.pop()
    }
    if (diagramLines.length === 0) return
    const content = diagramLines.join('\n')
    nodes.push(<DiagramBlock key={`diagram-${blockIndex}-${diagramKey++}`} content={content} />)
    diagramLines = []
    diagramPendingBlanks = 0
  }

  const flushList = () => {
    if (!listType || listItems.length === 0) return
    if (listType === 'ul') {
      nodes.push(
        <ul key={`ul-${blockIndex}-${listKey++}`} className="list-disc space-y-1 pl-5">
          {listItems}
        </ul>,
      )
    } else {
      nodes.push(
        <ol key={`ol-${blockIndex}-${listKey++}`} className="list-decimal space-y-1 pl-5">
          {listItems}
        </ol>,
      )
    }
    listType = null
    listItems = []
  }

  const flushTable = () => {
    if (tableLines.length === 0) return

    if (tableLines.length < 2) {
      // 不足两行（无表头+分隔符），当普通文本处理
      tableLines.forEach((line, i) => {
        nodes.push(
          <p key={`tp-${blockIndex}-${tableKey}-${i}`} className="whitespace-pre-wrap break-words leading-relaxed">
            {renderInlineMarkdown(line)}
          </p>,
        )
      })
      tableLines = []
      return
    }

    const parseRow = (line: string) =>
      line.split('|').slice(1, -1).map(cell => cell.trim())

    const headers = parseRow(tableLines[0])

    // 解析对齐方式
    const alignments: Array<'left' | 'center' | 'right'> = parseRow(tableLines[1]).map(cell => {
      if (cell.startsWith(':') && cell.endsWith(':')) return 'center'
      if (cell.endsWith(':')) return 'right'
      return 'left'
    })

    const rows = tableLines.slice(2).map(parseRow)
    const raw = tableLines.join('\n')

    nodes.push(
      <TableBlock
        key={`tbl-${blockIndex}-${tableKey++}`}
        raw={raw}
        headers={headers}
        alignments={alignments}
        rows={rows}
      />,
    )
    tableLines = []
  }

  lines.forEach((line, lineIndex) => {
    const trimmed = line.trim()

    if (!trimmed) {
      // 空行先落定前一行待定段落（它与后续图表已被空行隔开，不再属于图表 root）
      flushPendingParagraph()
      // 图表块内：用前瞻策略判断是否继续收集
      if (diagramLines.length > 0) {
        diagramPendingBlanks++
        // 向前扫描：如果后续（最多 3 行内）还有图表行，继续收集空行
        let hasUpcomingDiagram = false
        for (let ahead = lineIndex + 1; ahead < lines.length && ahead <= lineIndex + 3; ahead++) {
          const aheadTrimmed = lines[ahead].trim()
          if (!aheadTrimmed) continue // 跳过连续空行继续向前看
          if (boxDrawingLineRegex.test(aheadTrimmed)) {
            hasUpcomingDiagram = true
          }
          break // 找到第一个非空行即停止
        }
        if (hasUpcomingDiagram) {
          // 后面还有图表行，保持收集状态
          return
        }
        // 后面没有图表行了，结束图表块
        flushDiagram()
        nodes.push(<div key={`gap-${blockIndex}-${lineIndex}`} className="h-2" />)
        return
      }
      flushTable()
      flushList()
      nodes.push(<div key={`gap-${blockIndex}-${lineIndex}`} className="h-2" />)
      return
    }

    // 图表行检测：包含 Box Drawing 字符（U+2500–U+257F）
    if (boxDrawingLineRegex.test(trimmed)) {
      flushTable()
      flushList()
      // 把紧邻的上一行普通段落（如 "Lecquy System"）当作树状图的根节点吸入图表块，
      // 避免树 root 被渲染成游离的 <p>。
      if (diagramLines.length === 0 && pendingParagraphLine !== null) {
        diagramLines.push(pendingParagraphLine)
        pendingParagraphLine = null
      }
      // 将待定空行补入图表缓冲区
      for (let b = 0; b < diagramPendingBlanks; b++) {
        diagramLines.push('')
      }
      diagramPendingBlanks = 0
      diagramLines.push(line) // 保留原始缩进
      return
    }

    // 非图表行时 flush 已收集的图表
    if (diagramLines.length > 0) {
      flushDiagram()
    }

    // 表格行检测：以 | 开头并以 | 结尾
    if (/^\|.+\|$/.test(trimmed)) {
      flushPendingParagraph()
      flushList()
      tableLines.push(trimmed)
      return
    }

    // 非表格行时 flush 已收集的表格
    if (tableLines.length > 0) {
      flushTable()
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      flushPendingParagraph()
      flushList()
      nodes.push(<hr key={`hr-${blockIndex}-${lineIndex}`} className="my-2 border-border" />)
      return
    }

    if (/^#{1,6}\s+/.test(trimmed)) {
      flushPendingParagraph()
      flushList()
      const level = trimmed.match(/^#+/)?.[0].length ?? 1
      const content = trimmed.replace(/^#{1,6}\s+/, '')
      const sizeClass = level <= 2 ? 'text-base font-semibold' : 'text-sm font-semibold'
      nodes.push(
        <div key={`h-${blockIndex}-${lineIndex}`} className={sizeClass}>
          {renderInlineMarkdown(content)}
        </div>,
      )
      return
    }

    if (/^>\s+/.test(trimmed)) {
      flushPendingParagraph()
      flushList()
      nodes.push(
        <blockquote
          key={`q-${blockIndex}-${lineIndex}`}
          className="border-l-2 border-border pl-3 text-text-secondary"
        >
          {renderInlineMarkdown(trimmed.replace(/^>\s+/, ''))}
        </blockquote>,
      )
      return
    }

    // 任务列表：- [ ] 或 - [x]
    if (/^[-*]\s+\[[ xX]\]\s+/.test(trimmed)) {
      flushPendingParagraph()
      if (listType !== 'ul') {
        flushList()
        listType = 'ul'
      }
      const checked = /^[-*]\s+\[[xX]\]/.test(trimmed)
      const taskContent = trimmed.replace(/^[-*]\s+\[[ xX]\]\s+/, '')
      listItems.push(
        <li key={`li-task-${blockIndex}-${lineIndex}`} className="flex items-start gap-2 leading-relaxed list-none -ml-5">
          <span className={clsx('mt-1.5 inline-block size-3.5 shrink-0 rounded border', checked ? 'border-accent-text bg-accent-text text-white' : 'border-border bg-surface')} aria-hidden="true">
            {checked && (
              <svg viewBox="0 0 14 14" fill="none" className="size-full">
                <path d="M3.5 7l2.5 2.5 4.5-4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </span>
          <span className={checked ? 'text-text-secondary line-through' : ''}>{renderInlineMarkdown(taskContent)}</span>
        </li>,
      )
      return
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushPendingParagraph()
      if (listType !== 'ul') {
        flushList()
        listType = 'ul'
      }
      listItems.push(
        <li key={`li-ul-${blockIndex}-${lineIndex}`} className="leading-relaxed">
          {renderInlineMarkdown(trimmed.replace(/^[-*]\s+/, ''))}
        </li>,
      )
      return
    }

    if (/^\d+\.\s+/.test(trimmed)) {
      flushPendingParagraph()
      if (listType !== 'ol') {
        flushList()
        listType = 'ol'
      }
      listItems.push(
        <li key={`li-ol-${blockIndex}-${lineIndex}`} className="leading-relaxed">
          {renderInlineMarkdown(trimmed.replace(/^\d+\.\s+/, ''))}
        </li>,
      )
      return
    }

    // 普通段落：先把上一行待定段落落定，再把当前行置为新的 pending，
    // 等下一行来判断：如果是图表行，就把它吸入 diagramLines 当根节点。
    flushPendingParagraph()
    flushList()
    pendingParagraphLine = line
  })

  flushPendingParagraph()
  flushTable()
  flushDiagram()
  flushList()
  return <div className="space-y-2">{nodes}</div>
}

function isPlainThoughtText(text: string): boolean {
  const normalized = text.trim()
  if (!normalized) return true

  return !(
    /```/.test(normalized)
    || /(^|\n)\s*#{1,6}\s+/m.test(normalized)
    || /(^|\n)\s*>\s+/m.test(normalized)
    || /(^|\n)\s*[-*]\s+/m.test(normalized)
    || /(^|\n)\s*\d+\.\s+/m.test(normalized)
    || /(^|\n)\s*\|.+\|\s*$/m.test(normalized)
    || /\[[^\]]+\]\([^)]+\)/.test(normalized)
    || /`[^`]+`/.test(normalized)
    || /\*\*[^*]+\*\*/.test(normalized)
    || /~~[^~]+~~/.test(normalized)
    || /!\[[^\]]*\]\([^)]+\)/.test(normalized)
  )
}

function MarkdownPreviewBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="group/mdblock relative mx-2 overflow-x-auto rounded-xl border border-border bg-surface-alt px-4 py-3">
      <button
        type="button"
        onClick={handleCopy}
        className={[
          'absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md',
          'bg-surface-alt text-text-primary transition-all hover:bg-surface',
          'opacity-0 group-hover/mdblock:opacity-100 group-focus-within/mdblock:opacity-100',
        ].join(' ')}
        aria-label="复制源码"
        title="复制源码"
      >
        {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      </button>
      <div className="mb-2 pr-16 text-[11px] uppercase tracking-wide text-text-muted">markdown</div>
      {renderMarkdown(code)}
    </div>
  )
}

export function renderMarkdown(text: string): ReactNode {
  const normalized = normalizeMarkdown(text)
  const segments = splitMarkdownSegments(normalized)
  return (
    <div className="space-y-2">
      {segments.map((segment, index) => {
        if (segment.kind === 'code') {
          // markdown/md 语言的代码块：空内容跳过，图表内容直接用 DiagramBlock，其余递归渲染
          if (segment.language === 'markdown' || segment.language === 'md') {
            if (!segment.content.trim()) return null
            if (isStandaloneDiagramMarkdown(segment.content)) {
              return <DiagramBlock key={`diagram-${index}`} content={segment.content} />
            }
            return <MarkdownPreviewBlock key={`md-${index}`} code={segment.content} />
          }
          // Mermaid 图表：交给 MermaidBlock 异步渲染为 SVG
          if (segment.language === 'mermaid') {
            return <MermaidBlock key={`mermaid-${index}`} code={segment.content} />
          }
          // 代码块若包含 ASCII 图表字符，以图表样式渲染（不论是否有语言标识）
          if (isDiagramContent(segment.content)) {
            return <DiagramBlock key={`diagram-${index}`} content={segment.content} />
          }
          return <CodeBlock key={`pre-${index}`} code={segment.content} language={segment.language} />
        }
        return <div key={`txt-${index}`}>{renderTextBlock(segment.content, index)}</div>
      })}
    </div>
  )
}

function summarizeTodo(items: NonNullable<ChatMessage['todoItems']>) {
  const completed = items.filter((item) => item.status === 'completed').length
  const inProgress = items.filter((item) => item.status === 'in_progress').length
  const total = items.length
  return {
    label: `已完成 ${completed}/${total} 步`,
    detail: inProgress > 0 ? `进行中 ${inProgress} 项` : total === completed ? '全部已完成' : '等待执行',
  }
}

function currentTodoFocus(items: NonNullable<ChatMessage['todoItems']>) {
  const active = items.find((item) => item.status === 'in_progress') ?? items.find((item) => item.status === 'pending')
  return active?.content ?? null
}

function getEventLabel(eventType?: string) {
  if (!eventType) return null

  switch (eventType) {
    case 'pause':
      return '需要你补充信息'
    case 'tool_error':
      return '执行异常'
    case 'session_tool_result':
      return '会话操作'
    default:
      return null
  }
}

function formatThoughtDuration(durationMs: number): string {
  const safeDuration = Math.max(0, durationMs)
  const hours = Math.floor(safeDuration / 3_600_000)
  const minutes = Math.floor((safeDuration % 3_600_000) / 60_000)
  const seconds = (safeDuration % 60_000) / 1000

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m ${seconds.toFixed(1).padStart(4, '0')}s`
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds.toFixed(1).padStart(4, '0')}s`
  }

  return `${seconds.toFixed(1)}s`
}

export function MessageItem({
  message,
  isLastAssistant: _isLastAssistant = false,
  onResendUser,
  onToggleThinking,
  onToggleTodo,
  onTogglePlanTask,
  onToggleToolCall,
  onToggleToolGroup,
  onOpenAttachment,
  onOpenArtifact,
  onDownloadArtifact,
  activeAttachmentKey = null,
}: MessageItemProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isEvent = message.role === 'event'
  const primaryTextContent = blocksToText(message.blocks).trim() || message.content.trim()
  const hasToolBlocks = (message.blocks ?? []).some((block) => block.kind === 'tool_call')
  const hasPrimaryContent = primaryTextContent.length > 0
  const hasThinkingContent = Boolean(message.hasThinking && message.thinkingContent?.trim())
  const showThoughtsCard = Boolean((isAssistant || isEvent) && hasThinkingContent)
  const canCopyMessage = primaryTextContent.length > 0
  const todoItems = message.todoItems ?? []
  const planDetails = message.planDetails ?? {}
  const isPlanPanel = isEvent && (message.eventType === 'plan' || message.eventType === 'todo')
  const eventLabel = getEventLabel(message.eventType)
  const [copied, setCopied] = useState(false)
  const [thoughtCopied, setThoughtCopied] = useState(false)
  const [isActionBarHovered, setIsActionBarHovered] = useState(false)
  const [isActionBarFocused, setIsActionBarFocused] = useState(false)
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now())
  const isActionBarVisible = isActionBarHovered || isActionBarFocused
  const attachments = message.attachments ?? []
  const artifacts = message.artifacts ?? []
  const artifactTraceItems = message.artifactTraceItems ?? []
  const thoughtTiming = message.thoughtTiming
  const readyArtifacts = artifacts
    .map((artifact, index) => ({ artifact, index }))
    .filter(({ artifact }) => artifact.status !== 'draft')
  const hasArtifactOperations = artifactTraceItems.length > 0 || artifacts.some((artifact) => artifact.status === 'draft' || Boolean(artifact.content))
  const canRenderReadyArtifacts = readyArtifacts.length > 0 && message.stepStatus !== 'started'
  const hasArtifactContent = hasArtifactOperations || canRenderReadyArtifacts
  const thinkingContent = message.thinkingContent ?? ''
  const isPlainThoughtContent = isPlainThoughtText(thinkingContent)

  useEffect(() => {
    if (thoughtTiming?.status !== 'running') return

    setCurrentTimeMs(Date.now())
    const timerId = window.setInterval(() => {
      setCurrentTimeMs(Date.now())
    }, THOUGHT_TIMER_INTERVAL_MS)

    return () => window.clearInterval(timerId)
  }, [thoughtTiming?.startedAt, thoughtTiming?.status])

  const thoughtDurationMs = thoughtTiming
    ? thoughtTiming.status === 'running'
      ? Math.max(0, currentTimeMs - thoughtTiming.startedAt)
      : thoughtTiming.durationMs ?? (
        typeof thoughtTiming.finishedAt === 'number'
          ? Math.max(0, thoughtTiming.finishedAt - thoughtTiming.startedAt)
          : undefined
      )
    : undefined
  const thoughtDurationLabel = typeof thoughtDurationMs === 'number'
    ? formatThoughtDuration(thoughtDurationMs)
    : null

  if (isAssistant && !hasPrimaryContent && !hasToolBlocks && !showThoughtsCard && !hasArtifactContent) {
    return null
  }

  if (isPlanPanel) {
    const summary = summarizeTodo(todoItems)
    const focus = currentTodoFocus(todoItems)
    const completed = todoItems.filter((item) => item.status === 'completed').length
    const total = todoItems.length
    const headerStatus = total === 0 ? '正在生成计划' : `${completed}/${total}`
    const headerDetail =
      total === 0
        ? '正在拆解任务...'
        : focus
          ? `当前：${focus}`
          : summary.detail

    return (
      <div className="flex w-full justify-start">
        <div className="w-full overflow-hidden rounded-[1.35rem] border border-border bg-surface-thought">
          <button
            type="button"
            onClick={() => onToggleTodo?.(message.id)}
            className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-hover/60"
            aria-expanded={message.isTodoExpanded}
            aria-label={message.isTodoExpanded ? '收起计划步骤' : '展开计划步骤'}
          >
            <div className="flex min-w-0 items-center gap-2">
              <span className="inline-flex size-6 items-center justify-center rounded-full bg-surface-alt text-accent-text">
                <ListTodo className="size-3.5" />
              </span>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-text-primary">Plan</div>
                <div className="mt-0.5 text-xs text-text-secondary">{headerDetail}</div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 text-sm text-text-secondary">
              <span>{headerStatus}</span>
              {message.isTodoExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
            </div>
          </button>

          {message.isTodoExpanded && (
            <div className="border-t border-border bg-surface-alt px-4 py-4">
              {todoItems.length === 0 ? (
                <div className="text-sm text-text-secondary">正在生成任务列表...</div>
              ) : (
                <div className="space-y-4">
                  {todoItems.map((item, index) => {
                    const detail = planDetails[index]
                    const taskSummary = detail?.content?.trim() || item.result?.trim() || ''
                    const hasTaskSummary = Boolean(taskSummary)
                    const isTaskExpanded = message.expandedPlanTaskIndexes?.includes(index) ?? false

                    return (
                      <div key={`${item.content}_${index}`} className="overflow-hidden rounded-[1.1rem] border border-border/80 bg-surface-thought">
                        <button
                          type="button"
                          onClick={() => onTogglePlanTask?.(message.id, index)}
                          className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-hover/35"
                          aria-expanded={isTaskExpanded}
                          aria-label={isTaskExpanded ? '收起任务详情' : '展开任务详情'}
                        >
                          <span className={clsx(
                            'mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold',
                            item.status === 'completed' && 'border-border bg-surface-thought text-text-primary',
                            item.status === 'in_progress' && 'border-accent text-accent-text',
                            item.status === 'pending' && 'border-border text-text-muted',
                          )}>
                            {item.status === 'completed' ? '✓' : item.status === 'in_progress' ? '>' : ''}
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className={clsx(
                              'text-sm leading-relaxed',
                              item.status === 'completed' ? 'text-text-primary' : item.status === 'in_progress' ? 'font-medium text-text-primary' : 'text-text-secondary',
                            )}>
                              {item.content}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 pt-0.5 text-sm text-text-secondary">
                            {isTaskExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                          </div>
                        </button>

                        {isTaskExpanded && (
                          <div className="border-t border-border/80 px-4 py-3">
                            {hasTaskSummary ? (
                              <div className="space-y-3">
                                <div className="px-1 text-text-primary">
                                  {renderMarkdown(taskSummary)}
                                </div>
                              </div>
                            ) : (
                              <div className="text-sm text-text-secondary">
                                {item.status === 'pending' ? '等待执行' : item.status === 'in_progress' ? '正在执行...' : '已完成'}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(primaryTextContent)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  const handleCopyThoughts = async () => {
    if (!thinkingContent.trim()) return

    try {
      await navigator.clipboard.writeText(thinkingContent)
      setThoughtCopied(true)
      window.setTimeout(() => setThoughtCopied(false), 1200)
    } catch {
      setThoughtCopied(false)
    }
  }

  const handleActionAreaBlur = (event: FocusEvent<HTMLDivElement>) => {
    const nextFocusTarget = event.relatedTarget
    if (nextFocusTarget instanceof Node && event.currentTarget.contains(nextFocusTarget)) {
      return
    }
    setIsActionBarFocused(false)
  }

  const handleOpenTraceArtifact = (artifact: ChatArtifact) => {
    const artifactIndex = artifacts.findIndex((candidate) =>
      candidate.artifactId === artifact.artifactId
      || (
        candidate.status !== 'draft'
        && artifact.status !== 'draft'
        && candidate.filePath === artifact.filePath
      ),
    )
    if (artifactIndex < 0) return
    onOpenArtifact?.(message.id, artifactIndex, artifact)
  }

  const renderAttachments = () => {
    if (attachments.length === 0) return null

    return (
      <div className={clsx('mb-2.5 flex flex-col gap-2', isUser ? 'items-end' : 'items-start')}>
        {attachments.map((attachment, index) => (
          attachment.kind === 'image' ? (
            <button
              key={`${attachment.name}_${index}`}
              type="button"
              onClick={() => onOpenAttachment?.(message.id, index, attachment)}
              title={attachment.name}
              className={clsx(
                'group flex flex-col overflow-hidden rounded-[1.25rem] border bg-surface-thought text-left shadow-[0_10px_24px_rgba(15,23,42,0.06)] transition-all',
                'dark:border-[#5a5a55] dark:bg-[rgb(38,38,36)] dark:shadow-[0_12px_28px_rgba(0,0,0,0.24)]',
                CHAT_ATTACHMENT_CARD_SIZE_CLASS,
                'hover:-translate-y-0.5 hover:border-[color:var(--border-strong)] hover:shadow-[0_14px_34px_rgba(15,23,42,0.10)] dark:hover:shadow-[0_16px_34px_rgba(0,0,0,0.34)]',
                activeAttachmentKey === `${message.id}:${index}`
                  ? 'border-[color:var(--border-strong)] shadow-[0_14px_34px_rgba(15,23,42,0.10)] dark:shadow-[0_16px_34px_rgba(0,0,0,0.34)]'
                  : 'border-border',
              )}
            >
              <div className={CHAT_ATTACHMENT_CARD_PREVIEW_CLASS}>
                <img
                  src={buildAttachmentPreviewUrl(attachment) ?? ''}
                  alt={attachment.name}
                  className="block h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.02]"
                />
              </div>
              <div className={CHAT_ATTACHMENT_CARD_BODY_CLASS}>
                <div className="truncate text-sm font-medium text-text-primary">{attachment.name}</div>
                <div className="mt-0.5 text-xs text-text-secondary">{formatAttachmentMeta(attachment)}</div>
              </div>
            </button>
          ) : (
            <AttachmentFileCard
              key={`${attachment.name}_${index}`}
              attachment={attachment}
              active={activeAttachmentKey === `${message.id}:${index}`}
              onOpen={() => onOpenAttachment?.(message.id, index, attachment)}
            />
          )
        ))}
      </div>
    )
  }

  const renderArtifactOperations = () => {
    if (!hasArtifactOperations) return null

    return (
      <div className="mt-3 mb-4">
        <ArtifactTrace
          items={artifactTraceItems}
          artifacts={artifacts}
          onOpenArtifact={handleOpenTraceArtifact}
        />
      </div>
    )
  }

  const renderReadyArtifactCards = () => {
    if (!canRenderReadyArtifacts) return null

    return (
      <div className="mt-3 flex flex-col gap-3">
        {readyArtifacts.map(({ artifact, index }) => (
          <ArtifactCard
            key={artifact.artifactId}
            artifact={artifact}
            active={activeAttachmentKey === `${message.id}:artifact:${index}`}
            onOpen={() => onOpenArtifact?.(message.id, index, artifact)}
            onDownload={() => onDownloadArtifact?.(artifact)}
          />
        ))}
      </div>
    )
  }

  const renderAssistantBlocks = () => {
    if (!isAssistant || (message.blocks?.length ?? 0) === 0) return null

    return (
      <div className="space-y-2">
        {groupMessageBlocks(message.blocks ?? []).map((group) => {
          if (group.kind === 'text') {
            return <div key={group.block.id}>{renderMarkdown(group.block.content)}</div>
          }

          if (group.kind === 'tool_single') {
            return (
              <ToolCallCard
                key={group.block.id}
                block={group.block}
                narration={group.narration}
                onToggle={() => onToggleToolCall?.(message.id, group.block.id)}
              />
            )
          }

          const collapsed = message.collapsedToolGroupKeys?.includes(group.key) ?? false
          return (
            <ToolGroupCard
              key={group.key}
              blocks={group.blocks}
              narration={group.narration}
              collapsed={collapsed}
              onToggleGroup={() => onToggleToolGroup?.(message.id, group.key)}
              onToggleToolCall={(blockId) => onToggleToolCall?.(message.id, blockId)}
            />
          )
        })}
      </div>
    )
  }

  return (
    <div
      className={clsx(
        'flex w-full',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      <div
        className={clsx(
          'inline-flex flex-col',
          isUser ? 'max-w-[88%] items-end' : showThoughtsCard ? 'w-full' : 'max-w-full',
        )}
        onPointerEnter={() => setIsActionBarHovered(true)}
        onPointerLeave={() => setIsActionBarHovered(false)}
        onFocusCapture={() => setIsActionBarFocused(true)}
        onBlur={handleActionAreaBlur}
      >
        {attachments.length > 0 && renderAttachments()}

        {(showThoughtsCard || hasPrimaryContent || hasToolBlocks || isEvent || hasArtifactContent) && (
          <div
            className={clsx(
              // 对话区放大字号 + 收紧行距：text-base(16) / leading-[1.55]
              'rounded-2xl px-4 py-2 text-base leading-[1.55]',
              // 用户/AI 正文与思考统一挂衬线字族；事件/系统保持无衬线
              isUser && hasPrimaryContent && 'w-fit bg-user-bubble text-text-primary border border-border/70 font-serif-mix',
              isAssistant && (showThoughtsCard || hasArtifactContent || hasToolBlocks ? 'w-full bg-transparent border-transparent shadow-none text-text-primary px-1 py-1 font-serif-mix' : 'w-fit max-w-full bg-transparent border-transparent shadow-none text-text-primary px-1 py-1 font-serif-mix'),
              isEvent && 'bg-surface text-text-secondary border border-border/80',
              message.role === 'system' && 'bg-hover text-text-secondary border border-border',
            )}
          >
            {isEvent && eventLabel && (
              <div className="mb-1 text-xs uppercase tracking-wide text-text-muted">
                {eventLabel}
              </div>
            )}

            {showThoughtsCard && (
              <div className="group/thoughts mb-3 transition-all">
                {/* 折叠/展开头：一行低调 section header */}
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => onToggleThinking?.(message.id)}
                    className="inline-flex items-center gap-1.5 rounded-md py-1 text-[13px] text-text-secondary transition-colors hover:text-text-primary"
                    aria-expanded={message.isThinkingExpanded}
                    aria-label={message.isThinkingExpanded ? '隐藏思考内容' : '展开查看模型思考'}
                  >
                    <Sparkles className="size-3.5" />
                    <span>
                      {thoughtDurationLabel ? `思考了 ${thoughtDurationLabel}` : '思考中…'}
                    </span>
                    {message.isThinkingExpanded ? (
                      <ChevronUp className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                  </button>

                  {/* 复制按钮：仅在展开且悬停时显示，不占折叠态空间 */}
                  {message.isThinkingExpanded && (
                    <button
                      type="button"
                      onClick={handleCopyThoughts}
                      className="ml-0.5 inline-flex size-6 items-center justify-center rounded-md text-text-muted opacity-0 transition-opacity hover:text-text-primary group-hover/thoughts:opacity-100"
                      aria-label="复制思考内容"
                      title="复制思考内容"
                    >
                      {thoughtCopied ? <Check className="size-3" /> : <Copy className="size-3" />}
                    </button>
                  )}
                </div>

                {/* 展开内容区：左侧引导线而非外框 */}
                {message.isThinkingExpanded && (
                  <div className="mt-1.5 border-l-2 border-border pl-3 text-[14px] leading-[1.55] text-text-secondary select-text">
                    {isPlainThoughtContent ? (
                      <span className="whitespace-pre-wrap break-words select-text">
                        {thinkingContent}
                      </span>
                    ) : (
                      <div className="[&_p]:text-text-secondary [&_li]:text-text-secondary [&_blockquote]:text-text-secondary [&_td]:text-text-secondary [&_code]:text-text-primary">
                        {renderMarkdown(thinkingContent)}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {isAssistant && renderArtifactOperations()}

            {isAssistant ? (
              message.blocks?.length ? renderAssistantBlocks() : hasPrimaryContent ? renderMarkdown(primaryTextContent) : null
            ) : (
              hasPrimaryContent ? (
                <div className="whitespace-pre-wrap break-words leading-relaxed">{primaryTextContent}</div>
              ) : null
            )}

            {isAssistant && renderReadyArtifactCards()}
          </div>
        )}
        {(isUser || isAssistant) && canCopyMessage && (
          <div
            className={clsx(
              'mt-0.5 flex h-7 items-center',
              isUser ? 'justify-end pr-0.5' : 'justify-start pl-1',
            )}
          >
            <div
              className={clsx(
                'flex items-center gap-1 transition-opacity duration-150',
                isActionBarVisible
                  ? 'visible opacity-100 pointer-events-auto'
                  : 'invisible opacity-0 pointer-events-none',
              )}
            >
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-surface-alt text-text-primary transition-colors hover:bg-surface dark:text-white"
                aria-label="复制消息"
                title="复制消息"
              >
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
              </button>
              {isUser && onResendUser && (
                <button
                  type="button"
                  onClick={() => onResendUser(message.id)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-surface-alt text-text-primary transition-colors hover:bg-surface dark:text-white"
                  aria-label="重新发送问题"
                  title="重新发送问题"
                >
                  <RotateCcw className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* TODO: 品牌标识暂时禁用，后续重新设计再启用 */}
        {/* {isLastAssistant && (
          <div className="group/brand mt-2 flex items-center gap-2 pl-1">
            <img
              src="/lecquy-mark-nobg.png"
              alt="Lecquy"
              className="size-7 object-contain opacity-30 transition-opacity duration-200 group-hover/brand:opacity-70"
            />
            <span className="text-xs text-text-muted opacity-0 transition-opacity duration-200 group-hover/brand:opacity-100">
              由 Lecquy 驱动的 AI 助手
            </span>
          </div>
        )} */}
      </div>
    </div>
  )
}
