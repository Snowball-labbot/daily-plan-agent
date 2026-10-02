import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture } from './helpers/host.ts'
import { personalSignals } from '../src/adaptive.ts'
import { gymProgress, reuseSessionItems } from '../src/gym.ts'
import { lifeAreaOf } from '../src/life.ts'
import { computeDayStat } from '../src/stats.ts'

test('two-day prose review reconciles yesterday completion and removes future duplicate carry', async () => {
  const { service, ctx } = await fixture()
  await service.upsertBlock('2026-09-30', { title: '论文初稿', startPeriod: 1, endPeriod: 2 })
  await service.replan()
  const past = service.dayPlan('2026-09-30').blocks[0]!
  const text = '昨天论文初稿已经完成，只是忘了打勾。以后上午学习更好。'
  ctx.reply = JSON.stringify({ summary: '补记初稿完成，撤回重复任务。', executions: [{ date: '2026-09-30', blockId: past.id, status: 'completed', evidence: '昨天论文初稿已经完成' }],
    memories: [{ text: '上午学习更合适', evidence: '以后上午学习更好' }] })
  const result = await service.workflowRun({ text, mode: 'review', apply: true })
  assert.equal(result.run.status, 'applied')
  assert.equal(service.dayPlan('2026-09-30').blocks[0]!.done, true)
  assert(!service.dayPlan('2026-10-01').blocks.some((block) => block.title === '论文初稿'))
  assert.equal(service.workflowContext().tasks.length, 0)
  assert.equal(service.memories().length, 1)
  assert.equal(service.review('2026-10-01')!.rangeStart, '2026-09-30')
  assert(result.run.appliedChanges!.some((change) => change.includes('补记完成')))
  await service.workflowApply(result.run.id)
  assert.equal(service.memories().length, 1)
})

test('AI can update, cancel and complete existing pool tasks with source evidence', async () => {
  const { service, ctx } = await fixture()
  const postpone = await service.upsertBacklog({ title: '英语', priority: 3 })
  const cancel = await service.upsertBacklog({ title: '过期活动', category: 'activity' })
  const complete = await service.upsertBacklog({ title: '交作业' })
  ctx.reply = JSON.stringify({ summary: '更新任务池', taskActions: [
    { taskId: postpone.id, action: 'update', evidence: '英语推到周六', patch: { notBefore: '2026-10-03', priority: 1 } },
    { taskId: cancel.id, action: 'cancel', evidence: '活动不用做了' },
    { taskId: complete.id, action: 'complete', date: '2026-09-30', evidence: '昨天交完作业了' },
  ], tasks: [{ title: '周六和朋友聚餐', category: 'activity', lifeArea: 'relationships', notBefore: '2026-10-03' }] })
  await service.workflowRun({ text: '英语推到周六，活动不用做了，昨天交完作业了，周六和朋友聚餐。', mode: 'review', apply: true })
  const tasks = Object.values(service.exportAll().backlog as Record<string, any>)
  assert.equal(tasks.find((task) => task.id === postpone.id).notBefore, '2026-10-03')
  assert.equal(tasks.find((task) => task.id === cancel.id).state, 'cancelled')
  assert.equal(tasks.find((task) => task.id === complete.id).state, 'completed')
  const social = service.dayPlan('2026-10-03').blocks.find((block) => block.title === '周六和朋友聚餐')!
  assert.equal(lifeAreaOf(social), 'relationships')
})

test('unchecked history remains unknown and cannot depress calibrated capacity', async () => {
  const { service } = await fixture()
  for (const date of ['2026-09-28', '2026-09-29', '2026-09-30']) await service.upsertBlock(date, { title: '忘了记录', startPeriod: 1, endPeriod: 2 })
  await service.replan()
  const signals = service.workflowContext().signals
  assert.equal(signals.completionRate, null); assert.equal(signals.sampleDays, 0); assert.equal(signals.loadFactor, 1)
  assert.equal(service.workflowContext().completion.unknown, 3)
  const plans = ['2026-09-28', '2026-09-29', '2026-09-30'].map((date) => service.dayPlan(date))
  assert.equal(personalSignals(plans, [], '2026-10-01').completionRate, null)
  const stat = computeDayStat('2026-09-30', service.dayPlan('2026-09-30'), undefined, undefined, { countCourseBlocks: true, todayIso: '2026-10-01' })
  assert.equal(stat.unknown, 1); assert.equal(stat.level, -1)
})

test('unsupported historical facts are isolated while supported new arrangements can be applied', async () => {
  const { service, ctx } = await fixture()
  await service.upsertBlock('2026-09-30', { title: '论文', startPeriod: 1, endPeriod: 2 })
  const block = service.dayPlan('2026-09-30').blocks[0]!
  ctx.reply = JSON.stringify({ summary: '安排英语，保留未知完成状态', tasks: [{ title: '学英语', category: 'study' }],
    executions: [{ date: '2026-09-30', blockId: block.id, status: 'completed', evidence: '捏造了完成事实' }] })
  const result = await service.workflowRun({ text: '最近忙，帮我安排学英语', mode: 'review', apply: true })
  assert.equal(result.run.status, 'applied')
  assert(result.run.applyWarnings?.some((warning) => warning.includes('原文')))
  assert(Object.values(service.exportAll().backlog as Record<string, any>).some((task) => task.title === '学英语')); assert.equal(service.dayPlan('2026-09-30').blocks[0]!.done, false)
  ctx.reply = JSON.stringify({ summary: '日期不对', executions: [{ date: '2026-09-30', blockId: block.id, status: 'completed', evidence: '论文做完' }] })
  const next = await service.workflowRun({ text: '论文做完', mode: 'review', rangeStart: '2026-10-01', apply: true })
  assert.equal(next.run.status, 'applied')
  assert.equal(service.dayPlan('2026-09-30').blocks[0]!.done, false)
})

test('review reconstructs actual gym sets once and attendance completes linked training', async () => {
  const { service, ctx } = await fixture()
  const exercise = service.listExercises()[0]!
  await service.upsertBlock('2026-09-30', { title: '健身', category: 'gym', startPeriod: 1, endPeriod: 2 })
  await service.replan()
  const text = `昨天${exercise.name}40kg三组每组10次，都还能做两次，训练完成。`
  ctx.reply = JSON.stringify({ summary: '补记训练', gymLogs: [{ date: '2026-09-30', finished: true, evidence: text,
    exercises: [{ exerciseId: exercise.id, name: exercise.name, part: exercise.part, evidence: text,
      sets: Array.from({ length: 3 }, () => ({ reps: 10, weight: 40, unit: 'kg', rir: 2 })) }] }] })
  const result = await service.workflowRun({ text, mode: 'review', apply: true })
  const session = service.gymSession('2026-09-30')
  assert.equal(session.items[0]!.actualSets!.length, 3); assert.equal(session.items[0]!.doneSets, 3)
  assert(session.finishedAt); assert(service.dayPlan('2026-09-30').blocks[0]!.done)
  assert(!service.dayPlan('2026-10-01').blocks.some((block) => block.category === 'gym'))
  await service.workflowApply(result.run.id)
  await service.workflowRun({ text, mode: 'review', apply: true })
  assert.equal(service.gymSession('2026-09-30').items[0]!.actualSets!.length, 3)
  const point = service.gymPerformance()[0]!.points[0]!
  assert.equal(point.volumeKg, 1200); assert.equal(point.reps, 30); assert.equal(point.averageRir, 2)
})

test('attendance-only review never fabricates exercises, repetitions or weights', async () => {
  const { service, ctx } = await fixture()
  ctx.reply = JSON.stringify({ summary: '训练出勤', gymLogs: [{ date: '2026-09-30', finished: true, evidence: '昨天健身结束了', exercises: [] }], questions: ['下次补充动作和次数即可。'] })
  const result = await service.workflowRun({ text: '昨天健身结束了，但忘了动作次数。', mode: 'review', apply: true })
  assert(service.gymSession('2026-09-30').finishedAt)
  assert.equal(service.gymSession('2026-09-30').items.length, 0)
  assert.equal(service.gymPerformance().length, 0)
  assert.equal(result.run.draft!.questions.length, 1)
})

test('conflicting gym recall preserves existing manual logs and displays warning', async () => {
  const { service, ctx } = await fixture()
  const exercise = service.listExercises()[0]!
  await service.addGymItem('2026-09-30', exercise.id)
  const item = service.gymSession('2026-09-30').items[0]!
  await service.logGymSet('2026-09-30', item.id, { reps: 8, weight: 30, unit: 'kg' })
  ctx.reply = JSON.stringify({ summary: '核对训练', gymLogs: [{ date: '2026-09-30', evidence: '昨天做了10次40kg',
    exercises: [{ exerciseId: exercise.id, name: exercise.name, part: exercise.part, evidence: '昨天做了10次40kg', sets: [{ reps: 10, weight: 40 }] }] }] })
  const result = await service.workflowRun({ text: '昨天做了10次40kg', mode: 'review', apply: true })
  assert.equal(service.gymSession('2026-09-30').items[0]!.actualSets![0]!.weight, 30)
  assert(result.run.applyWarnings!.some((warning) => warning.includes('保留原记录')))
})

test('manual per-set logging is idempotent and copying a template clears actual results', async () => {
  const { service } = await fixture()
  const exercise = service.listExercises()[0]!
  await service.addGymItem('2026-10-01', exercise.id)
  const item = service.gymSession('2026-10-01').items[0]!
  await Promise.all([service.logGymSet('2026-10-01', item.id, { reps: 10, weight: 40 }, 'same-request'), service.logGymSet('2026-10-01', item.id, { reps: 10, weight: 40 }, 'same-request')])
  const session = service.gymSession('2026-10-01')
  assert.equal(session.items[0]!.actualSets!.length, 1); assert.equal(session.items[0]!.doneSets, 1)
  const cloned = reuseSessionItems(session, null, () => 'new-item')
  assert.equal(cloned[0]!.actualSets!.length, 0); assert.equal(cloned[0]!.doneSets, 0)
  await service.removeGymSet('2026-10-01', item.id, 'same-request')
  assert.equal(service.gymSession('2026-10-01').items[0]!.doneSets, 0)
  await assert.rejects(service.logGymSet('2026-10-02', item.id, { reps: 10 }), /今天或过去/)
})

test('historical learning excerpts retain their own dates across a weekly review', async () => {
  const { service, ctx } = await fixture()
  const book = await service.upsertReading({ title: '概率论' })
  ctx.reply = JSON.stringify({ summary: '阅读记录', learningLogs: [
    { date: '2026-09-29', ref: book.id, title: book.title, kind: 'reading', mode: 'delta', value: 10, evidence: '周二读了10页' },
    { date: '2026-09-30', ref: book.id, title: book.title, kind: 'reading', mode: 'delta', value: 20, evidence: '昨天读了20页' },
  ] })
  const text = '周二读了10页，昨天读了20页。'
  await service.workflowRun({ text, mode: 'review', rangeStart: '2026-09-25', apply: true })
  await service.workflowRun({ text, mode: 'review', rangeStart: '2026-09-25', apply: true })
  assert.equal(service.listReading()[0]!.progress, 30)
  assert.deepEqual(service.listReading()[0]!.log.map((log) => log.date), ['2026-09-29', '2026-09-30'])
})

test('fact-phase retry after allocation failure does not repeat completed task operations', async () => {
  const { service, ctx } = await fixture()
  const task = await service.upsertBacklog({ title: '论文' })
  ctx.reply = JSON.stringify({ summary: '已做完', taskActions: [{ taskId: task.id, action: 'complete', date: '2026-10-01', evidence: '今天论文做完了' }] })
  const original = (service as any).replanCore.bind(service)
  ;(service as any).replanCore = async () => { throw new Error('allocation interrupted') }
  await assert.rejects(service.workflowRun({ text: '今天论文做完了', mode: 'review', apply: true }), /interrupted/)
  const run = service.workflowHistory()[0]!
  assert.equal(run.factsApplied, true)
  ;(service as any).replanCore = original
  assert.equal((await service.workflowApply(run.id)).run.status, 'applied')
})

test('a factual past completion also withdraws the clock-started automatic duplicate', async () => {
  const { service, ctx } = await fixture()
  await service.upsertBlock('2026-09-30', { title: '已经完成', startPeriod: 1, endPeriod: 2 })
  await service.replan()
  const past = service.dayPlan('2026-09-30').blocks[0]!
  ;(service as any).now = () => new Date('2026-10-01T00:35:00Z')
  ctx.reply = JSON.stringify({ summary: '完成补记', executions: [{ date: '2026-09-30', blockId: past.id, status: 'completed', evidence: '昨天已经完成' }] })
  await service.workflowRun({ text: '昨天已经完成', mode: 'review', apply: true })
  assert(!service.dayPlan('2026-10-01').blocks.some((block) => block.title === '已经完成' && block.disposition !== 'deferred'))
})

test('training profile changes require direct evidence and preserve other fields', async () => {
  const { service, ctx } = await fixture()
  await service.updateSettings({ fitness: { experience: 'beginner', constraints: '家里只有哑铃' } })
  ctx.reply = JSON.stringify({ summary: '按增肌调整建议', fitnessPatch: { goal: 'hypertrophy' }, fitnessEvidence: '主要想增肌' })
  await service.workflowRun({ text: '主要想增肌', mode: 'review', apply: true })
  assert.equal(service.settings().fitness.goal, 'hypertrophy')
  assert.equal(service.settings().fitness.constraints, '家里只有哑铃')
  ctx.reply = JSON.stringify({ summary: '没有依据', fitnessPatch: { goal: 'strength' }, fitnessEvidence: '不存在' })
  await service.workflowRun({ text: '最近训练挺好', mode: 'review', apply: true })
  assert.equal(service.settings().fitness.goal, 'hypertrophy')
})

test('allocation retry preserves already-applied calendar intents without releasing them twice', async () => {
  const { service, ctx } = await fixture()
  await service.upsertBlock('2026-10-01', { title: '论文', startPeriod: 1, endPeriod: 2 })
  const block = service.dayPlan('2026-10-01').blocks[0]!
  ctx.reply = JSON.stringify({ summary: '会议后再学', rescheduleBlockIds: [block.id],
    unavailable: [{ date: '2026-10-01', startPeriod: 1, endPeriod: 3, reason: '临时会议' }] })
  const original = (service as any).replanCore.bind(service)
  ;(service as any).replanCore = async () => { throw new Error('allocation interrupted') }
  await assert.rejects(service.workflowRun({ text: '临时会议，挪开今天论文', mode: 'review', apply: true }), /interrupted/)
  const run = service.workflowHistory()[0]!
  assert.equal(run.intentApplied, true)
  ;(service as any).replanCore = original
  assert.equal((await service.workflowApply(run.id)).run.status, 'applied')
  assert.equal(service.dayPlan('2026-10-01').blocks.filter((entry) => entry.title === '临时会议').length, 1)
})

test('performance calculations ignore plans/checkmarks and preserve unknown or bodyweight volume', async () => {
  const { service } = await fixture()
  const exercise = service.listExercises()[0]!
  await service.addGymItem('2026-09-29', exercise.id)
  const item = service.gymSession('2026-09-29').items[0]!
  await service.updateGymItem('2026-09-29', item.id, { doneSets: 4, weight: '100', reps: '10' })
  assert.equal(gymProgress([service.gymSession('2026-09-29')]).length, 0)
  await service.logGymSet('2026-09-29', item.id, { reps: 10, weight: null, unit: 'bodyweight' })
  const point = service.gymPerformance()[0]!.points[0]!
  assert.equal(point.volumeKg, null); assert.equal(point.maxWeightKg, null)
})

test('review RPC accepts interval and failures preserve prose without applying', async () => {
  const { service, ctx } = await fixture()
  ctx.failAI = true
  const response = await ctx.rpc('workflow.run', { text: '这周没记但做了不少事', mode: 'review', rangeStart: '2026-09-25', rangeEnd: '2026-10-01', apply: true }, new AbortController().signal)
  assert.equal(response.ok, true); assert.equal(response.value.run.status, 'failed')
  assert.equal(service.workflowHistory()[0]!.rawText, '这周没记但做了不少事')
  assert.equal(service.review('2026-10-01'), null)
  assert(service.workflowHistory()[0]!.rangeStart === '2026-09-25')
})

test('unplanned social activity is remembered without inventing a historical time block', async () => {
  const { service, ctx } = await fixture()
  ctx.reply = JSON.stringify({ summary: '记录人际关系', activityLogs: [{ date: '2026-10-01', title: '和朋友聚餐', lifeArea: 'relationships', evidence: '今天和朋友聚餐了' }] })
  await service.workflowRun({ text: '今天和朋友聚餐了', mode: 'review', apply: true })
  await service.workflowRun({ text: '今天和朋友聚餐了', mode: 'review', apply: true })
  assert.equal(service.dayPlan('2026-10-01').observations!.length, 1)
  assert.equal(service.dayPlan('2026-10-01').blocks.length, 0)
  assert.equal(service.workflowContext().lifeAreas.find((area) => area.area === 'relationships')!.observations, 1)
})

test('explicitly cancelling a generated goal session is respected by subsequent replans', async () => {
  const { service, ctx } = await fixture()
  const book = await service.upsertReading({ title: '概率论', weeklyGoal: 40 })
  await service.replan()
  const task = service.workflowContext().tasks.find((entry) => entry.learningRef === book.id)!
  ctx.reply = JSON.stringify({ summary: '撤回这次推进', taskActions: [{ taskId: task.id, action: 'cancel', evidence: '这次概率论推进不用做了' }] })
  await service.workflowRun({ text: '这次概率论推进不用做了', mode: 'review', apply: true })
  await service.replan()
  assert(!service.workflowContext().tasks.some((entry) => entry.id === task.id))
  assert.equal((service.exportAll().backlog as any)[task.id].cancelledBy, 'user')
})
