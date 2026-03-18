import clsx from 'clsx'
import { Check, ChevronDown, ChevronUp, Copy, RotateCcw, Sparkles } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { ChatMessage } from '../../hooks/useChat'

interface MessageItemProps {
  message: ChatMessage
  onResendUser?: (message: string) => void
  onToggleThinking?: (messageId: string) => void
}

function CodeBlock({ code, language }: { code: string; language?: string }) {
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
          'bg-surface-alt text-black transition-all hover:bg-surface',
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

  for (const line of lines) {
    const backtickCount = countLeadingBackticks(line)

    if (!inCode && backtickCount >= 3) {
      // 开启代码块
      flushText()
      inCode = true
      fenceLength = backtickCount
      nestedDepth = 0
      language = line.slice(backtickCount).trim()
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
  const regex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g
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
    } else if (token.startsWith('*') && token.endsWith('*')) {
      parts.push(<em key={`em-${key++}`} className="italic">{token.slice(1, -1)}</em>)
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
          'bg-surface-alt text-black transition-all hover:bg-surface',
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
      flushTable()
      flushList()
      nodes.push(<div key={`gap-${blockIndex}-${lineIndex}`} className="h-2" />)
      return
    }

    // 表格行检测：以 | 开头并以 | 结尾
    if (/^\|.+\|$/.test(trimmed)) {
      flushList()
      tableLines.push(trimmed)
      return
    }

    // 非表格行时 flush 已收集的表格
    if (tableLines.length > 0) {
      flushTable()
    }

    if (/^---+$/.test(trimmed) || /^\*\*\*+$/.test(trimmed)) {
      flushList()
      nodes.push(<hr key={`hr-${blockIndex}-${lineIndex}`} className="my-2 border-border" />)
      return
    }

    if (/^#{1,6}\s+/.test(trimmed)) {
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

    if (/^[-*]\s+/.test(trimmed)) {
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

    flushList()
    nodes.push(
      <p key={`p-${blockIndex}-${lineIndex}`} className="whitespace-pre-wrap break-words leading-relaxed">
        {renderInlineMarkdown(line)}
      </p>,
    )
  })

  flushTable()
  flushList()
  return <div className="space-y-2">{nodes}</div>
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
          'bg-surface-alt text-black transition-all hover:bg-surface',
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

function renderMarkdown(text: string): ReactNode {
  const normalized = normalizeMarkdown(text)
  const segments = splitMarkdownSegments(normalized)
  return (
    <div className="space-y-2">
      {segments.map((segment, index) => {
        if (segment.kind === 'code') {
          // markdown/md 语言的代码块：将内容作为 Markdown 递归渲染
          if (segment.language === 'markdown' || segment.language === 'md') {
            return <MarkdownPreviewBlock key={`md-${index}`} code={segment.content} />
          }
          return <CodeBlock key={`pre-${index}`} code={segment.content} language={segment.language} />
        }
        return <div key={`txt-${index}`}>{renderTextBlock(segment.content, index)}</div>
      })}
    </div>
  )
}

export function MessageItem({ message, onResendUser, onToggleThinking }: MessageItemProps) {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const isEvent = message.role === 'event'
  const hasPrimaryContent = message.content.trim().length > 0
  const hasThinkingContent = Boolean(message.hasThinking && message.thinkingContent?.trim())
  const showThoughtsCard = Boolean((isAssistant || isEvent) && hasThinkingContent)
  const canCopyMessage = message.content.trim().length > 0
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div
      className={clsx(
        'flex w-full',
        isUser ? 'justify-end' : 'justify-start',
      )}
    >
      <div className={clsx('group/message relative flex flex-col', canCopyMessage && 'pb-0', isUser ? 'max-w-[88%]' : 'w-full')}>
        <div
          className={clsx(
            'rounded-2xl px-4 py-2 text-sm leading-relaxed',
            isUser && 'w-fit bg-hover text-text-primary border border-border/70',
            isAssistant && 'w-full bg-transparent border-transparent shadow-none text-text-primary px-1 py-1',
            isEvent && 'bg-hover text-text-secondary border border-border',
            message.role === 'system' && 'bg-hover text-text-secondary border border-border',
          )}
        >
          {isEvent && message.eventType && (
            <div className="mb-1 text-xs uppercase tracking-wide text-text-muted">
              {message.eventType}
            </div>
          )}

          {showThoughtsCard && (
            <div className="mb-4 overflow-hidden rounded-[1.35rem] border border-border bg-surface-alt">
              <button
                type="button"
                onClick={() => onToggleThinking?.(message.id)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-hover/60"
                aria-expanded={message.isThinkingExpanded}
                aria-label={message.isThinkingExpanded ? '隐藏思考内容' : '展开查看模型思考'}
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex size-6 items-center justify-center rounded-full bg-surface-alt text-accent-text">
                    <Sparkles className="size-3.5" />
                  </span>
                  <span className="text-sm font-semibold text-text-primary">Thoughts</span>
                </div>
                <div className="flex items-center gap-2 text-sm text-text-secondary">
                  <span>{message.isThinkingExpanded ? '隐藏模型思考' : '展开查看模型思考'}</span>
                  {message.isThinkingExpanded ? <ChevronUp className="size-4" /> : <ChevronDown className="size-4" />}
                </div>
              </button>

              {message.isThinkingExpanded && (
                <div className="border-t border-border px-4 py-4 text-text-primary [&_p]:text-text-primary [&_li]:text-text-primary [&_blockquote]:text-text-primary [&_td]:text-text-primary [&_code]:text-text-primary">
                  {renderMarkdown(message.thinkingContent ?? '')}
                </div>
              )}
            </div>
          )}

          {isAssistant ? (
            hasPrimaryContent ? (
              renderMarkdown(message.content)
            ) : null
          ) : (
            <div className="whitespace-pre-wrap break-words leading-relaxed">{message.content}</div>
          )}
        </div>
        {(isUser || isAssistant) && canCopyMessage && (
          <div
            className={clsx(
              'absolute top-full mt-0 flex items-center gap-1 invisible opacity-0 pointer-events-none',
              'group-hover/message:visible group-hover/message:opacity-100 group-hover/message:pointer-events-auto',
              'group-focus-within/message:visible group-focus-within/message:opacity-100 group-focus-within/message:pointer-events-auto',
              isUser ? 'right-0 justify-end' : 'left-2 justify-start',
            )}
          >
            <button
              type="button"
              onClick={handleCopy}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-surface-alt text-black transition-colors hover:bg-surface"
              aria-label="复制消息"
              title="复制消息"
            >
              {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
            </button>
            {isUser && onResendUser && (
              <button
                type="button"
                onClick={() => onResendUser(message.content)}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-surface-alt text-black transition-colors hover:bg-surface"
                aria-label="重新发送问题"
                title="重新发送问题"
              >
                <RotateCcw className="size-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
