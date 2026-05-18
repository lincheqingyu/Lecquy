// 中文：本文件（chat-attachments.ts）位于 frontend/src/lib/chat-attachments.ts，属于frontend链路中的前端共享库代码，连接上游调用方与下游执行逻辑。
// English: This file (chat-attachments.ts) belongs to the frontend 前端共享库 layer in frontend/src/lib/chat-attachments.ts, wiring upstream callers with downstream runtime logic.

import type { ChatAttachment } from '@lecquy/shared'
import { parseAsync } from 'docx-preview'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import * as pdfjsLib from 'pdfjs-dist'
import * as XLSX from 'xlsx'

export const MODEL_ATTACHMENT_TEXT_CHAR_LIMIT = 20_000
const TEXT_EXTENSIONS = new Set([
  'txt',
  'md',
  'markdown',
  'json',
  'csv',
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'sql',
  'yaml',
  'yml',
  'xml',
  'html',
  'css',
  'scss',
  'log',
  'pdf',
  'docx',
  'xlsx',
  'xls',
])

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

function getExtension(fileName: string): string {
  const parts = fileName.split('.')
  return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
}

function isTextLikeFile(file: File): boolean {
  if (file.type.startsWith('text/')) return true
  if ([
    'application/json',
    'application/xml',
    'application/javascript',
    'application/x-javascript',
  ].includes(file.type)) {
    return true
  }
  return TEXT_EXTENSIONS.has(getExtension(file.name))
}

function normalizeAttachmentText(text: string): string {
  return text.replace(/\r\n/g, '\n').trim()
}

function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
  return {
    text: text.length > maxChars ? text.slice(0, maxChars) : text,
    truncated: text.length > maxChars,
  }
}

function createTextAttachment(
  file: File,
  text: string,
  mimeType: string,
): ChatAttachment {
  const normalized = normalizeAttachmentText(text)
  const { text: modelText, truncated } = truncateText(normalized, MODEL_ATTACHMENT_TEXT_CHAR_LIMIT)

  return {
    kind: 'file',
    name: file.name,
    mimeType,
    text: modelText,
    displayText: normalized !== modelText ? normalized : undefined,
    size: file.size,
    truncated,
  }
}

function sanitizeAttribute(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') {
        reject(new Error('无法读取图片内容'))
        return
      }
      resolve(reader.result)
    }
    reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

export function buildAttachmentPreviewUrl(attachment: ChatAttachment): string | null {
  if (attachment.kind !== 'image') return null
  return `data:${attachment.mimeType};base64,${attachment.data}`
}

export function getAttachmentDisplayText(attachment: ChatAttachment): string {
  if (attachment.kind !== 'file') return ''
  return attachment.displayText ?? attachment.text
}

async function readPdfAttachment(file: File): Promise<ChatAttachment> {
  const arrayBuffer = await file.arrayBuffer()
  let pdf: PDFDocumentProxy | null = null

  try {
    pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

    let extractedText = `<pdf filename="${sanitizeAttribute(file.name)}">`
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const textContent = await page.getTextContent()
      const pageText = textContent.items
        .map((item) => ('str' in item ? item.str : ''))
        .filter((text) => text.trim())
        .join(' ')
      extractedText += `\n<page number="${pageNumber}">\n${pageText}\n</page>`
    }
    extractedText += '\n</pdf>'

    return createTextAttachment(file, extractedText, file.type || 'application/pdf')
  } catch {
    throw new Error(`PDF 解析失败：${file.name}`)
  } finally {
    if (pdf) {
      pdf.destroy()
    }
  }
}

function extractTextFromDocxElement(element: {
  type?: string
  text?: string
  children?: unknown[]
}): string {
  let text = ''
  const elementType = element.type?.toLowerCase() || ''

  if (elementType === 'paragraph' && Array.isArray(element.children)) {
    for (const child of element.children as Array<{ type?: string; text?: string; children?: unknown[] }>) {
      const childType = child.type?.toLowerCase() || ''
      if (childType === 'run' && Array.isArray(child.children)) {
        for (const textChild of child.children as Array<{ type?: string; text?: string }>) {
          if ((textChild.type?.toLowerCase() || '') === 'text') {
            text += textChild.text || ''
          }
        }
      } else if (childType === 'text') {
        text += child.text || ''
      }
    }
  } else if (elementType === 'table' && Array.isArray(element.children)) {
    const tableTexts: string[] = []
    for (const row of element.children as Array<{ type?: string; children?: unknown[] }>) {
      if ((row.type?.toLowerCase() || '') !== 'tablerow' || !Array.isArray(row.children)) continue
      const rowTexts: string[] = []
      for (const cell of row.children as Array<{ type?: string; children?: unknown[] }>) {
        if ((cell.type?.toLowerCase() || '') !== 'tablecell' || !Array.isArray(cell.children)) continue
        const cellTexts: string[] = []
        for (const cellElement of cell.children as Array<{ type?: string; text?: string; children?: unknown[] }>) {
          const cellText = extractTextFromDocxElement(cellElement)
          if (cellText) cellTexts.push(cellText)
        }
        if (cellTexts.length > 0) rowTexts.push(cellTexts.join(' '))
      }
      if (rowTexts.length > 0) tableTexts.push(rowTexts.join(' | '))
    }
    if (tableTexts.length > 0) {
      text = `\n[Table]\n${tableTexts.join('\n')}\n[/Table]\n`
    }
  } else if (Array.isArray(element.children)) {
    const childTexts: string[] = []
    for (const child of element.children as Array<{ type?: string; text?: string; children?: unknown[] }>) {
      const childText = extractTextFromDocxElement(child)
      if (childText) childTexts.push(childText)
    }
    text = childTexts.join(' ')
  }

  return text.trim()
}

async function readDocxAttachment(file: File): Promise<ChatAttachment> {
  const arrayBuffer = await file.arrayBuffer()

  try {
    const wordDocument = await parseAsync(arrayBuffer)
    let extractedText = `<docx filename="${sanitizeAttribute(file.name)}">\n<page number="1">\n`

    const body = wordDocument.documentPart?.body
    if (body?.children) {
      const texts: string[] = []
      for (const element of body.children) {
        const text = extractTextFromDocxElement(element as { type?: string; text?: string; children?: unknown[] })
        if (text) texts.push(text)
      }
      extractedText += texts.join('\n')
    }

    extractedText += '\n</page>\n</docx>'

    return createTextAttachment(
      file,
      extractedText,
      file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    )
  } catch {
    throw new Error(`DOCX 解析失败：${file.name}`)
  }
}

async function readExcelAttachment(file: File): Promise<ChatAttachment> {
  try {
    const arrayBuffer = await file.arrayBuffer()
    const workbook = XLSX.read(arrayBuffer, { type: 'array' })
    let extractedText = `<excel filename="${sanitizeAttribute(file.name)}">`

    for (const [index, sheetName] of workbook.SheetNames.entries()) {
      const worksheet = workbook.Sheets[sheetName]
      const csvText = XLSX.utils.sheet_to_csv(worksheet)
      extractedText += `\n<sheet name="${sanitizeAttribute(sheetName)}" index="${index + 1}">\n${csvText}\n</sheet>`
    }

    extractedText += '\n</excel>'

    return createTextAttachment(
      file,
      extractedText,
      file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    )
  } catch {
    throw new Error(`Excel 解析失败：${file.name}`)
  }
}

export async function readChatAttachment(file: File): Promise<ChatAttachment> {
  if (file.type.startsWith('image/')) {
    const dataUrl = await readFileAsDataUrl(file)
    const [, base64 = ''] = dataUrl.split(',', 2)
    return {
      kind: 'image',
      name: file.name,
      mimeType: file.type || 'image/png',
      data: base64,
      size: file.size,
    }
  }

  const extension = getExtension(file.name)

  if (extension === 'pdf' || file.type === 'application/pdf') {
    return await readPdfAttachment(file)
  }

  if (
    extension === 'docx'
    || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return await readDocxAttachment(file)
  }

  if (
    extension === 'xlsx'
    || extension === 'xls'
    || file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    || file.type === 'application/vnd.ms-excel'
  ) {
    return await readExcelAttachment(file)
  }

  if (extension === 'doc' || file.type === 'application/msword') {
    throw new Error(`暂时还不支持解析 .doc 老格式文件，请先另存为 .docx 或 pdf：${file.name}`)
  }

  if (!isTextLikeFile(file)) {
    throw new Error(`暂时只支持图片和文本类文件，当前文件不支持：${file.name}`)
  }

  const text = await file.text()
  return createTextAttachment(file, text, file.type || 'text/plain')
}
