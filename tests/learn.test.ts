import assert from 'node:assert/strict'
import test from 'node:test'
import {
  activeStreak,
  nextValue,
  eachDay,
  gainOver,
  previousDay,
  statusRank,
  valueAt,
  weekGains,
  type Accumulator,
} from '../src/learn.ts'

function acc(id: string, entries: Record<string, number>): Accumulator {
  return {
    id,
    title: id,
    log: Object.entries(entries)
      .map(([date, value]) => ({ date, value }))
      .sort((left, right) => left.date.localeCompare(right.date)),
  }
}

test('valueAt carries the last known value across days you skipped', () => {
  const log = [
    { date: '2026-09-01', value: 50 },
    { date: '2026-09-05', value: 120 },
  ]
  assert.equal(valueAt(log, '2026-08-31'), 0)
  assert.equal(valueAt(log, '2026-09-02'), 50, 'the 1st is still the newest known point')
  assert.equal(valueAt(log, '2026-09-05'), 120)
  assert.equal(valueAt(log, '2026-09-30'), 120, 'nothing after the last entry means nothing further happened')
})

test('previousDay crosses month boundaries', () => {
  assert.equal(previousDay('2026-03-01'), '2026-02-28')
  assert.equal(previousDay('2026-01-01'), '2025-12-31')
  assert.equal(previousDay('2024-03-01'), '2024-02-29', 'leap year')
})

test('eachDay is inclusive on both ends', () => {
  assert.deepEqual(eachDay('2026-09-14', '2026-09-16'), ['2026-09-14', '2026-09-15', '2026-09-16'])
})

test('gainOver measures the range against whatever held the day before', () => {
  const book = acc('book', { '2026-09-13': 20, '2026-09-15': 90 })
  assert.equal(gainOver(book.log, '2026-09-14', '2026-09-20'), 70, 'week opened at 20, closed at 90')
  assert.equal(gainOver(book.log, '2026-09-16', '2026-09-20'), 0, 'no session after the 15th')
  // A brand new book has no anchor older than its first entry, so the first
  // week's total is simply however far you got — there is nothing to subtract.
  const fresh = acc('fresh', { '2026-09-15': 60 })
  assert.equal(gainOver(fresh.log, '2026-09-14', '2026-09-20'), 60)
})

test('weekGains spreads a single reading session onto the day it happened', () => {
  const book = acc('book', { '2026-09-12': 0, '2026-09-15': 42 })
  const result = weekGains([book], [], '2026-09-14', '2026-09-20')
  assert.equal(result.readingPages, 42)
  const wednesday = result.daily.find((point) => point.date === '2026-09-15')
  assert.equal(wednesday?.reading, 42)
  const monday = result.daily.find((point) => point.date === '2026-09-14')
  assert.equal(monday?.reading, 0, 'Monday had no session')
})

test('weekGains totals two items and counts side by side', () => {
  const reading = [acc('a', { '2026-09-15': 20 }), acc('b', { '2026-09-16': 15 })]
  const learning = [acc('leetcode', { '2026-09-15': 3, '2026-09-16': 8 })]
  const result = weekGains(reading, learning, '2026-09-14', '2026-09-20')
  assert.equal(result.readingPages, 35)
  assert.equal(result.learningUnits, 8, '8 by week end, not 3+8')
  assert.equal(result.learning[0]?.gain, 8)
})

test('a backwards edit does not inflate the weekly total', () => {
  // Read to page 80, then corrected down to 60 the same day. One entry survives.
  const book = acc('book', { '2026-09-15': 60 })
  const result = weekGains([book], [], '2026-09-14', '2026-09-20')
  assert.equal(result.readingPages, 60)
})

test('activeStreak counts consecutive days with any movement', () => {
  const learning = [acc('problems', { '2026-09-15': 1, '2026-09-16': 5, '2026-09-17': 9 })]
  assert.equal(activeStreak([], learning, '2026-09-17'), 3)
  assert.equal(activeStreak([], learning, '2026-09-18'), 3, 'not having read yet today is not a break')
  assert.equal(activeStreak([], learning, '2026-09-20'), 0, 'a missed day resets it')
})

test('statusRank sorts unfinished to the top', () => {
  assert.equal(statusRank('reading'), 0)
  assert.equal(statusRank('paused'), 1)
  assert.equal(statusRank('done'), 2)
  assert.equal(statusRank(undefined), 0, 'unknown values must not throw or sort last')
})

/* ── progress updates coming out of a daily review ────────────────────────── */

test('a delta is added to where the counter stood before that day', () => {
  const log = [{ date: '2026-09-14', value: 20 }]
  // 20 pages in hand, "read another 30 today" -> 50.
  assert.equal(nextValue(log, '2026-09-15', 'delta', 30), 50)
})

test('re-applying the same delta does not double-count', () => {
  // The point of measuring against "before this day": confirming the review
  // twice is a normal thing to do after an edit, and it must be idempotent.
  const once = [{ date: '2026-09-14', value: 20 }, { date: '2026-09-15', value: 50 }]
  assert.equal(nextValue(once, '2026-09-15', 'delta', 30), 50, 'not 80')
})

test('an absolute reading overwrites rather than stacking', () => {
  const log = [{ date: '2026-09-14', value: 20 }]
  assert.equal(nextValue(log, '2026-09-15', 'total', 120), 120)
})

test('a delta on a brand-new item starts from zero', () => {
  assert.equal(nextValue([], '2026-09-15', 'delta', 5), 5)
})

test('consecutive days accumulate', () => {
  const day1 = nextValue([], '2026-09-15', 'delta', 30)
  const log = [{ date: '2026-09-15', value: day1 }]
  const day2 = nextValue(log, '2026-09-16', 'delta', 20)
  assert.equal(day2, 50)
})

test('a skipped day does not invent progress', () => {
  const log = [{ date: '2026-09-15', value: 30 }]
  // Nothing was logged on the 16th; picking up on the 17th adds to the 15th.
  assert.equal(nextValue(log, '2026-09-17', 'delta', 10), 40)
})

test('negative and fractional inputs are clamped to sane integers', () => {
  assert.equal(nextValue([], '2026-09-15', 'delta', -5), 0)
  assert.equal(nextValue([], '2026-09-15', 'total', -1), 0)
  assert.equal(nextValue([], '2026-09-15', 'delta', 12.6), 13)
})
