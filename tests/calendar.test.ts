import assert from 'node:assert/strict'
import test from 'node:test'
import { calendarLabel, courseWeekday, holidayLabel } from '../src/calendar.ts'
import { CourseSchema } from '../src/domain.ts'
import { blockFromCourse, generateDayBlocks } from '../src/plan.ts'
import { DEFAULT_PERIODS } from '../src/seed.ts'
import { fixture } from './helpers/host.ts'

test('2026 official rest ranges and workday notices include both National Day make-up days', () => {
  assert.equal(holidayLabel('2026-10-01'), '国庆')
  assert.equal(holidayLabel('2026-10-07'), '国庆')
  assert.equal(holidayLabel('2026-10-08'), null)
  assert.equal(holidayLabel('2026-09-25'), '中秋')
  assert.equal(calendarLabel('2026-09-20'), '调休·校历待定')
  assert.equal(calendarLabel('2026-10-10'), '调休·校历待定')
  assert.equal(calendarLabel('2027-10-01'), '假期未核对')
  assert.equal(courseWeekday('2026-10-10', 6), 6)
})

test('holiday skeleton skips classes but keeps fixed commitments and explicit school overrides', () => {
  const course = CourseSchema.parse({ id: 'course', name: '概率论', weekday: 4, startPeriod: 2, endPeriod: 3 })
  const fixed = CourseSchema.parse({ id: 'fixed', name: '家庭约定', kind: 'fixed', weekday: 4, startPeriod: 5, endPeriod: 6 })
  const input = { courses: [course, fixed], routines: [], date: '2026-10-01', weekday: 4, teachingWeek: 5, periods: DEFAULT_PERIODS, dayEndPeriod: 17 }
  assert.deepEqual(generateDayBlocks(input).map((item) => item.title), ['家庭约定'])
  assert.deepEqual(generateDayBlocks({ ...input, courseCalendar: { respectHolidays: true, overrides: [{ date: input.date, weekday: 4 }] } }).map((item) => item.title), ['概率论', '家庭约定'])
  assert.equal(generateDayBlocks({ ...input, courseCalendar: { respectHolidays: false, overrides: [] } }).length, 2)
  assert.ok(blockFromCourse(course, input.date, 4, DEFAULT_PERIODS).colorKey)
  assert.equal(blockFromCourse({ ...course, colorKey: 'rose' }, input.date, 4, DEFAULT_PERIODS).colorKey, 'rose')
})

test('legacy holiday blocks stop reserving today and future capacity while completed and historical facts survive', async () => {
  const { service, stores } = await fixture()
  const course = await service.upsertCourse({ name: '概率论', weekday: 4, startPeriod: 2, endPeriod: 3 })
  const date = '2026-10-01'
  await service.upsertBlock(date, { title: '手动学习', startPeriod: 6, endPeriod: 6 })
  const legacy = blockFromCourse(course, date, 4, service.periods())
  const original = service.dayPlan(date)
  stores.get('plans')!.set(date, { ...original, blocks: [...original.blocks, legacy] })
  assert.deepEqual(service.snapshot().today.blocks.map((item) => item.title), ['手动学习'])
  assert.ok(!service.workflowContext().recentDays.find((day) => day.date === date)?.blocks.some((item) => item.id === legacy.id))
  await service.replan()
  assert.ok(!service.dayPlan(date).blocks.some((item) => item.source === 'course'))
  stores.get('plans')!.set(date, { ...original, blocks: [legacy, { ...legacy, id: 'confirmed', done: true }] })
  await service.generateWeek('2026-W40')
  assert.deepEqual(service.dayPlan(date).blocks.filter((item) => item.source === 'course').map((item) => item.id), ['confirmed'])
  const past = '2026-09-25'
  const old = blockFromCourse(course, past, 5, service.periods())
  stores.get('plans')!.set(past, { ...service.dayPlan(past), blocks: [old] })
  assert.equal(service.dayPlan(past).blocks.length, 1)
  await service.generateWeek('2026-W39')
  assert.ok(service.dayPlan(past).blocks.some((item) => item.id === old.id))
  await service.updateSettings({ courseCalendar: { overrides: [{ date, weekday: 4 }] } })
  await service.generateWeek('2026-W40')
  assert.ok(service.dayPlan(date).blocks.some((item) => item.id === legacy.id))
})

test('school make-up weekday changes classes without moving fixed commitments or routine weekdays', () => {
  const courses = [CourseSchema.parse({ id: 'c', name: '周一课', weekday: 1, startPeriod: 2, endPeriod: 3 }), CourseSchema.parse({ id: 'f', name: '周六约定', kind: 'fixed', weekday: 6, startPeriod: 5, endPeriod: 5 })]
  const blocks = generateDayBlocks({ courses, routines: [], date: '2026-10-10', weekday: 6, teachingWeek: 6, periods: DEFAULT_PERIODS, dayEndPeriod: 17, courseCalendar: { respectHolidays: true, overrides: [{ date: '2026-10-10', weekday: 1 }] } })
  assert.deepEqual(blocks.map((item) => item.title), ['周一课', '周六约定'])
  assert.ok(blocks.every((item) => item.weekday === 6))
})
