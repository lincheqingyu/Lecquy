import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_FILE_TEXT_CHARS,
  MAX_IMAGE_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
  runStartSchema,
} from './api.js'

const route = {
  channel: 'webchat' as const,
  chatType: 'dm' as const,
}

function parseAttachments(attachments: unknown[]) {
  return runStartSchema.safeParse({
    route,
    input: '',
    attachments,
  })
}

test('runStartSchema rejects a single oversized image attachment', () => {
  const result = parseAttachments([{
    kind: 'image',
    name: 'big.png',
    mimeType: 'image/png',
    data: 'a'.repeat(MAX_IMAGE_BYTES + 1),
  }])

  assert.equal(result.success, false)
  assert.match(result.success ? '' : result.error.issues[0].message, /big\.png/)
})

test('runStartSchema rejects a single oversized file attachment', () => {
  const result = parseAttachments([{
    kind: 'file',
    name: 'big.txt',
    mimeType: 'text/plain',
    text: 'a'.repeat(MAX_FILE_TEXT_CHARS + 1),
  }])

  assert.equal(result.success, false)
  assert.match(result.success ? '' : result.error.issues[0].message, /big\.txt/)
})

test('runStartSchema rejects total attachment payloads over the per-message limit', () => {
  const half = Math.floor(MAX_TOTAL_ATTACHMENT_BYTES / 2)
  const result = parseAttachments([
    {
      kind: 'image',
      name: 'one.png',
      mimeType: 'image/png',
      data: 'a'.repeat(half),
    },
    {
      kind: 'image',
      name: 'two.png',
      mimeType: 'image/png',
      data: 'a'.repeat(MAX_TOTAL_ATTACHMENT_BYTES - half + 1),
    },
  ])

  assert.equal(result.success, false)
  assert.match(result.success ? '' : result.error.issues.at(-1)?.message ?? '', /附件总大小超过上限/)
})

test('runStartSchema accepts attachment payloads at boundary values', () => {
  const result = parseAttachments([
    {
      kind: 'image',
      name: 'ok.png',
      mimeType: 'image/png',
      data: 'a'.repeat(MAX_IMAGE_BYTES),
    },
    {
      kind: 'file',
      name: 'ok.txt',
      mimeType: 'text/plain',
      text: 'b'.repeat(MAX_FILE_TEXT_CHARS),
    },
  ])

  assert.equal(result.success, true)
})
