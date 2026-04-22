/**
 * PermissionTier 桥接测试
 */

import assert from 'node:assert/strict'
import test from 'node:test'

import { PermissionTier } from '../../../core/prompts/prompt-layer-types.js'
import { bridgeResult, decisionToTier, isHardDeny } from '../tier-bridge.js'
import type { PermissionResult } from '../types.js'

test('decisionToTier 翻译四种行为', () => {
  assert.equal(decisionToTier({ behavior: 'allow', reason: '' }), PermissionTier.Auto)
  assert.equal(decisionToTier({ behavior: 'deny', reason: '' }), PermissionTier.Confirm)
  assert.equal(decisionToTier({ behavior: 'ask', reason: '' }), PermissionTier.Confirm)
  assert.equal(decisionToTier({ behavior: 'plan', reason: '' }), PermissionTier.Confirm)
})

test('isHardDeny 只对 deny true', () => {
  assert.equal(isHardDeny({ behavior: 'deny', reason: '' }), true)
  assert.equal(isHardDeny({ behavior: 'ask', reason: '' }), false)
  assert.equal(isHardDeny({ behavior: 'allow', reason: '' }), false)
  assert.equal(isHardDeny({ behavior: 'plan', reason: '' }), false)
})

test('bridgeResult 普通 allow 返回 Auto', () => {
  const result: PermissionResult = {
    decision: { behavior: 'allow', reason: '无需确认' },
    timestamp: Date.now(),
  }
  const bridged = bridgeResult(result)
  assert.equal(bridged.tier, PermissionTier.Auto)
  assert.equal(bridged.hardDeny, false)
})

test('bridgeResult ask 返回 Confirm', () => {
  const result: PermissionResult = {
    decision: { behavior: 'ask', reason: '需要用户确认' },
    timestamp: Date.now(),
  }
  const bridged = bridgeResult(result)
  assert.equal(bridged.tier, PermissionTier.Confirm)
  assert.match(bridged.description, /需要用户确认/)
})

test('bridgeResult acceptEdits 放行识别为 Preamble', () => {
  const result: PermissionResult = {
    decision: { behavior: 'allow', reason: 'acceptEdits 模式自动接受编辑/读取' },
    timestamp: Date.now(),
  }
  const bridged = bridgeResult(result)
  assert.equal(bridged.tier, PermissionTier.Preamble)
})

test('bridgeResult deny 返回 Confirm 并标记 hardDeny', () => {
  const result: PermissionResult = {
    decision: { behavior: 'deny', reason: '危险命令' },
    timestamp: Date.now(),
  }
  const bridged = bridgeResult(result)
  assert.equal(bridged.tier, PermissionTier.Confirm)
  assert.equal(bridged.hardDeny, true)
})
