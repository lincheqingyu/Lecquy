import assert from 'node:assert/strict'
import test from 'node:test'
import { createRunId, type ServerRequestPayload, type ServerRequestResolvedPayload } from '@lecquy/shared'
import { ConfirmationBroker, RESOLVED_MESSAGES } from '../confirmation-broker.js'

function createApprovalPayload(overrides: Partial<ServerRequestPayload> = {}) {
  return {
    sessionKey: 'sess_key',
    sessionId: 'sess_id',
    runId: createRunId('run_1'),
    itemId: 'tool_1',
    title: '需要批准：bash',
    description: '需要用户确认后才能执行 bash({"command":"rm -rf /tmp"})',
    approval: {
      mode: 'default' as const,
      operation: {
        toolName: 'bash',
        args: { command: 'rm -rf /tmp' },
        displayCommand: 'rm -rf /tmp',
      },
      availableDecisions: ['accept', 'decline'] as const,
    },
    ...overrides,
  }
}

test('ConfirmationBroker: accept 请求后返回 accepted 并广播 resolved', async () => {
  const requests: ServerRequestPayload[] = []
  const resolvedEvents: ServerRequestResolvedPayload[] = []
  const broker = new ConfirmationBroker({
    onRequest: (request) => requests.push(request),
    onResolved: (resolved) => resolvedEvents.push(resolved),
  })

  const outcomePromise = broker.create(createApprovalPayload())
  const request = requests[0]
  assert.ok(request)

  const result = broker.resolve({
    sessionKey: request.sessionKey,
    runId: request.runId,
    requestId: request.requestId,
    itemId: request.itemId,
    decision: 'accept',
  })

  assert.deepEqual(result, { ok: true })

  const outcome = await outcomePromise
  assert.equal(outcome.status, 'accepted')
  assert.equal(resolvedEvents[0]?.status, 'accepted')
})

test('ConfirmationBroker: 超时后返回 expired', async () => {
  let now = 1_000
  const resolvedEvents: ServerRequestResolvedPayload[] = []
  const broker = new ConfirmationBroker({
    ttlMs: 10,
    now: () => now,
    onResolved: (resolved) => resolvedEvents.push(resolved),
  })

  const outcomePromise = broker.create(createApprovalPayload({ itemId: 'tool_expired' }))
  await new Promise((resolve) => setTimeout(resolve, 30))
  now = 1_050

  const outcome = await outcomePromise
  assert.equal(outcome.status, 'expired')
  assert.equal(outcome.message, RESOLVED_MESSAGES.expired)
  assert.equal(resolvedEvents[0]?.status, 'expired')
  assert.equal(resolvedEvents[0]?.source, 'timeout')
  assert.equal(resolvedEvents[0]?.message, RESOLVED_MESSAGES.expired)
})

test('ConfirmationBroker: cancelByRun 会取消同 run 的所有 pending', async () => {
  const resolvedEvents: ServerRequestResolvedPayload[] = []
  const broker = new ConfirmationBroker({
    onResolved: (resolved) => resolvedEvents.push(resolved),
  })

  const outcomeOne = broker.create(createApprovalPayload({ itemId: 'tool_a' }))
  const outcomeTwo = broker.create(createApprovalPayload({ itemId: 'tool_b' }))
  broker.cancelByRun('sess_key', createRunId('run_1'), 'run_cancel')

  const [first, second] = await Promise.all([outcomeOne, outcomeTwo])
  assert.equal(first.status, 'cancelled')
  assert.equal(second.status, 'cancelled')
  assert.equal(first.message, RESOLVED_MESSAGES.cancelled)
  assert.equal(second.message, RESOLVED_MESSAGES.cancelled)
  assert.equal(resolvedEvents.every((event) => event.source === 'run_cancel'), true)
  assert.equal(resolvedEvents.every((event) => event.message === RESOLVED_MESSAGES.cancelled), true)
})

test('ConfirmationBroker: 第二次响应返回 already_resolved', async () => {
  const requests: ServerRequestPayload[] = []
  const broker = new ConfirmationBroker({
    onRequest: (request) => requests.push(request),
  })

  const outcomePromise = broker.create(createApprovalPayload({ itemId: 'tool_once' }))
  const request = requests[0]
  assert.ok(request)

  assert.deepEqual(broker.resolve({
    sessionKey: request.sessionKey,
    runId: request.runId,
    requestId: request.requestId,
    itemId: request.itemId,
    decision: 'decline',
  }), { ok: true })

  const declinedOutcome = await outcomePromise
  assert.equal(declinedOutcome.message, RESOLVED_MESSAGES.declined)
  assert.equal(broker.getPending(request.sessionKey).length, 0)

  assert.deepEqual(broker.resolve({
    sessionKey: request.sessionKey,
    runId: request.runId,
    requestId: request.requestId,
    itemId: request.itemId,
    decision: 'decline',
  }), { ok: false, reason: 'already_resolved' })
})
