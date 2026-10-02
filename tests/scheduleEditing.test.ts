import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture } from './helpers/host.ts'
import { DEFAULT_PERIODS } from '../src/seed.ts'

const event = { date: '2026-10-02', title: '朋友聚餐', category: 'activity', startMinute: 1080, endMinute: 1200, evidence: '明天下午六点左右吃饭' }
const edit = { index: 0, title: '与学长聚餐', date: event.date, startMinute: 1110, endMinute: 1230, note: '餐厅见' }
async function setup() {
  const host = await fixture()
  await host.service.updateSettings({ periods: DEFAULT_PERIODS, dayEndPeriod: 17 })
  host.ctx.reply = JSON.stringify({ summary: '安排聚餐', appointments: [event] })
  const result = await host.service.workflowRun({ text: event.evidence, mode: 'plan', apply: true })
  return { ...host, run: result.run }
}

test('saved activities can be edited in place repeatedly, with stable IDs and no AI replay', async () => {
  const { service, ctx, run } = await setup()
  const original = service.dayPlan(event.date).blocks.find((block) => block.title === event.title)!
  assert.equal(run.draft!.appointments[0]!.blockId, original.id)
  const next = await service.workflowEditSchedule(run.id, { tasks: [], appointments: [edit] }, run.updatedAt)
  const block = service.dayPlan(event.date).blocks.find((block) => block.id === original.id)!
  assert.equal(block.startMinute, 1110); assert.equal(block.endMinute, 1230)
  assert.equal(block.title, edit.title); assert.equal(block.note, edit.note)
  assert.equal(block.done, false)
  assert.equal(service.dayPlan(event.date).blocks.length, 1)
  const again = await service.workflowEditSchedule(run.id, { appointments: [{ ...edit, startMinute: 1120, endMinute: 1240 }] }, next.updatedAt)
  assert.equal(again.draft!.appointments[0]!.blockId, original.id)
  assert.equal(ctx.prompts.length, 1)
})

test('editing the date moves the same activity instead of leaving two calendar items', async () => {
  const { service, run } = await setup()
  const updated = await service.workflowEditSchedule(run.id, { appointments: [{ ...edit, date: '2026-10-05' }] }, run.updatedAt)
  assert.equal(service.dayPlan(event.date).blocks.length, 0)
  const target = service.dayPlan('2026-10-05').blocks[0]!
  assert.equal(target.id, run.draft!.appointments[0]!.blockId)
  assert.equal(updated.draft!.appointments[0]!.date, '2026-10-05')
})

test('a conflicting batch rejects before saving any changed row', async () => {
  const { service, ctx } = await fixture()
  await service.updateSettings({ periods: DEFAULT_PERIODS, dayEndPeriod: 17 })
  const second = { ...event, title: '喝酒', startMinute: 1215, endMinute: 1305, evidence: '明天晚上八点十五喝酒' }
  ctx.reply = JSON.stringify({ summary: '两个活动', appointments: [event, second] })
  const { run } = await service.workflowRun({ mode: 'plan', text: `${event.evidence}，${second.evidence}`, apply: true })
  const before = service.dayPlan(event.date)
  await assert.rejects(service.workflowEditSchedule(run.id, { appointments: [edit,
    { ...edit, index: 1, title: second.title, startMinute: 1200, endMinute: 1300 }] }), /重叠/)
  assert.deepEqual(service.dayPlan(event.date), before)
})

test('completed, started and withdrawn records are protected from post-apply edits', async () => {
  for (const kind of ['completed', 'started', 'withdrawn'] as const) {
    const { service, stores, run } = await setup()
    const day = service.dayPlan(event.date)
    if (kind === 'started') (service as any).now = () => new Date('2026-10-02T10:01:00Z')
    else stores.get('plans')!.set(event.date, { ...day, blocks: day.blocks.map((block) => kind === 'completed' ? { ...block, done: true } : { ...block, disposition: 'deferred' }) })
    const before = service.dayPlan(event.date)
    await assert.rejects(service.workflowEditSchedule(run.id, { appointments: [edit] }), /已开始、已完成/)
    assert.deepEqual(service.dayPlan(event.date), before)
  }
})

test('stale versions and calendar changes elsewhere cannot be silently overwritten', async () => {
  const { service, stores, run } = await setup()
  await assert.rejects(service.workflowEditSchedule(run.id, { appointments: [edit] }, 'old-version'), /新版本/)
  const day = service.dayPlan(event.date)
  stores.get('plans')!.set(event.date, { ...day, blocks: day.blocks.map((block) => ({ ...block, note: '另一处已修改' })) })
  await assert.rejects(service.workflowEditSchedule(run.id, { appointments: [edit] }), /其他地方调整/)
})

test('saving a schedule edit never replays linked actual learning progress', async () => {
  const { service, ctx } = await fixture()
  await service.updateSettings({ periods: DEFAULT_PERIODS, dayEndPeriod: 17 })
  const book = await service.upsertReading({ title: '概率论' })
  const evidence = '今天概率论读了20页'
  ctx.reply = JSON.stringify({ summary: '补记并安排', appointments: [event], learningLogs: [{ date: '2026-10-01', ref: book.id, title: book.title, kind: 'reading', mode: 'delta', value: 20, evidence }] })
  const { run } = await service.workflowRun({ mode: 'review', text: `${evidence}，${event.evidence}`, apply: true })
  const gain = service.workflowContext().learning.reading[0]!.gain
  assert.equal(gain, 20)
  await service.workflowEditSchedule(run.id, { appointments: [edit] })
  assert.equal(service.workflowContext().learning.reading[0]!.gain, gain)
  assert.equal(ctx.prompts.length, 1)
})
