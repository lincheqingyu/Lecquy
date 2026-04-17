import clsx from 'clsx'
import { Streamdown, CodeBlockCopyButton, type ControlsConfig, type CustomRendererProps, type MermaidOptions, type PluginConfig } from 'streamdown'
import { Copy } from 'lucide-react'
import { useEffect, useId, useState, type ComponentProps } from 'react'
import { code } from '@streamdown/code'
import { mermaid as mermaidPlugin } from '@streamdown/mermaid'
import { cjk } from '@streamdown/cjk'
import { FilePreviewModeToggle, type FilePreviewViewMode } from '../files/FilePreviewPanelHeader'

function ClaudeCopyIcon({ size = 16, ...props }: ComponentProps<typeof Copy> & { size?: number }) {
  return <Copy size={size} strokeWidth={1.55} {...props} />
}

function MermaidBlockRenderer({ code, isIncomplete }: CustomRendererProps) {
  const isDark = useDocumentDarkMode()
  const [viewMode, setViewMode] = useState<FilePreviewViewMode>('preview')
  const [svg, setSvg] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const renderId = useId().replace(/:/g, '')
  const showPreview = viewMode === 'preview'

  useEffect(() => {
    if (!showPreview || isIncomplete) return

    let cancelled = false
    setSvg('')
    setError(null)

    const mermaid = mermaidPlugin.getMermaid({
      startOnLoad: false,
      securityLevel: 'loose',
      theme: isDark ? 'dark' : 'default',
      flowchart: { useMaxWidth: true },
      mindmap: { useMaxWidth: true },
    })

    void mermaid
      .render(`lecquy-mermaid-${renderId}`, code)
      .then((result) => {
        if (cancelled) return
        setSvg(result.svg)
      })
      .catch((nextError: unknown) => {
        if (cancelled) return
        setError(nextError instanceof Error ? nextError.message : 'Mermaid 渲染失败')
      })

    return () => {
      cancelled = true
    }
  }, [code, isDark, isIncomplete, renderId, showPreview])

  return (
    <div className="my-4 overflow-hidden rounded-[0.25rem] border border-border/80 bg-surface text-text-primary">
      <div className="relative">
        <div className="absolute right-3 top-3 z-10 flex items-center gap-2">
          <CodeBlockCopyButton
            code={code}
            className="inline-flex size-9 items-center justify-center rounded-[1rem] border border-user-bubble bg-surface !text-text-primary shadow-[0_10px_24px_rgba(15,23,42,0.08)] transition-colors hover:bg-user-bubble hover:!text-text-primary"
          />
          <FilePreviewModeToggle
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            className="shadow-[0_10px_24px_rgba(15,23,42,0.08)]"
          />
        </div>

        {showPreview ? (
          <div className="min-h-[18rem] overflow-auto bg-surface [&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:max-w-full">
            {error ? (
              <div className="flex min-h-[18rem] items-center justify-center px-4 text-sm text-text-secondary">
                {error}
              </div>
            ) : svg ? (
              <div dangerouslySetInnerHTML={{ __html: svg }} />
            ) : (
              <div className="flex min-h-[18rem] items-center justify-center text-sm text-text-secondary">
                {isIncomplete ? '等待 Mermaid 图完成…' : '正在渲染 Mermaid 图…'}
              </div>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto bg-surface">
            <pre className="m-0 font-mono text-[13px] leading-6 text-text-primary">
              <code className="block whitespace-pre">
                {`\
\`\`\`mermaid
${code}
\`\`\``}
              </code>
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

const STREAMDOWN_PLUGINS = {
  code,
  mermaid: mermaidPlugin,
  cjk,
  renderers: [
    {
      language: 'mermaid',
      component: MermaidBlockRenderer,
    },
  ],
} satisfies PluginConfig

// streamdown 默认在 code / table / mermaid 三类块上挂复制/下载/全屏按钮。
// 当前策略：
//   - code：打开复制按钮（嵌在顶部语言标签条右侧），关闭下载
//   - table / mermaid：全部关闭，复制入口走 MessageItem
// 样式覆盖在 index.css 里（[data-streamdown="code-block-*"]）。
const STREAMDOWN_CONTROLS: ControlsConfig = {
  code: {
    copy: true,
    download: false,
  },
  table: {
    copy: false,
    download: false,
    fullscreen: false,
  },
  mermaid: {
    copy: false,
    download: false,
    fullscreen: false,
    panZoom: false,
  },
}

function detectDarkMode(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
}

function useDocumentDarkMode() {
  const [isDark, setIsDark] = useState(detectDarkMode)

  useEffect(() => {
    if (typeof document === 'undefined') return

    const syncDarkMode = () => {
      setIsDark(detectDarkMode())
    }

    syncDarkMode()

    const observer = new MutationObserver(syncDarkMode)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => observer.disconnect()
  }, [])

  return isDark
}

interface StreamdownMarkdownProps {
  content: string
  className?: string
  isAnimating?: boolean
}

export function StreamdownMarkdown({
  content,
  className,
  isAnimating = false,
}: StreamdownMarkdownProps) {
  if (!content.trim()) return null

  const isDark = useDocumentDarkMode()
  const mode = isAnimating ? 'streaming' : 'static'

  const mermaidOptions: MermaidOptions = {
    config: {
      startOnLoad: false,
      securityLevel: 'loose',
      theme: isDark ? 'dark' : 'default',
      flowchart: { useMaxWidth: true },
      mindmap: { useMaxWidth: true },
    },
  }

  return (
    <Streamdown
      mode={mode}
      isAnimating={isAnimating}
      className={clsx('streamdown-markdown space-y-2', className)}
      controls={STREAMDOWN_CONTROLS}
      icons={{ CopyIcon: ClaudeCopyIcon }}
      lineNumbers={false}
      linkSafety={{ enabled: false }}
      mermaid={mermaidOptions}
      normalizeHtmlIndentation
      plugins={STREAMDOWN_PLUGINS}
    >
      {content}
    </Streamdown>
  )
}
