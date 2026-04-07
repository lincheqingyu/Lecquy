export interface KnowledgeChunkingOptions {
  readonly maxChars?: number
}

const DEFAULT_MAX_CHARS = 1_000
const MIN_BREAK_RATIO = 0.6

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .trim()
}

function splitLongSegment(segment: string, maxChars: number): string[] {
  const pieces: string[] = []
  let cursor = 0

  while (cursor < segment.length) {
    const tentativeEnd = Math.min(cursor + maxChars, segment.length)
    if (tentativeEnd >= segment.length) {
      const tail = segment.slice(cursor).trim()
      if (tail) pieces.push(tail)
      break
    }

    const window = segment.slice(cursor, tentativeEnd)
    const minBreakIndex = Math.floor(window.length * MIN_BREAK_RATIO)
    const breakCandidates = [
      window.lastIndexOf('\n'),
      window.lastIndexOf('. '),
      window.lastIndexOf('。'),
      window.lastIndexOf(' '),
    ].filter((index) => index >= minBreakIndex)

    const relativeBreak = breakCandidates.length > 0
      ? Math.max(...breakCandidates)
      : window.length
    const nextChunk = segment.slice(cursor, cursor + relativeBreak).trim()

    if (nextChunk) {
      pieces.push(nextChunk)
    }

    cursor += Math.max(relativeBreak, 1)
  }

  return pieces
}

export function splitKnowledgeText(
  text: string,
  options: KnowledgeChunkingOptions = {},
): string[] {
  const maxChars = Math.max(200, options.maxChars ?? DEFAULT_MAX_CHARS)
  const normalized = normalizeWhitespace(text)
  if (!normalized) return []

  const paragraphs = normalized
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)

  const chunks: string[] = []
  let currentChunk = ''

  const pushCurrentChunk = () => {
    const trimmed = currentChunk.trim()
    if (trimmed) {
      chunks.push(trimmed)
    }
    currentChunk = ''
  }

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      pushCurrentChunk()
      chunks.push(...splitLongSegment(paragraph, maxChars))
      continue
    }

    const nextChunk = currentChunk
      ? `${currentChunk}\n\n${paragraph}`
      : paragraph

    if (nextChunk.length <= maxChars) {
      currentChunk = nextChunk
      continue
    }

    pushCurrentChunk()
    currentChunk = paragraph
  }

  pushCurrentChunk()
  return chunks
}
