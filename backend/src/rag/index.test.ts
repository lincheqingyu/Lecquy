// 中文：本文件（index.test.ts）位于 backend/src/rag/index.test.ts，属于backend链路中的测试用例代码，连接上游调用方与下游执行逻辑。
// English: This file (index.test.ts) belongs to the backend 测试用例 layer in backend/src/rag/index.test.ts, wiring upstream callers with downstream runtime logic.

import test from 'node:test'
import assert from 'node:assert/strict'
import { ingestKnowledgeDocument, searchKnowledgeChunks } from './index.js'

test('ingestKnowledgeDocument uses multi-chunk strategy when PostgreSQL is disabled', async () => {
  const result = await ingestKnowledgeDocument({
    sourceType: 'note',
    title: 'Chunking demo',
    content: [
      'First paragraph '.repeat(30),
      'Second paragraph '.repeat(30),
      'Third paragraph '.repeat(30),
    ].join('\n\n'),
  })

  assert.match(result.documentId, /^kdoc_/)
  assert.ok(result.chunkCount > 1)
})

test('searchKnowledgeChunks returns empty array when PostgreSQL is disabled', async () => {
  const result = await searchKnowledgeChunks({
    query: 'knowledge search',
  })

  assert.deepEqual(result, [])
})
