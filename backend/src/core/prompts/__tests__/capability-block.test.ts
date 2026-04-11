import assert from 'node:assert/strict'
import test from 'node:test'
import { buildCapabilityBlock } from '../capability-block.js'

test('buildCapabilityBlock is byte-stable for the same input', () => {
  const input = {
    executor: 'shell' as const,
    available: ['read_file', 'bash', 'write_file'],
    unavailable: ['no_external_api', 'no_browser'],
  }

  const first = buildCapabilityBlock(input)
  const second = buildCapabilityBlock(input)

  assert.equal(first, second)
})

test('buildCapabilityBlock sorts available and unavailable entries alphabetically', () => {
  const output = buildCapabilityBlock({
    executor: 'shell',
    available: ['write_file', 'bash', 'read_file'],
    unavailable: ['no_external_api', 'no_browser', 'no_deploy'],
  })

  assert.match(output, /available=\[bash, read_file, write_file\]/)
  assert.match(output, /unavailable=\[no_browser, no_deploy, no_external_api\]/)
})
