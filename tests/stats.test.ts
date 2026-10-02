import assert from 'node:assert/strict'
import test from 'node:test'
import { dateRange } from '../src/clock.ts'
import type { DayPlanRecord, PlanBlockRecord } from '../src/domain.ts'
import {
  buildWeekGrid,
  computeDayStat,
  levelOf,
  monthMarkers,
  summarize,
  type DayStat,
} from '../src/stats.ts'

function block(id: string, done: boolean, locked = false): PlanBlockRecord {
  return {
    schemaVersion: 1,
    id,
    title: id,
    category: 'study',
    weekday: 1,
    startPeriod: 1,
    endPeriod: 2,
    startMinute: 0,
    endMinute: 0,
    courseId: null,
    gymDate: null,
    backlogId: null,
    locked,
    source: locked ? 'course' : 'manual',
    colorKey: '',
    done,
    executionStatus: done ? 'completed' : 'missed',
    doneAt: null,
    carriedFrom: null,
    note: '',
  }
}

function plan(date: string, blocks: PlanBlockRecord[]): DayPlanRecord {
  return { schemaVersion: 1, date, weekKey: '2026-W38', focus: '', blocks, updatedAt: date }
}

const OPTIONS = { countCourseBlocks: true, todayIso: '2026-09-17' }

test('levelOf maps the completion bands', () => {
  assert.equal(levelOf(0, 0), -1)
  assert.equal(levelOf(0, 4), 0)
  assert.equal(levelOf(0.25, 4), 1)
  assert.equal(levelOf(0.33, 6), 1)
  assert.equal(levelOf(0.5, 4), 2)
  assert.equal(levelOf(0.8, 5), 3)
  assert.equal(levelOf(0.99, 100), 3)
  assert.equal(levelOf(1, 5), 4)
})

test('a full day is level 4', () => {
  const stat = computeDayStat(
    '2026-09-16',
    plan('2026-09-16', [block('a', true), block('b', true)]),
    undefined,
    undefined,
    OPTIONS,
  )
  assert.equal(stat.level, 4)
  assert.equal(stat.ratio, 1)
  assert.equal(stat.planned, 2)
})

test('a planned day with nothing done is level 0, not "no plan"', () => {
  const stat = computeDayStat(
    '2026-09-16',
    plan('2026-09-16', [block('a', false)]),
    undefined,
    undefined,
    OPTIONS,
  )
  assert.equal(stat.level, 0)
})

test('a day with no blocks is level -1', () => {
  const stat = computeDayStat('2026-09-16', undefined, undefined, undefined, OPTIONS)
  assert.equal(stat.level, -1)
})

test('a future day is always level -1', () => {
  const stat = computeDayStat(
    '2026-09-20',
    plan('2026-09-20', [block('a', true)]),
    undefined,
    undefined,
    OPTIONS,
  )
  assert.equal(stat.level, -1)
})

test('countCourseBlocks toggles whether timetable blocks count', () => {
  const day = plan('2026-09-16', [block('a', true), block('c', false, true)])
  const withCourses = computeDayStat('2026-09-16', day, undefined, undefined, OPTIONS)
  const withoutCourses = computeDayStat('2026-09-16', day, undefined, undefined, {
    ...OPTIONS,
    countCourseBlocks: false,
  })
  assert.equal(withCourses.ratio, 0.5)
  assert.equal(withoutCourses.ratio, 1)
})

function stat(date: string, planned: number, done: number, gymDone = false, hasReview = false): DayStat {
  const ratio = planned === 0 ? 0 : done / planned
  return { date, planned, done, ratio, level: levelOf(ratio, planned), hasReview, gymDone }
}

/** A stat for every date in the range, like `stats.range` returns. */
function denseRange(from: string, to: string): DayStat[] {
  return dateRange(from, to).map((date, index) => stat(date, 1, index % 3 === 0 ? 0 : 1))
}

test('summarize counts totals and streaks', () => {
  const stats = [
    stat('2026-09-10', 4, 4),
    stat('2026-09-11', 4, 4),
    stat('2026-09-12', 4, 2),
    stat('2026-09-13', 0, 0),
    stat('2026-09-14', 5, 5),
    stat('2026-09-15', 5, 5),
    stat('2026-09-16', 5, 5),
    stat('2026-09-17', 6, 3),
  ]
  const summary = summarize(stats, { threshold: 0.8, todayIso: '2026-09-17' })
  assert.equal(summary.totalDone, 28)
  assert.equal(summary.perfectDays, 5)
  // The no-plan day on the 13th is neutral, so it does not break the run.
  assert.equal(summary.currentStreak, 3)
  assert.equal(summary.longestStreak, 3)
})

test('today in progress does not break the streak', () => {
  const stats = [
    stat('2026-09-15', 5, 5),
    stat('2026-09-16', 5, 5),
    stat('2026-09-17', 6, 1),
  ]
  const summary = summarize(stats, { threshold: 0.8, todayIso: '2026-09-17' })
  assert.equal(summary.currentStreak, 2)
})

test('a missed past day breaks the streak', () => {
  const stats = [
    stat('2026-09-14', 5, 5),
    stat('2026-09-15', 5, 5),
    stat('2026-09-16', 5, 1),
    stat('2026-09-17', 5, 5),
  ]
  const summary = summarize(stats, { threshold: 0.8, todayIso: '2026-09-17' })
  assert.equal(summary.currentStreak, 1)
  assert.equal(summary.longestStreak, 2)
})

test('summarize counts gym sessions and reviews', () => {
  const stats = [
    stat('2026-09-15', 4, 4, true, true),
    stat('2026-09-16', 4, 2, false, true),
    stat('2026-09-17', 4, 4, true, false),
  ]
  const summary = summarize(stats, { threshold: 0.8, todayIso: '2026-09-17' })
  assert.equal(summary.gymSessions, 2)
  assert.equal(summary.reviewDays, 2)
  assert.equal(summary.plannedDays, 3)
})

test('month rate only counts the current month', () => {
  const stats = [stat('2026-08-31', 4, 1), stat('2026-09-01', 4, 4), stat('2026-09-02', 4, 2)]
  const summary = summarize(stats, { threshold: 0.8, todayIso: '2026-09-17' })
  assert.equal(summary.monthDone, 6)
  assert.equal(summary.monthPlanned, 8)
  assert.equal(summary.monthRate, 0.75)
})

test('buildWeekGrid is 53 columns of 7 days ending on today', () => {
  const stats = denseRange('2025-10-01', '2026-09-17')
  const grid = buildWeekGrid(stats, 53)
  assert.equal(grid.length, 53)
  assert.equal(grid[0]?.length, 7)
  const lastColumn = grid.at(-1)
  assert.ok(lastColumn?.some((cell) => cell.date === '2026-09-17'))
  // Every column starts on a Monday.
  for (const column of grid) {
    const head = column[0]
    assert.ok(head !== undefined)
    assert.equal(new Date(`${head.date}T00:00:00`).getDay(), 1)
  }
})

test('monthMarkers labels the first column of each month', () => {
  const markers = monthMarkers(buildWeekGrid(denseRange('2025-10-01', '2026-09-17'), 53))
  assert.ok(markers.length > 8)
  assert.equal(markers[0]?.column, 0)
  for (const marker of markers) assert.match(marker.label, /^\d{1,2}月$/u)
  const columns = markers.map((marker) => marker.column)
  assert.deepEqual(columns, [...columns].sort((left, right) => left - right))
})
