import assert from 'node:assert/strict'
import test from 'node:test'
import { allocateAdaptive, personalSignals } from '../src/adaptive.ts'
import { BacklogItemSchema, DayPlanSchema, PlanBlockSchema, SettingsSchema, DateSchema } from '../src/domain.ts'

const periods = Array.from({ length: 8 }, (_, i) => ({ index: i + 1, startMinute: 480 + i * 30, endMinute: 510 + i * 30, label: '' }))
const settings = SettingsSchema.parse({ planning: { dailyFocusMinutes: 180, bufferRatio: 0.25, maxDailyTasks: 3 } }).planning
const day = (date: string, blocks: any[] = []) => DayPlanSchema.parse({ date, weekKey: '2026-W40', blocks, updatedAt: '' })
const block = (id: string, start: number, end: number, options: object = {}) => PlanBlockSchema.parse({ id, title: id, category: 'study',
  weekday: 4, startPeriod: start, endPeriod: end, startMinute: 480 + (start - 1) * 30, endMinute: 480 + end * 30, source: 'manual', ...options })
const task = (id: string, options: object = {}) => BacklogItemSchema.parse({ id, title: id, category: 'study', estimatePeriods: 2, createdAt: '', ...options })
const allocate = (days: ReturnType<typeof day>[], tasks: ReturnType<typeof task>[], options: object = {}) => allocateAdaptive({
  days, tasks, periods, settings, fromDate: '2026-10-01', today: '2026-10-01', currentMinute: 0, dayEndPeriod: 8, ...options })

test('a packed tomorrow rolls into the next day without shortening or displacing fixed blocks', () => {
  const full = block('class', 1, 8, { locked: true, source: 'course' })
  const result = allocate([day('2026-10-01', [full]), day('2026-10-02')], [task('a', { estimatePeriods: 3 })])
  assert.equal(result.scheduled[0]?.date, '2026-10-02')
  assert.equal(result.days[1]?.blocks[0]?.endPeriod! - result.days[1]?.blocks[0]?.startPeriod! + 1, 3)
  assert.deepEqual(result.days[0]?.blocks, [full])
})

test('overflow remains explicit and does not masquerade as completed work', () => {
  const result = allocate([day('2026-10-01', [block('full', 1, 8)])], [task('a')])
  assert.equal(result.waiting[0]?.taskId, 'a'); assert.equal(result.scheduled.length, 0)
})

test('buffer and the daily top-three cap prevent filling every slot', () => {
  const result = allocate([day('2026-10-01')], ['a', 'b', 'c', 'd'].map((id) => task(id)))
  assert.equal(result.scheduled.length, 3); assert.equal(result.waiting.length, 1)
  assert.equal(result.capacity[0]?.plannedMinutes, 180); assert.equal(result.capacity[0]?.bufferMinutes, 60)
})

test('past periods and a currently running adaptive block stay protected', () => {
  const running = block('running', 2, 3, { adaptive: true, backlogId: 'running' })
  const result = allocate([day('2026-10-01', [running])], [task('a'), task('running')], { currentMinute: 520 })
  assert(result.days[0]?.blocks.some((entry) => entry.id === running.id))
  assert(result.days[0]?.blocks.filter((entry) => entry.id !== running.id).every((entry) => entry.startMinute >= 520))
})

test('replanning is deterministic and never duplicates an adaptive task', () => {
  const first = allocate([day('2026-10-01')], [task('a')])
  const next = allocate(first.days, [task('a')])
  assert.deepEqual(next.days, first.days)
})

test('drag-pinned and completed tasks survive reallocations', () => {
  const pinned = block('pinned', 1, 2, { backlogId: 'a', adaptive: false })
  const done = block('done', 3, 4, { done: true, adaptive: true, backlogId: 'b' })
  const result = allocate([day('2026-10-01', [pinned, done])], [task('a'), task('b')])
  assert.deepEqual(result.days[0]?.blocks, [pinned, done]); assert.equal(result.scheduled.length, 0)
})

test('a deadline that cannot fit is surfaced rather than silently scheduled late', () => {
  const result = allocate([day('2026-10-01', [block('full', 1, 8)]), day('2026-10-02')], [task('due', { dueDate: '2026-10-01' })])
  assert.equal(result.scheduled.length, 0); assert.match(result.waiting[0]?.reason ?? '', /截止/)
})

test('due dates take priority over a later high-priority task', () => {
  const result = allocate([day('2026-10-01')], [task('later', { priority: 3 }), task('due', { priority: 0, dueDate: '2026-10-01' })])
  assert.equal(result.scheduled[0]?.taskId, 'due')
})

test('a not-before date and a dated gym session are respected', () => {
  const result = allocate([day('2026-10-01'), day('2026-10-02')], [task('a', { notBefore: '2026-10-02' }), task('gym', { category: 'gym', gymDate: '2026-10-02' })])
  assert(result.scheduled.every((entry) => entry.date === '2026-10-02'))
})

test('gym rest days and completed training exclude additional automatic sessions', () => {
  const result = allocate([day('2026-10-01'), day('2026-10-02'), day('2026-10-03')], [task('gym', { category: 'gym' })],
    { gymRestDays: [4], completedGymDates: ['2026-10-02'] })
  assert.equal(result.scheduled[0]?.date, '2026-10-03')
})

test('low energy reduces capacity without changing the saved settings', () => {
  const result = allocate([day('2026-10-01')], ['a', 'b', 'c'].map((id) => task(id)), { energy: 1 })
  assert.equal(result.scheduled.length, 1); assert.equal(settings.dailyFocusMinutes, 180)
})

test('feedback needs three observed days and counts only explicitly missed deferred tasks', () => {
  const plans = ['2026-09-28', '2026-09-29', '2026-09-30'].map((date) => day(date, [block('a', 1, 2, { disposition: 'deferred', executionStatus: 'missed' })]))
  assert.equal(personalSignals(plans.slice(0, 2), [], '2026-10-01').loadFactor, 1)
  assert.equal(personalSignals(plans, [], '2026-10-01').loadFactor, 0.5)
})

test('date validation rejects calendar-overflow and malformed dates', () => {
  assert.equal(DateSchema.safeParse('2026-02-30').success, false)
  assert.equal(DateSchema.safeParse('tomorrow').success, false)
  assert.equal(DateSchema.parse('2028-02-29'), '2028-02-29')
})

test('an explicit afternoon window never becomes a morning slot', () => {
  const result = allocate([day('2026-10-01')], [task('a', { earliestPeriod: 5, latestPeriod: 8, preferredPeriod: 6 })])
  assert.equal(result.days[0]!.blocks[0]!.startPeriod, 6)
})

test('linked learning sessions spread across days rather than stacking on one day', () => {
  const result = allocate([day('2026-10-01'), day('2026-10-02')], [task('a', { learningRef: 'book' }), task('b', { learningRef: 'book' })])
  assert.equal(result.scheduled[0]!.date, '2026-10-01'); assert.equal(result.scheduled[1]!.date, '2026-10-02')
})
