// 中文：本文件（ShikiCodeView.tsx）位于 frontend/src/components/artifacts/ShikiCodeView.tsx，属于frontend链路中的前端组件代码，连接上游调用方与下游执行逻辑。
// English: This file (ShikiCodeView.tsx) belongs to the frontend 前端组件 layer in frontend/src/components/artifacts/ShikiCodeView.tsx, wiring upstream callers with downstream runtime logic.

import { startTransition, useEffect, useState } from 'react'
import { codeToHtml } from 'shiki'

interface ShikiCodeViewProps {
  code: string
  language: string
}

function FallbackCodeView({ code }: { code: string }) {
  const lines = code.split('\n')

  return (
    <div className="artifact-code-with-lines min-h-full overflow-x-hidden bg-surface text-[12px] text-text-primary">
      <pre className="min-h-full bg-transparent px-0 py-0">
        <code>
          {lines.map((line, index) => (
            <span key={`${index}:${line.length}`} className="line">
              {line.length > 0 ? line : ' '}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}

export function ShikiCodeView({ code, language }: ShikiCodeViewProps) {
  const [html, setHtml] = useState<string>('')
  const [hasError, setHasError] = useState(false)
  const [isDark, setIsDark] = useState(() => (
    typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  ))

  useEffect(() => {
    const root = document.documentElement
    const observer = new MutationObserver(() => {
      setIsDark(root.classList.contains('dark'))
    })

    observer.observe(root, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    let disposed = false

    startTransition(() => {
      void codeToHtml(code, {
        lang: language,
        theme: isDark ? 'github-dark' : 'github-light',
      })
        .then((result) => {
          if (disposed) return
          setHtml(result)
          setHasError(false)
        })
        .catch(() => {
          if (disposed) return
          setHtml('')
          setHasError(true)
        })
    })

    return () => {
      disposed = true
    }
  }, [code, isDark, language])

  if (hasError || !html) {
    return <FallbackCodeView code={code} />
  }

  return (
    <div
      className="artifact-code-with-lines min-h-full overflow-x-hidden bg-surface text-[12px] [&_.shiki]:!bg-transparent [&_.shiki]:m-0 [&_.shiki]:w-full [&_.shiki]:min-w-0 [&_.shiki]:px-0 [&_.shiki]:py-0 [&_.shiki]:text-[12px] [&_.shiki_code]:block [&_.shiki_code]:min-w-0"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
