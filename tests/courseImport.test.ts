import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCourseLine, parseCourseText } from '../src/courseImport.ts'

test('parses the full portal format', () => {
  const row = parseCourseLine('周一 1-2 高等数学 教三-201 1-16周')
  assert.ok(typeof row !== 'string')
  assert.equal(row.name, '高等数学')
  assert.equal(row.weekday, 1)
  assert.equal(row.startPeriod, 1)
  assert.equal(row.endPeriod, 2)
  assert.equal(row.location, '教三-201')
  assert.equal(row.weeks.length, 16)
  assert.equal(row.weeks[0], 1)
  assert.equal(row.weeks.at(-1), 16)
})

test('parses the minimal format without weeks or location', () => {
  const row = parseCourseLine('一 1-2 高数')
  assert.ok(typeof row !== 'string')
  assert.equal(row.name, '高数')
  assert.equal(row.weekday, 1)
  assert.equal(row.startPeriod, 1)
  assert.equal(row.endPeriod, 2)
  assert.deepEqual(row.weeks, [])
  assert.equal(row.location, '')
})

test('parses name-first ordering', () => {
  const row = parseCourseLine('高等数学 周一 1-2节 教三201')
  assert.ok(typeof row !== 'string')
  assert.equal(row.name, '高等数学')
  assert.equal(row.weekday, 1)
  assert.equal(row.startPeriod, 1)
  assert.equal(row.endPeriod, 2)
})

test('parses 星期 and 第N节 spellings', () => {
  const row = parseCourseLine('星期三 第5-6节 线性代数 教三-105')
  assert.ok(typeof row !== 'string')
  assert.equal(row.name, '线性代数')
  assert.equal(row.weekday, 3)
  assert.equal(row.startPeriod, 5)
  assert.equal(row.endPeriod, 6)
})

test('parses a comma separated period list', () => {
  const row = parseCourseLine('周二 3,4 英语 外语楼')
  assert.ok(typeof row !== 'string')
  assert.equal(row.weekday, 2)
  assert.equal(row.startPeriod, 3)
  assert.equal(row.endPeriod, 4)
})

test('parses a single period', () => {
  const row = parseCourseLine('周四 第9节 体育')
  assert.ok(typeof row !== 'string')
  assert.equal(row.startPeriod, 9)
  assert.equal(row.endPeriod, 9)
})

test('expands odd weeks for 单周', () => {
  const row = parseCourseLine('周一 1-2 高等数学 教三-201 1-8周(单)')
  assert.ok(typeof row !== 'string')
  assert.deepEqual(row.weeks, [1, 3, 5, 7])
})

test('expands even weeks for 双周', () => {
  const row = parseCourseLine('周一 1-2 高等数学 教三-201 2-8周（双周）')
  assert.ok(typeof row !== 'string')
  assert.deepEqual(row.weeks, [2, 4, 6, 8])
})

test('parses an explicit week list', () => {
  const row = parseCourseLine('周五 3-4 形势与政策 1,3,5,7周')
  assert.ok(typeof row !== 'string')
  assert.deepEqual(row.weeks, [1, 3, 5, 7])
})

test('week range is not mistaken for a period range', () => {
  const row = parseCourseLine('周一 1-2 高等数学 1-16周')
  assert.ok(typeof row !== 'string')
  assert.equal(row.startPeriod, 1)
  assert.equal(row.endPeriod, 2)
  assert.equal(row.weeks.length, 16)
})

test('parses English weekday names', () => {
  const row = parseCourseLine('Wed 3-4 Calculus Room301')
  assert.ok(typeof row !== 'string')
  assert.equal(row.weekday, 3)
  assert.equal(row.startPeriod, 3)
  assert.equal(row.endPeriod, 4)
  assert.equal(row.name, 'Calculus')
})

test('detects fixed activities by keyword', () => {
  const row = parseCourseLine('周三 9-10 社团例会 活动中心')
  assert.ok(typeof row !== 'string')
  assert.equal(row.kind, 'fixed')
})

test('reports a missing weekday instead of guessing', () => {
  assert.equal(parseCourseLine('1-2 高等数学 教三-201'), '没找到星期（周一到周日）')
})

test('reports a missing period range', () => {
  assert.equal(parseCourseLine('周一 高等数学 教三-201'), '没找到节次（如 1-2 或 第3节）')
})

test('reports a missing name', () => {
  assert.equal(parseCourseLine('周一 1-2'), '没找到课程名')
})

test('parseCourseText keeps good rows and reports bad ones', () => {
  const result = parseCourseText(
    [
      '# 我的课表',
      '',
      '周一 1-2 高等数学 教三-201 1-16周',
      '周一 3-4 线性代数 教三-105 1-16周',
      '这行是垃圾',
      '周三 9-10 社团例会 活动中心',
    ].join('\n'),
  )
  assert.equal(result.rows.length, 3)
  assert.equal(result.failed.length, 1)
  assert.equal(result.failed[0]?.line, '这行是垃圾')
})

test('parses tab separated portal paste', () => {
  const result = parseCourseText('周一\t1-2\t高等数学\t教三-201\t1-16周')
  assert.equal(result.rows.length, 1)
  assert.equal(result.rows[0]?.name, '高等数学')
  assert.equal(result.rows[0]?.location, '教三-201')
})

test('parses a real semester timetable end to end', () => {
  const text = [
    '周一 9-11 高级微观经济学（上） 主教319',
    '周一 12-13 环保电影与环保 学院南路校区',
    '周二 3-5 马克思主义基本原理 主教206',
    '周二 9-10 大学体育（3） 体育场',
    '周三 7-8 形势与政策 学术会堂',
    '周四 3-5 投资学（全英语） 主教218案例教室',
    '周四 7-8 英汉应用笔译 学院南路校区',
    '周四 9-11 概率论与数理统计（全英语） 主教308',
    '周四 12-13 中日文化比较 学院南路校区',
    '周五 3-5 博弈论 主教212',
  ].join('\n')

  const result = parseCourseText(text)
  assert.equal(result.failed.length, 0, JSON.stringify(result.failed))
  assert.equal(result.rows.length, 10)

  const byName = new Map(result.rows.map((row) => [row.name, row]))
  assert.deepEqual(
    { weekday: byName.get('高级微观经济学（上）')?.weekday, s: byName.get('高级微观经济学（上）')?.startPeriod, e: byName.get('高级微观经济学（上）')?.endPeriod, loc: byName.get('高级微观经济学（上）')?.location },
    { weekday: 1, s: 9, e: 11, loc: '主教319' },
  )
  assert.deepEqual(
    { weekday: byName.get('马克思主义基本原理')?.weekday, s: byName.get('马克思主义基本原理')?.startPeriod, e: byName.get('马克思主义基本原理')?.endPeriod },
    { weekday: 2, s: 3, e: 5 },
  )
  assert.deepEqual(
    { weekday: byName.get('概率论与数理统计（全英语）')?.weekday, s: byName.get('概率论与数理统计（全英语）')?.startPeriod, e: byName.get('概率论与数理统计（全英语）')?.endPeriod, loc: byName.get('概率论与数理统计（全英语）')?.location },
    { weekday: 4, s: 9, e: 11, loc: '主教308' },
  )
  assert.deepEqual(
    { weekday: byName.get('大学体育（3）')?.weekday, s: byName.get('大学体育（3）')?.startPeriod, e: byName.get('大学体育（3）')?.endPeriod, loc: byName.get('大学体育（3）')?.location },
    { weekday: 2, s: 9, e: 10, loc: '体育场' },
  )
  assert.deepEqual(
    { weekday: byName.get('博弈论')?.weekday, s: byName.get('博弈论')?.startPeriod, e: byName.get('博弈论')?.endPeriod },
    { weekday: 5, s: 3, e: 5 },
  )
  // Week ranges are omitted, so these run every week.
  for (const row of result.rows) assert.deepEqual(row.weeks, [])
  // None of these names hit the fixed-activity keywords.
  for (const row of result.rows) assert.equal(row.kind, 'course')
})
