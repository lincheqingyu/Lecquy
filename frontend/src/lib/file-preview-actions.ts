// 中文：本文件（file-preview-actions.ts）位于 frontend/src/lib/file-preview-actions.ts，属于frontend链路中的前端共享库代码，连接上游调用方与下游执行逻辑。
// English: This file (file-preview-actions.ts) belongs to the frontend 前端共享库 layer in frontend/src/lib/file-preview-actions.ts, wiring upstream callers with downstream runtime logic.

function createObjectUrlDownload(url: string, fileName: string) {
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  link.target = '_blank'
  link.rel = 'noreferrer'
  link.click()
}

export function createDownloadLink(url: string, fileName: string) {
  createObjectUrlDownload(url, fileName)
}

export function downloadTextContent(content: string, fileName: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType || 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  try {
    createObjectUrlDownload(url, fileName)
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
}

export function openPrintWindow(title: string, content: string) {
  const printWindow = window.open('', '_blank', 'noopener,noreferrer')
  if (!printWindow) return

  printWindow.document.open()
  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${title}</title>
        <style>
          body { margin: 0; padding: 32px; font-family: Georgia, 'Times New Roman', serif; color: #0f172a; background: #ffffff; }
          pre, code { font-family: 'SFMono-Regular', 'Consolas', monospace; white-space: pre-wrap; word-break: break-word; }
          img { max-width: 100%; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #e2e8f0; padding: 8px 10px; }
        </style>
      </head>
      <body>${content}</body>
    </html>
  `)
  printWindow.document.close()
  printWindow.focus()
  printWindow.print()
}
