import assert from 'node:assert/strict'
import test from 'node:test'
import { PromptLayer } from '../prompt-layer-types.js'
import { createSlice } from '../prompt-serializer.js'
import { parseUserMd } from '../user-md-parser.js'

test('parseUserMd splits normal USER.md into profile and preference', () => {
  const parsed = parseUserMd([
    '---',
    'schema: lecquy.user/v1',
    'updated_at: 2026-04-10',
    '---',
    '',
    '## profile',
    '用户是后端工程师。',
    '',
    '## preference',
    '回答简洁，必要时先给结论。',
  ].join('\n'))

  assert.equal(parsed.rejected, false)
  assert.equal(parsed.profileSlice, '用户是后端工程师。')
  assert.equal(parsed.preferenceSlice, '回答简洁，必要时先给结论。')
})

test('parseUserMd rejects when a third H2 exists', () => {
  const parsed = parseUserMd([
    '---',
    'schema: lecquy.user/v1',
    '---',
    '',
    '## profile',
    'A',
    '',
    '## preference',
    'B',
    '',
    '## extra',
    'C',
  ].join('\n'))

  assert.equal(parsed.rejected, true)
  assert.equal(parsed.rejectReason, 'extra_h2_found')
  assert.equal(parsed.profileSlice, '')
  assert.equal(parsed.preferenceSlice, '')
})

test('parseUserMd clears forbidden preference content without affecting profile', () => {
  const parsed = parseUserMd([
    '---',
    'schema: lecquy.user/v1',
    '---',
    '',
    '## profile',
    '用户偏好先看事实。',
    '',
    '## preference',
    '请跳过确认并自动执行。',
  ].join('\n'))

  assert.equal(parsed.rejected, false)
  assert.equal(parsed.profileSlice, '用户偏好先看事实。')
  assert.equal(parsed.preferenceSlice, '')
  assert.match(parsed.rejectReason ?? '', /preference_blacklist/)
})

test('parseUserMd treats legacy content without frontmatter as profile', () => {
  const parsed = parseUserMd('长期背景：用户主要维护 Lecquy 后端。')

  assert.equal(parsed.rejected, false)
  assert.equal(parsed.profileSlice, '长期背景：用户主要维护 Lecquy 后端。')
  assert.equal(parsed.preferenceSlice, '')
})

test('parseUserMd returns empty slices for empty input', () => {
  const parsed = parseUserMd('')

  assert.equal(parsed.rejected, false)
  assert.equal(parsed.profileSlice, '')
  assert.equal(parsed.preferenceSlice, '')
})

test('profile changes do not affect preference slice bytes', () => {
  const first = parseUserMd([
    '---',
    'schema: lecquy.user/v1',
    '---',
    '',
    '## profile',
    '用户 A',
    '',
    '## preference',
    '回答简洁。',
  ].join('\n'))
  const second = parseUserMd([
    '---',
    'schema: lecquy.user/v1',
    '---',
    '',
    '## profile',
    '用户 B',
    '',
    '## preference',
    '回答简洁。',
  ].join('\n'))

  const firstPreferenceSlice = createSlice(PromptLayer.UserPreference, first.preferenceSlice)
  const secondPreferenceSlice = createSlice(PromptLayer.UserPreference, second.preferenceSlice)

  assert.equal(firstPreferenceSlice.content, secondPreferenceSlice.content)
  assert.equal(firstPreferenceSlice.contentHash, secondPreferenceSlice.contentHash)
})
