import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture } from './helpers/host.ts'
import { DEFAULT_PERIODS } from '../src/seed.ts'
import { activeBlock } from '../src/adaptive.ts'
import { fitEstimatedAppointments, normalizeAppointmentEvidence } from '../src/appointmentEvidence.ts'
import { WorkflowDraftSchema, PlanBlockSchema } from '../src/domain.ts'

const dinner = { date: '2026-10-02', title: '和朋友吃饭', category: 'activity', lifeArea: 'relationships', startMinute: 1080, endMinute: null,
  evidence: '明天下午六点左右和朋友吃饭' }

test('null end and string advice are normalized; estimated intent is persisted without fabricated execution', async () => {
  const { service, ctx } = await fixture()
  await service.updateSettings({ periods: DEFAULT_PERIODS, dayEndPeriod: 17 })
  ctx.reply = JSON.stringify({ summary: '先吃饭，再看情况喝酒。', appointments: [dinner,
    { ...dinner, title: '可能喝酒', startMinute: 1215, endMinute: null, evidence: '晚上可能喝酒' }], gymAdvice: '没有实际训练数据，暂不判断进步。' })
  const result = await service.workflowRun({ mode: 'plan', text: `${dinner.evidence}，晚上可能喝酒`, apply: true })
  assert.equal(result.run.status, 'applied')
  const blocks = service.dayPlan(dinner.date).blocks.filter(activeBlock)
  assert.equal(blocks.find((block) => block.title === dinner.title)?.endMinute, 1200)
  assert.equal(blocks.find((block) => block.title === '可能喝酒')?.endMinute, 1305)
  assert(blocks.every((block) => block.timeBasis === 'estimated' && !block.done && block.executionStatus !== 'completed'))
  assert.equal(result.run.draft!.gymAdvice.length, 1)
  assert.equal(service.workflowContext().gym.length, 0)
  assert.equal(ctx.prompts.length, 1)
})

test('estimated activities avoid a locked commitment, precise activities are never silently moved', async () => {
  const { service, ctx, stores } = await fixture()
  const day = await service.upsertBlock(dinner.date, { title: '不可移动的会议', startPeriod: 2, endPeriod: 3 })
  stores.get('plans')!.set(dinner.date, { ...day, blocks: day.blocks.map((block) => ({ ...block, locked: true })) })
  const evidence = '明天9点左右有个活动'
  ctx.reply = JSON.stringify({ summary: '安排活动', appointments: [{ ...dinner, title: '个人活动', startMinute: 540, endMinute: null, evidence }] })
  const result = await service.workflowRun({ mode: 'plan', text: evidence, apply: true, replaceConflicts: true })
  assert.equal(result.run.status, 'applied')
  const block = service.dayPlan(dinner.date).blocks.find((block) => block.title === '个人活动')!
  assert.equal(block.startMinute, 615)
  assert.equal(service.dayPlan(dinner.date).blocks.find((block) => block.title === '不可移动的会议')!.disposition, undefined)
  ctx.reply = JSON.stringify({ summary: '明确的活动', appointments: [{ ...dinner, title: '精确活动', startMinute: 540, endMinute: 570, evidence: '明天9点到9点半精确活动' }] })
  await assert.rejects(service.workflowRun({ mode: 'plan', text: '明天9点到9点半精确活动', apply: true, replaceConflicts: true }), /冲突/)
})

test('an estimated start already passed is rounded forward to now, with the reason visible', async () => {
  const { service, ctx } = await fixture()
  ;(service as any).now = () => new Date('2026-10-01T01:09:00Z')
  ctx.reply = JSON.stringify({ summary: '今天健身', appointments: [{ date: '2026-10-01', title: '健身', category: 'gym', startMinute: 540, endMinute: null, evidence: '现在9点左右去健身' }] })
  const result = await service.workflowRun({ mode: 'plan', text: '现在9点左右去健身', apply: true })
  const block = service.dayPlan('2026-10-01').blocks.find((block) => block.title === '健身')!
  assert.equal(block.startMinute, 550)
  assert.equal(block.endMinute, 625)
  assert.match(result.run.draft!.appointments[0]!.timeAssumption!, /已开始/)
  assert.equal(block.done, false)
})

test('manual time edits confirm an estimate and keep it visible in fresh cross-week context', async () => {
  const { service, ctx } = await fixture()
  await service.updateSettings({ periods: DEFAULT_PERIODS, dayEndPeriod: 17 })
  ctx.reply = JSON.stringify({ summary: '下周吃饭', appointments: [{ ...dinner, date: '2026-10-05', evidence: '下周一六点左右吃饭' }] })
  const { run } = await service.workflowRun({ mode: 'plan', weekKey: '2026-W41', planStart: '2026-10-05', planEnd: '2026-10-11', text: '下周一六点左右吃饭' })
  await service.workflowEditDraft(run.id, { tasks: [], appointments: [{ index: 0, title: '朋友聚餐', date: '2026-10-05', startMinute: 1110, endMinute: 1230, note: '校门口' }] })
  await service.workflowApply(run.id)
  const reopened = service.workflowContext('2026-W40')
  assert.equal(reopened.latestConversation!.id, run.id)
  const block = reopened.upcomingDays.find((day) => day.date === '2026-10-05')!.blocks.find((block) => block.title === '朋友聚餐')!
  assert.equal(block.timeBasis, 'manual')
  assert.equal(block.startMinute, 1110)
  assert.equal(ctx.prompts.length, 1)
})

test('model representation repair never coerces missing real training reps into achievements', async () => {
  const { service, ctx } = await fixture()
  ctx.reply = JSON.stringify({ summary: '训练', gymLogs: [{ date: '2026-10-01', finished: true, evidence: '今天卧推', exercises: [{ exerciseId: null, name: '卧推', part: 'chest', evidence: '今天卧推', sets: [{ reps: null, weight: 40, unit: 'kg', rir: null }] }] }] })
  const { run } = await service.workflowRun({ mode: 'review', text: '今天卧推', apply: true })
  assert.equal(run.status, 'failed')
  assert.equal(service.workflowContext().gym.length, 0)
})

test('missing Chinese start time is inferred without another model request', async () => {
  const { service, ctx } = await fixture()
  await service.updateSettings({ periods: DEFAULT_PERIODS, dayEndPeriod: 17 })
  const evidence = '明天下午六点半左右和朋友吃饭'
  ctx.reply = JSON.stringify({ summary: '暂定聚餐', appointments: [{ ...dinner, startMinute: null, evidence }] })
  const result = await service.workflowRun({ mode: 'plan', text: evidence, apply: true })
  assert.equal(result.run.draft!.appointments[0]!.startMinute, 1110)
  assert.equal(result.run.draft!.appointments[0]!.endMinute, 1230)
  assert.equal(ctx.prompts.length, 1)
})

test('capacity repair never moves an evening activity to breakfast', () => {
  const draft = normalizeAppointmentEvidence(WorkflowDraftSchema.parse({ summary: '晚上喝酒', appointments: [
    { ...dinner, startMinute: 1200, endMinute: 1290, evidence: '明天晚上可能喝酒' },
  ] }))
  const blocked = PlanBlockSchema.parse({ id: 'fixed', title: '固定活动', category: 'activity', source: 'routine', weekday: 5, startPeriod: 1, endPeriod: 2, startMinute: 1080, endMinute: 1440 })
  const result = fitEstimatedAppointments(draft, { date: '2026-10-01', minute: 480, replaceConflicts: true, days: [{ date: dinner.date, blocks: [blocked] }], minMinute: 420, maxMinute: 1440 })
  assert.equal(result.appointments[0]!.startMinute, 1200)
})
