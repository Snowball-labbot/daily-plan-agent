import assert from 'node:assert/strict'
import test from 'node:test'
import { isPathSafeKey, newId, stableHash } from '../src/identity.ts'
import { DEFAULT_PERIODS, SEED_EXERCISES } from '../src/seed.ts'

/**
 * Regression guard for a bug that cost real debugging time: the storage backend
 * writes one file per record and rejects any key outside /^[a-zA-Z0-9_-]+$/.
 * The gym seed used `x_chest_杠铃卧推`, so every write threw and the library
 * rendered as empty with no error anywhere in the UI.
 *
 * Anything that becomes a *table key* has to be ASCII. In-record ids (block ids
 * inside a day plan) do not, which is why they are not checked here.
 */

test('every seeded exercise id is path-safe and unique', () => {
  const seen = new Set<string>()
  for (const exercise of SEED_EXERCISES) {
    assert.ok(
      isPathSafeKey(exercise.id),
      `seed id ${exercise.id} would be rejected by the storage layer — ASCII only`,
    )
    assert.ok(!seen.has(exercise.id), `duplicate seed id ${exercise.id}`)
    seen.add(exercise.id)
  }
  assert.equal(SEED_EXERCISES.length, 44)
  assert.equal(seen.size, 44)
})

test('seed ids are stable across runs, so re-seeding never duplicates', () => {
  const first = SEED_EXERCISES.map((exercise) => exercise.id)
  const second = SEED_EXERCISES.map((exercise) => `x_${exercise.part}_${stableHash(exercise.name)}`)
  assert.deepEqual(first, second, 'id derivation must be pure, or every load adds 44 more rows')
})

test('seed names stay Chinese — only the key had to change', () => {
  const bench = SEED_EXERCISES.find((exercise) => exercise.name === '杠铃卧推')
  assert.ok(bench !== undefined)
  assert.equal(bench.name, '杠铃卧推')
  assert.ok(isPathSafeKey(bench.id))
})

test('generated ids are path-safe', () => {
  for (const prefix of ['b', 'c', 'x', 'r', 'l', 'k']) {
    assert.ok(isPathSafeKey(newId(prefix)), `newId('${prefix}') produced an unsafe key`)
  }
})

test('isPathSafeKey rejects what the storage layer rejects', () => {
  assert.equal(isPathSafeKey('2026-09-17'), true)
  assert.equal(isPathSafeKey('b_0cd28671-3da7-470e-98f8-af6cc09a3299'), true)
  assert.equal(isPathSafeKey(''), false, 'an empty key is not a file name')
  assert.equal(isPathSafeKey('x_chest_杠铃卧推'), false)
  assert.equal(isPathSafeKey('carry:abc:2026-09-17'), false, 'colons are separators in a path')
  assert.equal(isPathSafeKey('a/b'), false)
  assert.equal(isPathSafeKey('a b'), false)
  assert.equal(isPathSafeKey('a.json'), false, 'the extension is added by the store')
})

test('default periods are a monotonic 17-period day', () => {
  assert.equal(DEFAULT_PERIODS.length, 17)
  for (let index = 1; index < DEFAULT_PERIODS.length; index += 1) {
    const previous = DEFAULT_PERIODS[index - 1]
    const current = DEFAULT_PERIODS[index]
    assert.ok(previous !== undefined && current !== undefined)
    assert.ok(
      current.startMinute >= previous.endMinute,
      `period ${String(current.index)} starts before period ${String(previous.index)} ends`,
    )
  }
})
