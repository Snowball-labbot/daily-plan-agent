import assert from 'node:assert/strict'
import test from 'node:test'
import { finalAssistantText, sessionEvents, type SessionEvent } from '../src/sessionLog.ts'

/**
 * Regression tests for the bug that made the whole review pipeline fail.
 *
 * The plugin read `session.events`, which does not exist — the Session class
 * exposes `log`. Every run threw `events is not iterable`, the review fell back
 * to the rule-based summary, and the UI said "整理失败", which pointed at Agnes
 * instead of at one wrong property name.
 */

function event(seq: number, type: string, data: Record<string, unknown> = {}): SessionEvent {
  return { seq, type, data }
}

test('reads the log, which is what the Session class actually exposes', () => {
  const events = [event(0, 'session/start')]
  assert.equal(sessionEvents({ log: events }).length, 1)
})

test('still reads `events` if it ever comes back', () => {
  const events = [event(0, 'session/start')]
  assert.equal(sessionEvents({ events }).length, 1)
})

test('prefers log when both are present', () => {
  assert.equal(sessionEvents({ log: [event(1, 'a')], events: [event(2, 'b')] })[0]?.seq, 1)
})

test('an unreadable session yields an empty list instead of throwing', () => {
  assert.deepEqual(sessionEvents(undefined), [])
  assert.deepEqual(sessionEvents(null), [])
  assert.deepEqual(sessionEvents({}), [])
  assert.deepEqual(sessionEvents({ log: 'not-an-array' }), [])
  assert.deepEqual(sessionEvents({ log: { length: 3 } }), [], 'array-like is not an array')
})

test('collects the assistant text from message events', () => {
  const reply = {
    seq: 2,
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: '好的，我整理好了。' }] } },
  }
  assert.equal(finalAssistantText([event(0, 'turn/start'), reply], 0).text, '好的，我整理好了。')
})

test('ignores text that arrived before this turn started', () => {
  const stale = {
    seq: 1,
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: '上一轮的回复' }] } },
  }
  const fresh = {
    seq: 9,
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: '这一轮的回复' }] } },
  }
  assert.equal(finalAssistantText([stale, fresh], 5).text, '这一轮的回复')
})

test('joins multiple text blocks and skips non-text ones', () => {
  const reply = {
    seq: 3,
    type: 'assistant/message',
    data: {
      message: {
        content: [
          { type: 'text', text: '第一段' },
          { type: 'tool_use', name: 'read' },
          { type: 'text', text: '第二段' },
        ],
      },
    },
  }
  assert.equal(finalAssistantText([reply], 0).text, '第一段第二段')
})

test('an empty assistant message does not wipe a real one', () => {
  const real = {
    seq: 3,
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: '正文' }] } },
  }
  const usageOnly = { seq: 4, type: 'assistant/message', data: { message: { content: [] } } }
  assert.equal(finalAssistantText([real, usageOnly], 0).text, '正文')
})

test('a turn only counts as completed on turn/end with kind=completed', () => {
  const reply = {
    seq: 3,
    type: 'assistant/message',
    data: { message: { content: [{ type: 'text', text: '好' }] } },
  }
  const done = event(4, 'turn/end', { reason: { kind: 'completed' } })
  const interrupted = event(4, 'turn/end', { reason: { kind: 'interrupted' } })

  assert.equal(finalAssistantText([reply, done], 0).completed, true)
  assert.equal(finalAssistantText([reply, interrupted], 0).completed, false)
  assert.equal(finalAssistantText([reply], 0).completed, false, 'a missing turn/end is not success')
  assert.equal(finalAssistantText([], 0).text, '')
})
