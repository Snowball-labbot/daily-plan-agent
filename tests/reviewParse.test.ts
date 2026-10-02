import assert from 'node:assert/strict'
import test from 'node:test'
import { fallbackStructured, parseStructuredReview } from '../src/parser.ts'
import { END, START } from '../src/prompt.ts'

function review(extra: string): string {
  return `${START}
{"summary":"今天读了不少书","achievements":["读完一章"],"blockers":[],"adjustments":[],
 "plan":[],${extra}"energy":4,"mood":4,"tags":[]}
${END}`
}

/**
 * The review → Learn page link. Everything here is about the model's reply being
 * structurally plausible but semantically wrong, which is the normal failure
 * mode of "read about 100 pages" → a number.
 */

test('a reading delta is parsed', () => {
  const { structured } = parseStructuredReview(
    review('"learning":[{"ref":"r_1","title":"《人类简史》","kind":"reading","mode":"delta","value":100}],'),
    '2026-09-17',
  )
  assert.equal(structured.learning.length, 1)
  assert.equal(structured.learning[0]?.mode, 'delta')
  assert.equal(structured.learning[0]?.value, 100)
  assert.equal(structured.learning[0]?.kind, 'reading')
})

test('mode defaults to delta, never to total', () => {
  // Guessing "total" from a bare number would silently reset a 300-page book to
  // page 30. Adding 30 is the recoverable mistake, so that is the default.
  const { structured } = parseStructuredReview(
    review('"learning":[{"title":"某某书","kind":"reading","value":30}],'),
    '2026-09-17',
  )
  assert.equal(structured.learning[0]?.mode, 'delta')
  assert.equal(structured.learning[0]?.ref, null)
})

test('an unknown kind falls back to reading', () => {
  const { structured } = parseStructuredReview(
    review('"learning":[{"title":"X","kind":"novel","mode":"total","value":12}],'),
    '2026-09-17',
  )
  assert.equal(structured.learning[0]?.kind, 'reading')
})

test('a practice update keeps its kind', () => {
  const { structured } = parseStructuredReview(
    review('"learning":[{"ref":"l_9","title":"LeetCode","kind":"practice","mode":"delta","value":5}],'),
    '2026-09-17',
  )
  assert.equal(structured.learning[0]?.kind, 'practice')
})

test('rows without a title or with a zero value are dropped', () => {
  const { structured } = parseStructuredReview(
    review(
      '"learning":[{"title":"","mode":"delta","value":50},{"title":"没读多少","mode":"delta","value":0},{"title":"有效","mode":"delta","value":3}],',
    ),
    '2026-09-17',
  )
  assert.equal(structured.learning.length, 1)
  assert.equal(structured.learning[0]?.title, '有效')
})

test('a review written before this feature existed still parses', () => {
  // Old records and old replies have no `learning` key at all.
  const { structured } = parseStructuredReview(
    `${START}
{"summary":"旧的一条复盘","achievements":[],"blockers":[],"adjustments":[],"plan":[],"energy":null,"mood":null,"tags":[]}
${END}`,
    '2026-09-17',
  )
  assert.deepEqual(structured.learning, [])
})

test('a nonsense learning value is ignored rather than throwing', () => {
  const { structured } = parseStructuredReview(
    review('"learning":[{"title":"书","mode":"delta","value":"很多"}],"'),
    '2026-09-17',
  )
  assert.deepEqual(structured.learning, [], 'a non-numeric value is not progress')
})

test('the cap is eight updates', () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    title: `书${String(index)}`,
    mode: 'delta',
    value: 1,
  }))
  const { structured } = parseStructuredReview(
    review(`"learning":${JSON.stringify(rows)},`),
    '2026-09-17',
  )
  assert.equal(structured.learning.length, 8)
})

/* ── the hand-written fallback ────────────────────────────────────────────── */

test('a single run-on paragraph is split into sentences', () => {
  // The fallback used to split on newlines only, so a review written as one
  // block became a single enormous "achievement" and a summary that was the
  // first 60 characters of the original — which read as "Agnes did nothing".
  const text = '今天一早起来学概率论。投资学看课本看懂了。明天打算八点预习数分。'
  const result = fallbackStructured(text, '2026-09-17')
  assert.equal(result.summary, '今天一早起来学概率论。')
  assert.ok(result.achievements.length >= 1, 'the rest of the paragraph becomes points')
})

test('the summary is a whole sentence, not a mid-word slice', () => {
  const text = 'A'.repeat(200)
  const result = fallbackStructured(text, '2026-09-17')
  assert.ok(result.summary.length <= 80)
})

test('newline-separated lists are still treated line by line', () => {
  const text = ['今天做了什么', '- 上完高数', '- 写完周报'].join('\n')
  const result = fallbackStructured(text, '2026-09-17')
  assert.ok(result.achievements.some((item) => item.includes('高数')))
  assert.ok(result.achievements.some((item) => item.includes('周报')))
})

test('an unparseable reply still yields the rule-based shape', () => {
  const result = fallbackStructured('随便写点什么', '2026-09-17')
  assert.equal(typeof result.summary, 'string')
  assert.deepEqual(result.plan, [])
  assert.deepEqual(result.learning, [])
})
