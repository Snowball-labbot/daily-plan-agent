import assert from 'node:assert/strict'
import { test } from 'node:test'
import { phoneViewport } from '../src/client/ui/phoneViewport.ts'

test('phone panels stay inside the keyboard-visible viewport after Safari pans', () => {
  const frame = phoneViewport(844, 390, 120)
  assert.deepEqual(frame, { height: 390, top: 120, bottom: 334 })
  assert.equal(844 - frame.bottom, frame.top + frame.height)
})

test('resizing browsers and pinch zoom do not double-reduce panel height', () => {
  assert.deepEqual(phoneViewport(390, 390, 0), {
    height: 390,
    top: 0,
    bottom: 0,
  })
  assert.deepEqual(phoneViewport(844, 422, 100, 2), {
    height: 844,
    top: 0,
    bottom: 0,
  })
  assert.deepEqual(phoneViewport(664, 700, 30), {
    height: 664,
    top: 0,
    bottom: 0,
  })
})
