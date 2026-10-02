import assert from 'node:assert/strict'
import test from 'node:test'
import { parseRoutinesDraft } from '../src/parser.ts'
import { END, START, buildRoutinesPrompt } from '../src/prompt.ts'

function wrap(json: string): string {
  return `好的，我整理好了：\n${START}\n${json}\n${END}`
}

test('parses the documented envelope', () => {
  const drafts = parseRoutinesDraft(
    wrap('{"routines":[{"title":"早饭","category":"activity","weekdays":[],"startPeriod":1,"endPeriod":1}]}'),
  )
  assert.equal(drafts.length, 1)
  assert.equal(drafts[0]?.title, '早饭')
  assert.deepEqual(drafts[0]?.weekdays, [])
})

test('accepts a bare array — models drift between the two shapes', () => {
  const drafts = parseRoutinesDraft(
    wrap('[{"title":"午饭","category":"activity","weekdays":[],"startPeriod":7,"endPeriod":7}]'),
  )
  assert.equal(drafts.length, 1)
  assert.equal(drafts[0]?.title, '午饭')
})

test('survives markdown fences and trailing commas', () => {
  const drafts = parseRoutinesDraft(`${START}
\`\`\`json
{"routines":[{"title":"通勤","category":"activity","weekdays":[1,2,3,4,5],"startPeriod":2,"endPeriod":2},]}
\`\`\`
${END}`)
  assert.equal(drafts.length, 1)
  assert.equal(drafts[0]?.title, '通勤')
  assert.deepEqual(drafts[0]?.weekdays, [1, 2, 3, 4, 5])
})

test('normalises a category it has never seen instead of throwing', () => {
  const drafts = parseRoutinesDraft(
    wrap('{"routines":[{"title":"例会","category":"MEETING","weekdays":[],"startPeriod":13,"endPeriod":14}]}'),
  )
  assert.equal(drafts[0]?.category, 'activity')
})

test('drops entries it cannot trust rather than coercing them', () => {
  const drafts = parseRoutinesDraft(
    wrap(
      '{"routines":[' +
        '{"title":"","category":"activity","weekdays":[],"startPeriod":1,"endPeriod":1},' +
        '{"title":"倒过来","category":"activity","weekdays":[],"startPeriod":9,"endPeriod":4},' +
        '{"title":"好的一条","category":"activity","weekdays":[],"startPeriod":6,"endPeriod":6}' +
        ']}',
    ),
  )
  assert.equal(drafts.length, 1, 'a routine on the wrong row is worse than a missing one')
  assert.equal(drafts[0]?.title, '好的一条')
})

test('dedupes and sorts weekdays, discarding out-of-range values', () => {
  const drafts = parseRoutinesDraft(
    wrap('{"routines":[{"title":"训练","category":"gym","weekdays":[4,2,2,0,9],"startPeriod":10,"endPeriod":12}]}'),
  )
  assert.deepEqual(drafts[0]?.weekdays, [2, 4])
  assert.equal(drafts[0]?.category, 'gym')
})

test('an empty list is valid — the user may describe nothing routine', () => {
  assert.deepEqual(parseRoutinesDraft(wrap('{"routines":[]}')), [])
})

test('garbage throws so the caller retries once instead of saving nonsense', () => {
  assert.throws(() => parseRoutinesDraft(`${START}\n不是 JSON\n${END}`))
  assert.throws(() => parseRoutinesDraft(wrap('{"routines":"吃饭"}')))
})

test('the prompt carries the period table, so times map to real rows', () => {
  const prompt = buildRoutinesPrompt({
    description: '我一般七点吃早饭，十二点午饭',
    periods: [
      { index: 1, label: '07:00-08:00' },
      { index: 6, label: '11:50-12:35' },
    ],
    existing: [],
    termStart: '2026-09-07',
  })
  assert.ok(prompt.includes('第1节 07:00-08:00'))
  assert.ok(prompt.includes('第6节 11:50-12:35'))
  assert.ok(prompt.includes('我一般七点吃早饭，十二点午饭'))
  assert.ok(prompt.includes(START) && prompt.includes(END))
  assert.ok(prompt.includes('不要补充我没说的事'), 'the no-invention rule must be explicit')
})

test('the prompt lists what is already configured, to avoid duplicates', () => {
  const prompt = buildRoutinesPrompt({
    description: '再加一个晚饭',
    periods: [{ index: 13, label: '19:20-20:05' }],
    existing: [
      {
        schemaVersion: 1,
        id: 'rt_1',
        title: '早饭',
        category: 'activity',
        weekdays: [],
        startPeriod: 1,
        endPeriod: 1,
        colorKey: '',
        enabled: true,
      },
    ],
    termStart: '2026-09-07',
  })
  assert.ok(prompt.includes('早饭'))
  assert.ok(prompt.includes('不要重复生成这些'))
})
