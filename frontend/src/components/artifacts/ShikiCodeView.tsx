import { startTransition, useEffect, useState } from 'react'
import { codeToHtml } from 'shiki'

interface ShikiCodeViewProps {
  code: string
  language: string
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
    return (
      <pre className="min-h-full overflow-x-auto bg-surface px-0 py-0 text-[13px] leading-7 text-text-primary">
        <code>{code}</code>
      </pre>
    )
  }

  return (
    <div
      className="min-h-full overflow-x-auto bg-surface [&_.shiki]:!bg-transparent [&_.shiki]:px-0 [&_.shiki]:py-0 [&_.shiki]:text-[13px] [&_.shiki]:leading-7"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
