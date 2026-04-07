import test from 'node:test'
import assert from 'node:assert/strict'
import type { Pool } from 'pg'
import { searchKnowledgeChunks } from './knowledge-repository.js'

interface MockQueryResult<Row> {
  readonly rows: Row[]
}

function createMockPool(args: {
  readonly trgmInstalled: boolean
  readonly searchRows: Array<Record<string, unknown>>
}): Pool {
  const query = async <Row>(sql: string, params?: unknown[]): Promise<MockQueryResult<Row>> => {
    if (sql.includes('FROM pg_extension')) {
      return { rows: [{ installed: args.trgmInstalled }] as Row[] }
    }

    if (sql.includes('FROM knowledge_chunks')) {
      return { rows: args.searchRows as Row[] }
    }

    throw new Error(`unexpected query: ${sql}\nparams=${JSON.stringify(params ?? [])}`)
  }

  return { query } as unknown as Pool
}

test('searchKnowledgeChunks returns empty array for too-short queries', async () => {
  const pool = createMockPool({ trgmInstalled: true, searchRows: [] })

  const result = await searchKnowledgeChunks(pool, { query: 'a' })

  assert.deepEqual(result, [])
})

test('searchKnowledgeChunks maps trigram results into KnowledgeChunkHit', async () => {
  const pool = createMockPool({
    trgmInstalled: true,
    searchRows: [{
      chunk_id: 'kchunk_1',
      document_id: 'kdoc_1',
      content: 'PostgreSQL trigram search for RAG chunks',
      score: 6.5,
      metadata_json: {
        title: 'RAG Notes',
        source_type: 'note',
        seq: 0,
      },
    }],
  })

  const result = await searchKnowledgeChunks(pool, {
    query: 'trigram search',
    topK: 3,
    sourceFilter: ['note'],
  })

  assert.deepEqual(result, [{
    chunkId: 'kchunk_1',
    documentId: 'kdoc_1',
    content: 'PostgreSQL trigram search for RAG chunks',
    score: 6.5,
    metadata: {
      title: 'RAG Notes',
      source_type: 'note',
      seq: 0,
    },
  }])
})

test('searchKnowledgeChunks falls back when pg_trgm is unavailable', async () => {
  const pool = createMockPool({
    trgmInstalled: false,
    searchRows: [{
      chunk_id: 'kchunk_2',
      document_id: 'kdoc_2',
      content: 'simple fts fallback',
      score: 3.2,
      metadata_json: {
        title: 'Fallback Doc',
        source_type: 'doc',
      },
    }],
  })

  const result = await searchKnowledgeChunks(pool, {
    query: 'fts fallback',
  })

  assert.equal(result[0]?.chunkId, 'kchunk_2')
  assert.equal(result[0]?.documentId, 'kdoc_2')
  assert.equal(result[0]?.score, 3.2)
})
