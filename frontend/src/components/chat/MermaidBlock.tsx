import { useEffect, useRef, useState } from 'react'
import mermaid from 'mermaid'

/** 全局递增 ID，确保同一页面多个 Mermaid 图表 ID 不冲突 */
let mermaidIdCounter = 0

/**
 * 检测当前是否处于深色模式（通过 <html> 标签上的 .dark 类）
 */
function detectDarkMode(): boolean {
  return document.documentElement.classList.contains('dark')
}

/**
 * 初始化 / 重新初始化 Mermaid 全局配置。
 * 每次主题切换后都需要调用，因为 Mermaid 内部会缓存 theme。
 */
function initMermaid(isDark: boolean) {
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'loose',
    theme: isDark ? 'dark' : 'default',
    // 让渲染出的 SVG 自适应容器宽度
    flowchart: { useMaxWidth: true },
    mindmap: { useMaxWidth: true },
  })
}

interface MermaidBlockProps {
  /** Mermaid DSL 源码（不含 ``` 围栏） */
  code: string
}

/**
 * Mermaid 图表渲染组件。
 * - 异步调用 mermaid.render 生成 SVG 后插入 DOM
 * - 监听深色模式变化自动重新渲染
 * - 渲染失败时回退到代码块展示
 */
export function MermaidBlock({ code }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [svgHtml, setSvgHtml] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    const id = `mermaid-svg-${++mermaidIdCounter}`

    const renderChart = async () => {
      try {
        const isDark = detectDarkMode()
        initMermaid(isDark)

        const { svg } = await mermaid.render(id, code.trim())
        if (!cancelled) {
          setSvgHtml(svg)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : '图表渲染失败')
          setSvgHtml('')
        }
        // mermaid.render 失败后可能在 DOM 中遗留 <svg id="...">，清理掉
        const orphan = document.getElementById(id)
        orphan?.remove()
      }
    }

    renderChart()

    // 监听深色/亮色模式切换（通过 MutationObserver 监听 <html> 的 class 变化）
    const observer = new MutationObserver(() => {
      renderChart()
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    })

    return () => {
      cancelled = true
      observer.disconnect()
    }
  }, [code])

  if (error) {
    // 渲染失败回退为等宽代码展示 + 错误提示
    return (
      <div className="mx-2 overflow-x-auto rounded-xl border border-red-300/50 bg-surface-alt px-4 py-3">
        <div className="mb-2 text-xs text-red-500">Mermaid 渲染失败：{error}</div>
        <pre className="text-xs leading-relaxed text-text-secondary">
          <code>{code}</code>
        </pre>
      </div>
    )
  }

  if (!svgHtml) {
    // 初始加载态
    return (
      <div className="mx-2 flex h-24 items-center justify-center rounded-xl border border-border/40 bg-surface-alt">
        <span className="text-xs text-text-muted animate-pulse">图表渲染中…</span>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="mx-2 overflow-x-auto rounded-xl border border-border/40 bg-surface-alt px-4 py-3 [&_svg]:max-w-full"
      // biome-ignore lint: mermaid 输出是受控的 SVG
      dangerouslySetInnerHTML={{ __html: svgHtml }}
    />
  )
}
