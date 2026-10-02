import { gymSetFromFields } from '../src/gym.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import type { GymSessionRecord } from '../src/domain.ts'
import {
  lastSessionForPart,
  nextPart,
  reuseSessionItems,
  rotateFocus,
  sessionProgress,
  suggestFocus,
} from '../src/gym.ts'

const ROTATION = ['chest', 'back', 'legs', 'shoulders'] as const

function session(
  date: string,
  focus: GymSessionRecord['focus'],
  items: GymSessionRecord['items'] = [],
): GymSessionRecord {
  return { schemaVersion: 1, date, focus, items, finishedAt: null, feeling: null }
}

test('nextPart walks the rotation and wraps', () => {
  assert.equal(nextPart(null, ROTATION), 'chest')
  assert.equal(nextPart('chest', ROTATION), 'back')
  assert.equal(nextPart('shoulders', ROTATION), 'chest')
  assert.equal(nextPart(null, []), null)
})

test('nextPart falls back to the head for an unknown part', () => {
  assert.equal(nextPart('core', ROTATION), 'chest')
})

test('suggestFocus starts the rotation when there is no history', () => {
  const suggestion = suggestFocus({ history: [], rotation: ROTATION, restDays: [], weekday: 1 })
  assert.deepEqual(suggestion.focus, ['chest'])
  assert.equal(suggestion.reason, 'start')
})

test('suggestFocus advances from the most recent session', () => {
  const suggestion = suggestFocus({
    history: [session('2026-09-14', ['chest'])],
    rotation: ROTATION,
    restDays: [],
    weekday: 1,
  })
  assert.deepEqual(suggestion.focus, ['back'])
})

test('suggestFocus reads the most recent of several sessions', () => {
  const suggestion = suggestFocus({
    history: [session('2026-09-14', ['chest']), session('2026-09-16', ['legs'])],
    rotation: ROTATION,
    restDays: [],
    weekday: 1,
  })
  assert.deepEqual(suggestion.focus, ['shoulders'])
})

test('suggestFocus returns a rest day', () => {
  const suggestion = suggestFocus({
    history: [session('2026-09-14', ['chest'])],
    rotation: ROTATION,
    restDays: [7],
    weekday: 7,
  })
  assert.deepEqual(suggestion.focus, [])
  assert.equal(suggestion.reason, 'rest')
})

test('rotateFocus advances one step', () => {
  assert.deepEqual(rotateFocus(['chest'], ROTATION), ['back'])
  assert.deepEqual(rotateFocus(['shoulders'], ROTATION), ['chest'])
})

test('lastSessionForPart finds the newest matching session', () => {
  const found = lastSessionForPart(
    [session('2026-09-10', ['chest']), session('2026-09-16', ['chest'])],
    'chest',
  )
  assert.equal(found?.date, '2026-09-16')
  assert.equal(lastSessionForPart([session('2026-09-10', ['legs'])], 'chest'), undefined)
})

test('reuseSessionItems copies with fresh ids and a reset checklist', () => {
  const source = session('2026-09-16', ['chest'], [
    {
      id: 'old-1',
      exerciseId: 'x_chest_杠铃卧推',
      name: '杠铃卧推',
      part: 'chest',
      sets: 4,
      reps: '8-12',
      weight: '40kg',
      doneSets: 4,
      note: '状态不错',
    },
  ])
  const items = reuseSessionItems(source, 'chest', (index) => `new-${String(index)}`)
  assert.equal(items.length, 1)
  assert.equal(items[0]?.id, 'new-0')
  assert.equal(items[0]?.doneSets, 0)
  assert.equal(items[0]?.weight, '40kg')
  assert.equal(items[0]?.note, '')
})

test('reuseSessionItems falls back to the whole session when the part has no items', () => {
  const source = session('2026-09-16', ['chest', 'core'], [
    {
      id: 'old-1',
      exerciseId: 'x_chest_杠铃卧推',
      name: '杠铃卧推',
      part: 'chest',
      sets: 4,
      reps: '8-12',
      weight: '',
      doneSets: 0,
      note: '',
    },
  ])
  const items = reuseSessionItems(source, 'core', (index) => `new-${String(index)}`)
  assert.equal(items.length, 1)
  assert.equal(items[0]?.part, 'chest')
})

test('sessionProgress aggregates logged and total sets', () => {
  const items = [
    {
      id: 'a',
      exerciseId: 'x',
      name: 'a',
      part: 'chest' as const,
      sets: 4,
      reps: '8',
      weight: '',
      doneSets: 3,
      note: '',
    },
    {
      id: 'b',
      exerciseId: 'y',
      name: 'b',
      part: 'chest' as const,
      sets: 3,
      reps: '10',
      weight: '',
      doneSets: 9,
      note: '',
    },
  ]
  assert.deepEqual(sessionProgress(items), { logged: 6, total: 7 })
})


test('single row set recording accepts actual numbers and rejects planned ranges', () => {
  assert.deepEqual(gymSetFromFields('10', '40kg'), { reps: 10, weight: 40, unit: 'kg', rir: null })
  assert.deepEqual(gymSetFromFields('12', '20 lb'), { reps: 12, weight: 20, unit: 'lb', rir: null })
  assert.deepEqual(gymSetFromFields('8', '自重'), { reps: 8, weight: null, unit: 'bodyweight', rir: null })
  assert.deepEqual(gymSetFromFields('10', ''), { reps: 10, weight: null, unit: 'kg', rir: null })
  assert.equal(gymSetFromFields('8-12', '40'), null)
  assert.equal(gymSetFromFields('AMAP', '40'), null)
  assert.equal(gymSetFromFields('0', '40'), null)
  assert.equal(gymSetFromFields('10', '-40'), null)
  assert.equal(gymSetFromFields('10', '重量未知'), null)
})
