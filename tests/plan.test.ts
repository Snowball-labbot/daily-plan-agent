import assert from 'node:assert/strict'
import test from 'node:test'
import type { CourseRecord, PlanBlockRecord, RoutineRecord } from '../src/domain.ts'
import { generatedBlockId } from '../src/identity.ts'
import {
  coursesForDay,
  freeGaps,
  generateDayBlocks,
  moveBlock,
  routinesForDay,
  snapToGap,
} from '../src/plan.ts'
import { DEFAULT_PERIODS } from '../src/seed.ts'

function block(id: string, startPeriod: number, endPeriod: number, locked = false): PlanBlockRecord {
  return {
    schemaVersion: 1,
    id,
    title: id,
    category: 'study',
    weekday: 1,
    startPeriod,
    endPeriod,
    startMinute: 0,
    endMinute: 0,
    courseId: null,
    gymDate: null,
    backlogId: null,
    locked,
    source: locked ? 'course' : 'manual',
    colorKey: '',
    done: false,
    doneAt: null,
    carriedFrom: null,
    note: '',
  }
}

function course(overrides: Partial<CourseRecord> & { startPeriod: number; endPeriod: number }): CourseRecord {
  return {
    schemaVersion: 1,
    id: overrides.id ?? 'c1',
    name: overrides.name ?? '高等数学',
    kind: 'course',
    weekday: overrides.weekday ?? 1,
    weeks: overrides.weeks ?? [],
    location: overrides.location ?? '教三-201',
    teacher: '',
    category: 'study',
    colorKey: '',
    note: '',
    archived: false,
    ...overrides,
  }
}

test('freeGaps returns the runs between blocks', () => {
  const gaps = freeGaps([block('a', 1, 2), block('b', 5, 6)], 8)
  assert.deepEqual(gaps, [
    { startPeriod: 3, endPeriod: 4 },
    { startPeriod: 7, endPeriod: 8 },
  ])
})

test('freeGaps handles a completely empty day', () => {
  assert.deepEqual(freeGaps([], 4), [{ startPeriod: 1, endPeriod: 4 }])
})

test('snapToGap keeps the requested length when it fits', () => {
  assert.deepEqual(snapToGap([block('a', 1, 2)], 5, 3, 10), { startPeriod: 5, endPeriod: 7 })
})

test('snapToGap compresses when the run is too short', () => {
  assert.deepEqual(snapToGap([block('a', 1, 2), block('b', 5, 6)], 3, 4, 8), {
    startPeriod: 3,
    endPeriod: 4,
  })
})

test('snapToGap never crosses a locked block', () => {
  const locked = block('locked', 5, 6, true)
  const target = snapToGap([locked], 4, 3, 10)
  assert.deepEqual(target, { startPeriod: 2, endPeriod: 4 })
  assert.ok(target !== null && target.endPeriod < 5)
})

test('snapToGap returns null when the day is full', () => {
  assert.equal(snapToGap([block('a', 1, 12, true)], 3, 2, 12), null)
})

test('moveBlock pushes colliding blocks down', () => {
  const result = moveBlock([block('a', 1, 2), block('b', 3, 4)], 'a', 3, 4, 10)
  const byId = new Map(result.map((item) => [item.id, item]))
  assert.equal(byId.get('a')?.startPeriod, 3)
  assert.equal(byId.get('b')?.startPeriod, 5)
  assert.equal(byId.get('b')?.endPeriod, 6)
})

test('moveBlock refuses to move a locked block', () => {
  const locked = block('locked', 1, 2, true)
  const result = moveBlock([locked], 'locked', 5, 6, 10)
  assert.equal(result[0]?.startPeriod, 1)
})

test('moveBlock stops pushing at a locked wall', () => {
  const result = moveBlock(
    [block('a', 1, 2), block('wall', 5, 6, true), block('b', 7, 8)],
    'a',
    3,
    4,
    10,
  )
  const byId = new Map(result.map((item) => [item.id, item]))
  assert.equal(byId.get('a')?.startPeriod, 3)
  // 'b' already had room after the wall, so it must not be disturbed.
  assert.equal(byId.get('b')?.startPeriod, 7)
})

test('moveBlock leaves a block in place when there is nowhere to push it', () => {
  const result = moveBlock([block('a', 1, 2), block('b', 3, 4)], 'a', 3, 4, 4)
  const byId = new Map(result.map((item) => [item.id, item]))
  assert.equal(byId.get('b')?.startPeriod, 3)
})

test('generateDayBlocks materialises locked timetable blocks', () => {
  const blocks = generateDayBlocks({
    courses: [course({ startPeriod: 1, endPeriod: 2 })],
    routines: [],
    date: '2026-09-14',
    weekday: 1,
    teachingWeek: 3,
    periods: DEFAULT_PERIODS,
    dayEndPeriod: 12,
  })
  assert.equal(blocks.length, 1)
  const first = blocks[0]
  assert.equal(first?.locked, true)
  assert.equal(first?.source, 'course')
  assert.equal(first?.id, generatedBlockId('c1', '2026-09-14', 1))
  // Periods come from DEFAULT_PERIODS: 1 is breakfast (07:00-08:00) and 2 is the
  // first class slot (08:00-08:45), so a 1-2 block spans 07:00-08:45.
  assert.equal(first?.startMinute, 7 * 60)
  assert.equal(first?.endMinute, 8 * 60 + 45)
})

test('generateDayBlocks is idempotent because ids are derived', () => {
  const input = {
    courses: [course({ startPeriod: 1, endPeriod: 2 })],
    routines: [],
    date: '2026-09-14',
    weekday: 1,
    teachingWeek: 3,
    periods: DEFAULT_PERIODS,
    dayEndPeriod: 12,
  } as const
  const first = generateDayBlocks(input).map((item) => item.id)
  const second = generateDayBlocks(input).map((item) => item.id)
  assert.deepEqual(first, second)
})

test('generateDayBlocks drops a class that is not running this week', () => {
  const blocks = generateDayBlocks({
    courses: [course({ startPeriod: 1, endPeriod: 2, weeks: [1, 2, 3] })],
    routines: [],
    date: '2026-09-14',
    weekday: 1,
    teachingWeek: 10,
    periods: DEFAULT_PERIODS,
    dayEndPeriod: 12,
  })
  assert.equal(blocks.length, 0)
})


test('coursesForDay filters by weekday and running weeks', () => {
  const courses = [
    course({ id: 'a', startPeriod: 1, endPeriod: 2, weekday: 1, weeks: [1, 2] }),
    course({ id: 'b', startPeriod: 3, endPeriod: 4, weekday: 3 }),
  ]
  assert.deepEqual(
    coursesForDay(courses, 1, 2).map((item) => item.id),
    ['a'],
  )
  assert.deepEqual(coursesForDay(courses, 1, 9), [])
  assert.deepEqual(
    coursesForDay(courses, 3, 9).map((item) => item.id),
    ['b'],
  )
})


function routine(over: Partial<RoutineRecord> & { startPeriod: number; endPeriod: number }): RoutineRecord {
  return {
    schemaVersion: 1,
    id: over.id ?? `rt_${String(over.startPeriod)}`,
    title: over.title ?? '吃饭',
    category: over.category ?? 'activity',
    weekdays: over.weekdays ?? [],
    startPeriod: over.startPeriod,
    endPeriod: over.endPeriod,
    colorKey: over.colorKey ?? '',
    enabled: over.enabled ?? true,
  }
}

test('routinesForDay treats an empty weekday list as every day', () => {
  const meals = routine({ startPeriod: 1, endPeriod: 1 })
  const mondayOnly = routine({ id: 'rt_mon', startPeriod: 13, endPeriod: 13, weekdays: [1] })
  const all = routinesForDay([meals, mondayOnly], 1)
  assert.equal(all.length, 2)
  assert.equal(routinesForDay([meals, mondayOnly], 3).length, 1, 'the Monday routine stays on Monday')
})

test('routinesForDay skips disabled routines', () => {
  const off = routine({ startPeriod: 1, endPeriod: 1, enabled: false })
  assert.deepEqual(routinesForDay([off], 1), [])
})

test('generateDayBlocks lays routines down next to the timetable', () => {
  const blocks = generateDayBlocks({
    courses: [course({ startPeriod: 4, endPeriod: 6 })],
    routines: [
      routine({ id: 'rt_lunch', title: '午饭', startPeriod: 7, endPeriod: 7 }),
      routine({ id: 'rt_dinner', title: '晚饭', startPeriod: 13, endPeriod: 13 }),
    ],
    date: '2026-09-14',
    weekday: 1,
    teachingWeek: 3,
    periods: DEFAULT_PERIODS,
    dayEndPeriod: 17,
  })
  const titles = blocks.map((item) => item.title)
  assert.ok(titles.includes('午饭'), 'a routine in a free gap must be placed')
  assert.ok(titles.includes('晚饭'))
  assert.equal(blocks.filter((item) => item.source === 'routine').length, 2)
})

test('a routine that collides with a class is skipped, never relocated', () => {
  const blocks = generateDayBlocks({
    courses: [course({ startPeriod: 4, endPeriod: 6 })],
    routines: [routine({ id: 'rt_lunch', title: '午饭', startPeriod: 5, endPeriod: 5 })],
    date: '2026-09-14',
    weekday: 1,
    teachingWeek: 3,
    periods: DEFAULT_PERIODS,
    dayEndPeriod: 17,
  })
  assert.equal(
    blocks.filter((item) => item.source === 'routine').length,
    0,
    'a meal silently sliding to 15:00 is worse than a visibly missing one',
  )
  assert.equal(blocks.length, 1, 'the class survives untouched')
})

test('routine blocks use a deterministic id, so regenerating never duplicates', () => {
  const input = {
    courses: [],
    routines: [routine({ id: 'rt_lunch', title: '午饭', startPeriod: 7, endPeriod: 7 })],
    date: '2026-09-14',
    weekday: 1,
    teachingWeek: 3,
    periods: DEFAULT_PERIODS,
    dayEndPeriod: 17,
  } as const
  const first = generateDayBlocks(input).map((item) => item.id)
  const second = generateDayBlocks({ ...input, routines: [...input.routines] }).map((item) => item.id)
  assert.deepEqual(first, second)
  assert.match(first[0] ?? '', /^routine:/u)
})

test('generateDayBlocks never places a gym slot on its own', () => {
  // Training is the user's call now — either a routine or the block the gym
  // page creates. A generated "train at 21:00 Tuesday" looks like a commitment
  // the user never made.
  const blocks = generateDayBlocks({
    courses: [],
    routines: [],
    date: '2026-09-17',
    weekday: 4,
    teachingWeek: 2,
    periods: DEFAULT_PERIODS,
    dayEndPeriod: 17,
  })
  assert.equal(blocks.length, 0)
  assert.equal(blocks.filter((item) => item.category === 'gym').length, 0)
})

test('an empty routine list means classes only — the term view', () => {
  const blocks = generateDayBlocks({
    courses: [course({ startPeriod: 4, endPeriod: 6 })],
    routines: [],
    date: '2026-09-14',
    weekday: 1,
    teachingWeek: 3,
    periods: DEFAULT_PERIODS,
    dayEndPeriod: 17,
  })
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0]?.source, 'course')
})

test('moveBlock never erases the timetable', () => {
  // Regression: `packed` only ever collected non-locked blocks, so rebuilding
  // the day from [moved, ...packed] dropped every class. Dragging one block
  // wiped the rest of that day — the single most destructive bug in the grid.
  const blocks = [
    block('course-1', 1, 2, true),
    block('course-2', 5, 6, true),
    block('task', 8, 9),
  ]
  const moved = moveBlock(blocks, 'task', 10, 11, 17)
  assert.equal(moved.length, 3, 'nothing may be lost')
  assert.ok(moved.some((item) => item.id === 'course-1' && item.startPeriod === 1))
  assert.ok(moved.some((item) => item.id === 'course-2' && item.startPeriod === 5))
  assert.ok(moved.some((item) => item.id === 'task' && item.startPeriod === 10))
})

test('moveBlock keeps the timetable even when it pushes a block down', () => {
  const blocks = [
    block('course-1', 1, 2, true),
    block('a', 8, 9),
    block('b', 10, 11),
  ]
  // Dropping 'a' onto 'b' pushes 'b' down; both courses must still be there.
  const moved = moveBlock(blocks, 'a', 10, 11, 17)
  assert.equal(moved.length, 3)
  assert.ok(moved.some((item) => item.id === 'course-1' && item.locked))
  assert.ok(moved.some((item) => item.id === 'b' && item.startPeriod > 11))
})

test('moveBlock keeps the completed state of everything it touches', () => {
  const done: PlanBlockRecord = { ...block('task', 8, 9), done: true, doneAt: '2026-09-18T10:00:00.000Z' }
  const moved = moveBlock([block('course-1', 1, 2, true), done], 'task', 12, 13, 17)
  const after = moved.find((item) => item.id === 'task')
  assert.equal(after?.done, true, 'moving a block must not un-tick it')
  assert.equal(after?.doneAt, '2026-09-18T10:00:00.000Z')
})
