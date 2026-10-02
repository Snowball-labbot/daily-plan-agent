import assert from 'node:assert/strict'
import test from 'node:test'
import { WorkflowRunSchema } from '../src/domain.ts'
import { workflowSourceMatches, workflowSubmission, workflowText, type WorkflowSource } from '../src/client/ui/workflowSource.ts'
import { fixture } from './helpers/host.ts'

const source: WorkflowSource = { text: '明天早上做投资学作业', mode: 'plan', today: '2026-10-02', rangeStart: '2026-10-01', rangeEnd: '2026-10-02', planStart: '2026-10-03', planEnd: '2026-10-03' }
const run = WorkflowRunSchema.parse({ id: 'preview', date: source.today, weekKey: '2026-W40', mode: source.mode, rawText: source.text,
  status: 'ready', rangeStart: source.rangeStart, rangeEnd: source.rangeEnd, planStart: source.planStart, planEnd: source.planEnd,
  createdAt: '2026-10-02T13:00:00Z', updatedAt: '2026-10-02T13:00:00Z' })

test('changed prose generates a new plan instead of applying an old ready preview', () => {
  assert.equal(workflowSubmission(run, source, false), 'apply')
  assert.equal(workflowSubmission(run, { ...source, text: '明天先做投资学作业，然后高微练习一小时' }, false), 'generate')
  assert.equal(workflowSubmission(run, { ...source, text: '' }, true), 'generate')
})

test('changing tomorrow to next week invalidates the preview even when prose is unchanged', () => {
  assert.equal(workflowSubmission(run, { ...source, planStart: '2026-10-05', planEnd: '2026-10-11' }, false), 'generate')
  assert.equal(workflowSubmission(run, { ...source, planEnd: '2026-10-04' }, true), 'generate')
  assert.equal(workflowSourceMatches(run, { ...source, rangeStart: '2026-09-30' }), true)
})

test('a preview for the previous day cannot be applied as the next interpretation of tomorrow', () => {
  assert.equal(workflowSubmission(run, { ...source, today: '2026-10-03' }, false), 'generate')
})

test('review mode, scope and its reporting dates belong to the suggestion source', () => {
  const review = { ...run, mode: 'review' as const, rawText: workflowText('今天卧推40kg三组', 'training') }
  const input = { ...source, mode: 'review' as const, text: review.rawText }
  assert.equal(workflowSourceMatches(review, input), true)
  assert.equal(workflowSourceMatches(review, { ...input, text: workflowText('今天卧推40kg三组', 'learning') }), false)
  assert.equal(workflowSourceMatches(review, { ...input, rangeStart: '2026-09-26' }), false)
  assert.equal(workflowSourceMatches(review, { ...input, rangeEnd: '2026-10-01' }), false)
  assert.equal(workflowSourceMatches(run, input), false)
})

test('manual row edits still apply or save without an unnecessary AI call', () => {
  assert.equal(workflowSubmission(run, source, true), 'apply')
  const applied = { ...run, status: 'applied' as const }
  assert.equal(workflowSubmission(applied, source, true), 'save')
  assert.equal(workflowSubmission(applied, source, false), 'generate')
  assert.equal(workflowSubmission(applied, { ...source, text: '' }, true), 'save')
  assert.equal(workflowSubmission(applied, { ...source, text: '换成明天晚上做作业' }, true), 'generate')
})

test('missing or failed suggestions generate, and unrelated whitespace does not invalidate a preview', () => {
  assert.equal(workflowSubmission(null, source, true), 'generate')
  assert.equal(workflowSubmission({ ...run, status: 'failed' }, source, true), 'generate')
  assert.equal(workflowSubmission(run, { ...source, text: `\n${source.text} ` }, false), 'apply')
})

test('an audited manual time edit stays linked to its original input after applying and reopening', async () => {
  const { service, ctx } = await fixture()
  const text = '明天09:30–10:30聚餐'
  ctx.reply = JSON.stringify({ summary: '聚餐', appointments: [{ date: '2026-10-02', title: '聚餐', category: 'activity', startMinute: 570, endMinute: 630, evidence: text }] })
  const { run: preview } = await service.workflowRun({ text, mode: 'plan', planStart: '2026-10-02', planEnd: '2026-10-02' })
  const input = { ...source, text, today: preview.date, planStart: preview.planStart!, planEnd: preview.planEnd! }
  const edited = await service.workflowEditDraft(preview.id, { appointments: [{ index: 0, title: '聚餐', date: '2026-10-02', startMinute: 580, endMinute: 640 }] })
  assert.notEqual(edited.rawText, text)
  assert.equal(edited.inputText, text)
  assert.equal(workflowSubmission(edited, input, false), 'apply')
  const { run: saved } = await service.workflowApply(edited.id)
  assert.equal(workflowSourceMatches(saved, input), true)
  assert.equal(workflowSubmission(saved, input, true), 'save')
  // Existing records have the audit suffix but no inputText field.
  assert.equal(workflowSourceMatches({ ...saved, inputText: undefined }, input), true)
  assert.equal(workflowSourceMatches(saved, { ...input, text: '明天改成晚上聚餐' }), false)
})
