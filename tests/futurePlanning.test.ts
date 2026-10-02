import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture } from './helpers/host.ts'

const appointment = (date = '2026-10-02', title = '朋友聚餐', startMinute = 550, endMinute = 605) => ({
  date, title, category: 'activity', lifeArea: 'relationships', startMinute, endMinute, evidence: '明天09:10–10:05和朋友聚餐',
})

test('outlook writes exact future commitments, displaces flexible work and never records completion', async () => {
  const { service, ctx } = await fixture()
  ctx.reply = JSON.stringify({ summary: '安排聚餐和论文', appointments: [appointment()],
    tasks: [{ title: '论文修改', category: 'study', periods: 2, notBefore: '2026-10-02', dueDate: '2026-10-02' }] })
  const result = await service.workflowRun({ text: '明天09:10–10:05和朋友聚餐，再安排论文修改。', mode: 'plan', apply: true })
  const day = service.dayPlan('2026-10-02')
  const event = day.blocks.find((block) => block.title === '朋友聚餐')!
  assert.equal(event.startMinute, 550); assert.equal(event.endMinute, 605)
  assert.equal(event.startPeriod, 2); assert.equal(event.endPeriod, 4)
  assert.equal(event.source, 'manual'); assert.equal(event.done, false); assert.equal(event.lifeArea, 'relationships')
  assert(day.blocks.some((block) => block.title === '论文修改'))
  assert(day.blocks.filter((block) => block.adaptive).every((block) => block.endMinute <= 550 || block.startMinute >= 605))
  assert.equal(day.observations?.length ?? 0, 0)
  assert.equal(service.gymSession('2026-10-02').finishedAt, null)
  assert.equal(result.run.status, 'applied'); assert.match(result.run.appliedChanges!.join('\n'), /09:10–10:05/)
  assert.match(ctx.prompts[0], /未来安排区间：2026-10-01 至 2026-10-14/)
  assert.match(ctx.prompts[0], /planningDays/)
})

test('a selected next week includes Sunday and persists its lower bound for later rebalancing', async () => {
  const { service, ctx } = await fixture()
  ctx.reply = JSON.stringify({ summary: '下周安排', appointments: [{ ...appointment('2026-10-11', '周日会议', 600, 660), evidence: '下周日10:00–11:00开会' }],
    tasks: [{ title: '下周论文', category: 'study', periods: 2 }, { title: '周日准备', category: 'study', periods: 1, notBefore: '2026-10-11', dueDate: '2026-10-11' }] })
  const result = await service.workflowRun({ text: '下周日10:00–11:00开会，下周完成论文和周日准备。', mode: 'plan', weekKey: '2026-W41', planStart: '2026-10-05', planEnd: '2026-10-11', apply: true })
  assert.deepEqual(result.allocation!.days.map((day) => day.date), ['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10','2026-10-11'])
  assert(service.dayPlan('2026-10-11').blocks.some((block) => block.title === '周日会议'))
  assert(result.allocation!.scheduled.some((item) => item.date === '2026-10-11'))
  const task = service.workflowContext('2026-W41').tasks.find((task) => task.title === '下周论文')!
  assert.equal(task.notBefore, '2026-10-05')
  await service.replan()
  assert(!service.dayPlan('2026-10-01').blocks.some((block) => block.title === '下周论文'))
  assert(service.workflowContext().recentFeedback.some((run) => run.id === result.run.id))
})

test('fixed activity and its task are not duplicated on retry or a repeated new request', async () => {
  const { service, ctx } = await fixture()
  ctx.reply = JSON.stringify({ summary: '安排聚餐', appointments: [appointment()], tasks: [{ title: '准备材料', category: 'study' }] })
  const input = { text: '明天09:10–10:05和朋友聚餐，准备材料。', mode: 'plan' as const, apply: true }
  const first = await service.workflowRun(input)
  await service.workflowApply(first.run.id)
  await service.workflowRun(input)
  assert.equal(service.dayPlan('2026-10-02').blocks.filter((block) => block.title === '朋友聚餐').length, 1)
  assert.equal(service.workflowContext().tasks.filter((task) => task.title === '准备材料').length, 1)
})

test('conflicting future activity rejects before facts, tasks, memory or calendar writes', async () => {
  const { service, ctx } = await fixture()
  await service.upsertBlock('2026-10-02', { title: '固定会议', startPeriod: 2, endPeriod: 3 })
  const before = service.exportAll()
  ctx.reply = JSON.stringify({ summary: '有冲突', appointments: [appointment()], tasks: [{ title: '新论文', category: 'study' }], memories: [{ text: '上午学习', evidence: '上午学习' }] })
  await assert.rejects(service.workflowRun({ text: '明天09:10–10:05和朋友聚餐，上午学习。', mode: 'plan', apply: true }), /冲突/)
  const after = service.exportAll()
  assert.deepEqual(after.plans, before.plans); assert.deepEqual(after.backlog, before.backlog); assert.deepEqual(after.personal_memory, before.personal_memory)
})

test('mutually overlapping new activities reject together, with no partial calendar', async () => {
  const { service, ctx } = await fixture()
  ctx.reply = JSON.stringify({ summary: '两场活动', appointments: [appointment(), { ...appointment('2026-10-02', '另一场', 580, 640), evidence: '另一场09:40–10:40' }] })
  await assert.rejects(service.workflowRun({ text: '明天09:10–10:05和朋友聚餐，另一场09:40–10:40', mode: 'plan', apply: true }), /互相重叠/)
  assert.equal(service.dayPlan('2026-10-02').blocks.length, 0)
})

test('missing event times stay as clarification, not fake appointments or execution', async () => {
  const { service, ctx } = await fixture()
  ctx.reply = JSON.stringify({ summary: '需要确认聚餐时间', questions: ['明天聚餐几点开始、几点结束？'] })
  const result = await service.workflowRun({ text: '明天和朋友聚餐', mode: 'plan', apply: true })
  assert.equal(result.run.draft!.questions.length, 1)
  assert.equal(service.dayPlan('2026-10-02').blocks.length, 0)
  assert.equal(service.dayPlan('2026-10-02').observations?.length ?? 0, 0)
})

test('future ranges are validated independently of past review and exposed through RPC', async () => {
  const { service, ctx } = await fixture()
  await assert.rejects(service.workflowRun({ text: '安排', mode: 'plan', planStart: '2026-09-30' }), /展望范围/)
  await assert.rejects(service.workflowRun({ text: '安排', mode: 'plan', planEnd: '2026-11-01' }), /展望范围/)
  assert.equal(ctx.prompts.length, 0)
  const response = await ctx.rpc('workflow.run', { text: '安排明天', mode: 'plan', planStart: '2026-10-02', planEnd: '2026-10-02', apply: true }, new AbortController().signal)
  assert.equal(response.ok, true)
  assert.equal(response.value.run.planStart, '2026-10-02'); assert.equal(response.value.allocation.days.length, 1)
})

test('a review can record past facts and arrange future activities in the same submission', async () => {
  const { service, ctx } = await fixture()
  ctx.reply = JSON.stringify({ summary: '记录散步，安排聚餐', activityLogs: [{ date: '2026-09-30', title: '散步', lifeArea: 'health', evidence: '昨天散步了' }], appointments: [appointment()] })
  await service.workflowRun({ text: '昨天散步了，明天09:10–10:05和朋友聚餐', mode: 'review', apply: true })
  assert.equal(service.dayPlan('2026-09-30').observations?.[0]?.title, '散步')
  assert.equal(service.dayPlan('2026-10-02').blocks[0]?.title, '朋友聚餐')
  assert.equal(service.dayPlan('2026-10-02').observations?.length ?? 0, 0)
})

test('future actual logs, unsupported evidence and out-of-window events cannot be applied', async () => {
  const { service, ctx } = await fixture()
  ctx.reply = JSON.stringify({ summary: '错误的实绩', activityLogs: [{ date: '2026-10-02', title: '聚餐完成', lifeArea: 'relationships', evidence: '明天聚餐' }] })
  const future = await service.workflowRun({ text: '明天聚餐', mode: 'plan', apply: true })
  assert.equal(future.run.status, 'applied')
  assert.equal(service.dayPlan('2026-10-02').observations?.length ?? 0, 0)
  ctx.reply = JSON.stringify({ summary: '没有原文依据', appointments: [appointment()] })
  const unsupported = await service.workflowRun({ text: '安排明天', mode: 'plan', apply: true })
  assert.equal(unsupported.run.status, 'applied')
  assert(unsupported.run.applyWarnings?.some((warning) => warning.includes('原文')))
  ctx.reply = JSON.stringify({ summary: '不在所选日期', appointments: [appointment()] })
  await assert.rejects(service.workflowRun({ text: '明天09:10–10:05和朋友聚餐', mode: 'plan', planStart: '2026-10-05', planEnd: '2026-10-11', apply: true }), /不在本次安排日期/)
  assert.equal(service.dayPlan('2026-10-02').blocks.length, 0)
})

test('out-of-range errors identify the event and selected dates before any personal data changes', async () => {
  const { service, ctx } = await fixture()
  const before = service.exportAll()
  ctx.reply = JSON.stringify({ summary: '日期不符', appointments: [appointment()], tasks: [{ title: '新论文', category: 'study' }] })
  const { run } = await service.workflowRun({ text: appointment().evidence, mode: 'plan', planStart: '2026-10-05', planEnd: '2026-10-11' })
  await assert.rejects(service.workflowApply(run.id), /「朋友聚餐」在 2026-10-02.*2026-10-05 至 2026-10-11/)
  const after = service.exportAll()
  assert.deepEqual(after.plans, before.plans)
  assert.deepEqual(after.backlog, before.backlog)
  assert.equal(service.workflowStatus(run.id).run.status, 'ready')
})

test('a passed start reports its actual time rather than calling it an out-of-range date', async () => {
  const { service, ctx } = await fixture()
  const event = { ...appointment('2026-10-01'), evidence: '今天09:10–10:05和朋友聚餐' }
  ctx.reply = JSON.stringify({ summary: '今天聚餐', appointments: [event] })
  const { run } = await service.workflowRun({ text: event.evidence, mode: 'plan', planStart: event.date, planEnd: event.date })
  ;(service as any).now = () => new Date('2026-10-01T01:15:00Z')
  await assert.rejects(service.workflowApply(run.id), /09:10 已过去；现在是 2026-10-01 09:15/)
  assert.equal(service.dayPlan(event.date).blocks.length, 0)
})

test('a past unconfirmed appointment stays on its date instead of being carried to a new party', async () => {
  const { service, ctx } = await fixture()
  ctx.reply = JSON.stringify({ summary: '安排聚餐', appointments: [appointment()] })
  await service.workflowRun({ text: '明天09:10–10:05和朋友聚餐', mode: 'plan', apply: true })
  ;(service as any).now = () => new Date('2026-10-03T00:00:00Z')
  await service.replan()
  assert.equal(service.dayPlan('2026-10-02').blocks[0]?.appointment, true)
  assert.equal(service.dayPlan('2026-10-02').blocks[0]?.done, false)
  assert.equal(service.workflowContext().tasks.filter((task) => task.title === '朋友聚餐').length, 0)
  assert(!service.dayPlan('2026-10-03').blocks.some((block) => block.title === '朋友聚餐'))
})

test('future appointment intents survive allocation failure and an apply retry exactly once', async () => {
  const { service, ctx } = await fixture()
  ctx.reply = JSON.stringify({ summary: '安排聚餐', appointments: [appointment()] })
  const original = (service as any).replanCore
  ;(service as any).replanCore = async () => { throw new Error('模拟排程中断') }
  await assert.rejects(service.workflowRun({ text: '明天09:10–10:05和朋友聚餐', mode: 'plan', apply: true }), /排程中断/)
  const run = service.workflowHistory()[0]!
  assert.equal(run.intentApplied, true)
  ;(service as any).replanCore = original
  const result = await service.workflowApply(run.id)
  assert.equal(result.run.status, 'applied')
  assert.equal(service.dayPlan('2026-10-02').blocks.filter((block) => block.title === '朋友聚餐').length, 1)
  assert.equal(result.run.appliedChanges!.filter((change) => change.includes('已安排活动')).length, 1)
})

test('course syncing, a title edit and a date-only drag retain explicit activity minutes and its commitment type', async () => {
  const { service, ctx } = await fixture()
  ctx.reply = JSON.stringify({ summary: '安排聚餐', appointments: [appointment()] })
  await service.workflowRun({ text: '明天09:10–10:05和朋友聚餐', mode: 'plan', apply: true })
  await service.generateWeek('2026-W40')
  const event = service.dayPlan('2026-10-02').blocks.find((block) => block.title === '朋友聚餐')!
  assert.equal(event.startMinute, 550); assert.equal(event.endMinute, 605)
  await service.upsertBlock('2026-10-02', { id: event.id, title: '朋友聚餐（餐厅见）', startPeriod: 2, endPeriod: 4 })
  const edited = service.dayPlan('2026-10-02').blocks.find((block) => block.id === event.id)!
  assert.equal(edited.startMinute, 550); assert.equal(edited.endMinute, 605); assert.equal(edited.appointment, true)
  await service.moveBlock('2026-10-02', event.id, '2026-10-03', 2, 4)
  const moved = service.dayPlan('2026-10-03').blocks.find((block) => block.id === event.id)!
  assert.equal(moved.startMinute, 550); assert.equal(moved.endMinute, 605); assert.equal(moved.appointment, true)
})
