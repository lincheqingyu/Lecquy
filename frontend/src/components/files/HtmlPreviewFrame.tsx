// 中文：本文件（HtmlPreviewFrame.tsx）位于 frontend/src/components/files/HtmlPreviewFrame.tsx，属于frontend链路中的前端组件代码，连接上游调用方与下游执行逻辑。
// English: This file (HtmlPreviewFrame.tsx) belongs to the frontend 前端组件 layer in frontend/src/components/files/HtmlPreviewFrame.tsx, wiring upstream callers with downstream runtime logic.

import clsx from 'clsx'

export const INTERACTIVE_HTML_SANDBOX = [
  'allow-downloads',
  'allow-forms',
  'allow-modals',
  'allow-pointer-lock',
  'allow-popups',
  'allow-popups-to-escape-sandbox',
  'allow-same-origin',
  'allow-scripts',
].join(' ')

interface HtmlPreviewFrameProps {
  title: string
  html: string
  resetKey?: number
  className?: string
}

export function HtmlPreviewFrame({ title, html, resetKey = 0, className }: HtmlPreviewFrameProps) {
  return (
    <div className={clsx('min-h-[18rem] flex-1 overflow-hidden bg-surface', className)}>
      <iframe
        key={`${title}:${resetKey}`}
        title={title}
        sandbox={INTERACTIVE_HTML_SANDBOX}
        srcDoc={html}
        className="min-h-0 h-full w-full bg-white"
      />
    </div>
  )
}
