import assert from 'node:assert/strict'
import test from 'node:test'
import { hasAppointmentTimeEvidence } from '../src/appointmentEvidence.ts'
import { activeBlock } from '../src/adaptive.ts'
import { fixture } from './helpers/host.ts'

const event = { date: '2026-10-02', title: '聚餐', category: 'activity', lifeArea: 'relationships', startMinute: 570, endMinute: 630, evidence: '明天09:30–10:30聚餐' }

test('DSH failures include transport details and preserve the actual Chinese cause', async () => {
  const { ctx } = await fixture()
  const failed = await ctx.rpc('workflow.apply', { id: 'missing' }, new AbortController().signal)
  assert.equal(failed.ok, false)
  assert.match(failed.error.message, /没有可应用/)
  assert.deepEqual(failed.error.details, { endpoint: 'workflow.apply' })
})

test('clock evidence accepts common written ranges and durations but refuses guessed endings', () => {
  for (const [text, start, end] of [
    ['下午2点到4点学习', 840, 960], ['明天19:10–20:35聚餐', 1150, 1235], ['晚上六点到十点吃饭', 1080, 1320],
    ['上午九点半到十点一刻', 570, 615], ['14–16点学习', 840, 960], ['9点健身一个小时', 540, 600],
  ] as const) assert.equal(hasAppointmentTimeEvidence(text, start, end), true, text)
  assert.equal(hasAppointmentTimeEvidence('下午6点有个饭局，晚上可能drink一下', 1080, 1320), false)
  assert.equal(hasAppointmentTimeEvidence('下午2点到4点学习', 840, 1020), false)
})

test('an estimated end is written as a tentative intention alongside precise plans', async () => {
  const { service, ctx } = await fixture()
  ctx.reply = JSON.stringify({ summary: '假设聚餐到11点', appointments: [
    event, { ...event, title: '另一个活动', startMinute: 660, endMinute: 690, evidence: '明天11点还有一个活动' },
  ] })
  const run = await service.workflowRun({ text: '明天09:30–10:30聚餐，明天11点还有一个活动', mode: 'plan', apply: true })
  assert.equal(run.run.status, 'applied')
  assert.equal(service.dayPlan('2026-10-02').blocks.filter(activeBlock).length, 2)
  assert.equal(run.run.draft!.questions.length, 0)
  assert.equal(service.dayPlan('2026-10-02').blocks.find((block) => block.title === '另一个活动')!.timeBasis, 'estimated')
})

test('latest request removes an old personal position, preserves the goal, and retries without duplicates', async () => {
  const { service, ctx } = await fixture()
  const task = await service.upsertBacklog({ title: '旧阅读' })
  await service.upsertBlock('2026-10-02', { title: '旧阅读', backlogId: task.id, startPeriod: 3, endPeriod: 4 })
  ctx.reply = JSON.stringify({ summary: '新聚餐为准', appointments: [event] })
  const result = await service.workflowRun({ text: event.evidence, mode: 'plan', apply: true, replaceConflicts: true })
  const day = service.dayPlan('2026-10-02')
  assert(day.blocks.some((block) => block.title === '旧阅读' && !activeBlock(block)))
  assert(day.blocks.some((block) => block.title === '聚餐' && activeBlock(block)))
  assert(day.blocks.filter((block) => activeBlock(block) && block.title === '旧阅读').every((block) => block.endMinute <= 570 || block.startMinute >= 630))
  assert(service.workflowContext().tasks.some((entry) => entry.id === task.id && !entry.done))
  assert(result.run.appliedChanges!.some((change) => change.includes('已撤下旧安排')))
  await service.workflowApply(result.run.id, true)
  assert.equal(service.dayPlan('2026-10-02').blocks.filter((block) => block.title === '聚餐').length, 1)
})

test('latest request still cannot override completed facts or fixed routines', async () => {
  const { service, ctx } = await fixture()
  await service.upsertBlock('2026-10-02', { title: '已完成的阅读', startPeriod: 3, endPeriod: 4 })
  const block = service.dayPlan('2026-10-02').blocks[0]!
  await service.toggleBlock('2026-10-02', block.id, true)
  ctx.reply = JSON.stringify({ summary: '有冲突', appointments: [event] })
  await assert.rejects(service.workflowRun({ text: event.evidence, mode: 'plan', apply: true, replaceConflicts: true }), /已完成/)
  assert.equal(service.dayPlan('2026-10-02').blocks.length, 1)
})

test('manual editing changes descriptions and exact times, then applies without a second AI request', async () => {
  const { service, ctx } = await fixture()
  ctx.reply = JSON.stringify({ summary: '聚餐', appointments: [event], tasks: [{ title: '作业', category: 'study', periods: 1 }] })
  const { run } = await service.workflowRun({ text: event.evidence, mode: 'plan' })
  const updated = await service.workflowEditDraft(run.id, { appointments: [{ index: 0, title: '和学长聚餐', date: '2026-10-02', startMinute: 580, endMinute: 635, note: '校门口' }],
    tasks: [{ index: 0, title: '投资学作业', dueDate: '2026-10-02', date: '2026-10-02', startMinute: null, endMinute: null, note: '完成第一题' }] }, run.updatedAt)
  assert.match(updated.rawText, /用户手动微调/)
  await service.workflowApply(run.id, true)
  const block = service.dayPlan('2026-10-02').blocks.find((block) => block.title === '和学长聚餐')!
  assert.equal(block.startMinute, 580); assert.equal(block.endMinute, 635); assert.equal(block.note, '校门口')
  assert.equal(ctx.prompts.length, 1)
  assert(service.workflowContext().tasks.some((task) => task.title === '投资学作业' && task.note === '完成第一题'))
})

test('the user can fill a missing end, replace a conflicting old position and pin a task to exact time', async () => {
  const { service, ctx } = await fixture()
  await service.upsertBlock('2026-10-02', { title: '原阅读', startPeriod: 3, endPeriod: 4 })
  ctx.reply = JSON.stringify({ summary: '猜结束时间', appointments: [{ ...event, evidence: '明天9点半聚餐' }], tasks: [{ title: '学习', category: 'study', periods: 1 }] })
  const { run } = await service.workflowRun({ text: '明天9点半聚餐，再学习', mode: 'plan' })
  assert.equal(run.draft!.appointments[0]!.timeBasis, 'estimated')
  await service.workflowEditDraft(run.id, { appointments: [{ index: 0, title: '聚餐', date: '2026-10-02', startMinute: 570, endMinute: 630, note: '' }],
    tasks: [{ index: 0, title: '学习', dueDate: '2026-10-02', date: '2026-10-02', startMinute: 660, endMinute: 705, note: '读论文' }] })
  const result = await service.workflowApply(run.id, true)
  assert.equal(result.run.draft!.questions.length, 0)
  assert(service.dayPlan('2026-10-02').blocks.some((block) => block.title === '学习' && block.appointment && block.startMinute === 660 && block.note === '读论文'))
  assert.equal(service.workflowContext().tasks.filter((task) => task.title === '学习').length, 0)
})

test('invalid or stale manual edits reject without changing the stored draft', async () => {
  const { service, ctx } = await fixture()
  ctx.reply = JSON.stringify({ summary: '聚餐', appointments: [event] })
  const { run } = await service.workflowRun({ text: event.evidence, mode: 'plan' })
  await assert.rejects(service.workflowEditDraft(run.id, { appointments: [{ index: 0, title: '聚餐', date: '2026-10-02', startMinute: 650, endMinute: 630 }] }), /结束时间/)
  await assert.rejects(service.workflowEditDraft(run.id, {}, 'old-version'), /新版本/)
  assert.deepEqual(service.workflowHistory()[0]!.draft, run.draft)
})

test('replacement cannot undo a completion supplied in the same feedback', async () => {
  const { service, ctx } = await fixture()
  const task = await service.upsertBacklog({ title: '旧阅读' })
  await service.upsertBlock('2026-10-02', { title: task.title, backlogId: task.id, startPeriod: 3, endPeriod: 4 })
  ctx.reply = JSON.stringify({ summary: '完成阅读，明天聚餐', taskActions: [{ taskId: task.id, action: 'complete', date: '2026-10-01', evidence: '今天阅读做完了' }], appointments: [event] })
  await service.workflowRun({ text: `今天阅读做完了，${event.evidence}`, mode: 'review', apply: true, replaceConflicts: true })
  const record = (service.exportAll().backlog as any)[task.id]
  assert.equal(record.done, true); assert.equal(record.state, 'completed')
  assert(!service.dayPlan('2026-10-02').blocks.some((block) => block.backlogId === task.id && activeBlock(block)))
})
