import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addDays,
  dateRange,
  formatHm,
  isoDate,
  isoWeekKey,
  mondayOfWeekKey,
  parseHm,
  parseIsoDate,
  periodAtMinute,
  periodRange,
  shiftWeekKey,
  weekdayOf,
  weekDates,
} from '../src/clock.ts'
import { DEFAULT_PERIODS } from '../src/seed.ts'

test('isoDate / parseIsoDate round-trip in local time', () => {
  const date = parseIsoDate('2026-09-17')
  assert.equal(date.getFullYear(), 2026)
  assert.equal(date.getMonth(), 8)
  assert.equal(date.getDate(), 17)
  assert.equal(isoDate(date), '2026-09-17')
})

test('2026-09-17 is a Thursday', () => {
  assert.equal(weekdayOf(new Date(2026, 8, 17)), 4)
})

test('isoWeekKey matches the ISO calendar', () => {
  assert.equal(isoWeekKey(new Date(2026, 8, 17)), '2026-W38')
  assert.equal(isoWeekKey(new Date(2026, 8, 14)), '2026-W38')
  assert.equal(isoWeekKey(new Date(2026, 8, 20)), '2026-W38')
  assert.equal(isoWeekKey(new Date(2026, 8, 21)), '2026-W39')
})

test('week 1 is the week containing Jan 4th', () => {
  assert.equal(isoDate(mondayOfWeekKey('2026-W01')), '2025-12-29')
  assert.equal(isoDate(mondayOfWeekKey('2026-W38')), '2026-09-14')
})

test('weekDates returns Monday..Sunday', () => {
  assert.deepEqual(weekDates('2026-W38'), [
    '2026-09-14',
    '2026-09-15',
    '2026-09-16',
    '2026-09-17',
    '2026-09-18',
    '2026-09-19',
    '2026-09-20',
  ])
})

test('shiftWeekKey crosses month and year boundaries', () => {
  assert.equal(shiftWeekKey('2026-W38', 1), '2026-W39')
  assert.equal(shiftWeekKey('2026-W38', -1), '2026-W37')
  assert.equal(shiftWeekKey('2026-W01', -1), '2025-W52')
})

test('addDays is stable across month ends', () => {
  assert.equal(isoDate(addDays(new Date(2026, 7, 31), 1)), '2026-09-01')
})

test('time helpers', () => {
  assert.equal(formatHm(8 * 60 + 5), '08:05')
  assert.equal(formatHm(0), '00:00')
  assert.equal(parseHm('21:30'), 21 * 60 + 30)
  assert.throws(() => parseHm('24:00'))
})

test('period grid maps periods to minute ranges', () => {
  const first = periodRange(DEFAULT_PERIODS, 1, 2)
  assert.equal(first.startMinute, 7 * 60, 'period 1 is breakfast, 07:00-08:00')
  assert.equal(first.endMinute, 8 * 60 + 45, 'period 2 is the first class slot')

  assert.equal(periodAtMinute(DEFAULT_PERIODS, 8 * 60 + 20), 2)
  assert.equal(periodAtMinute(DEFAULT_PERIODS, 8 * 60 + 50), null, 'the gap between 08:45 and 08:55')
  assert.equal(periodAtMinute(DEFAULT_PERIODS, 13 * 60 + 40), null)
})

test('the default day runs 07:00 to 22:30 with a full-hour first period', () => {
  const first = DEFAULT_PERIODS[0]
  const last = DEFAULT_PERIODS.at(-1)
  assert.equal(first?.startMinute, 7 * 60, 'waking at 7 or a bit after still leaves a slot')
  assert.equal(first?.endMinute, 8 * 60)
  assert.equal(last?.endMinute, 22 * 60 + 30)

  // Evening slots get finer, because that is when self-directed work happens.
  // Periods 13-14 stay 45 minutes so a two-period evening class still runs
  // 19:20-21:00.
  const length = (index: number): number => {
    const slot = DEFAULT_PERIODS.find((item) => item.index === index)
    return slot === undefined ? 0 : slot.endMinute - slot.startMinute
  }
  assert.equal(length(13), 45)
  assert.equal(length(14), 45)
  assert.equal(length(15), 30)
  assert.equal(length(16), 30)
  assert.equal(length(17), 15)
})

test('dateRange is inclusive', () => {
  assert.deepEqual(dateRange('2026-09-14', '2026-09-16'), [
    '2026-09-14',
    '2026-09-15',
    '2026-09-16',
  ])
})
