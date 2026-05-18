// 中文：本文件（chunking.test.ts）位于 backend/src/rag/chunking.test.ts，属于backend链路中的测试用例代码，连接上游调用方与下游执行逻辑。
// English: This file (chunking.test.ts) belongs to the backend 测试用例 layer in backend/src/rag/chunking.test.ts, wiring upstream callers with downstream runtime logic.

import test from 'node:test'
import assert from 'node:assert/strict'
import { splitKnowledgeText } from './chunking.js'

test('splitKnowledgeText keeps short content as a single chunk', () => {
  assert.deepEqual(splitKnowledgeText('short content'), ['short content'])
})

test('splitKnowledgeText prefers paragraph boundaries before splitting long content', () => {
  const chunks = splitKnowledgeText([
    'Paragraph one '.repeat(12),
    'Paragraph two '.repeat(12),
    'Paragraph three '.repeat(12),
  ].join('\n\n'), { maxChars: 260 })

  assert.equal(chunks.length, 3)
  assert.match(chunks[0] ?? '', /Paragraph one/)
  assert.match(chunks[1] ?? '', /Paragraph two/)
  assert.match(chunks[2] ?? '', /Paragraph three/)
})

test('splitKnowledgeText slices oversized paragraphs into stable smaller chunks', () => {
  const longLine = 'token '.repeat(260)
  const chunks = splitKnowledgeText(longLine, { maxChars: 220 })

  assert.ok(chunks.length > 1)
  assert.ok(chunks.every((chunk) => chunk.length <= 220))
})
