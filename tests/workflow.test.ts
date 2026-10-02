import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture } from './helpers/host.ts'

test('scheduling and completion have separate states and removing a block restores the task', async () => {
  const { service } = await fixture()
  const task = await service.upsertBacklog({ title: '写论文', estimatePeriods: 2 })
  const result = await service.replan()
  assert.equal(result.scheduled.length, 1); assert.equal(service.listBacklog().length, 0)
  const block = service.dayPlan('2026-10-01').blocks[0]!
  assert.equal(block.done, false)
  await service.toggleBlock('2026-10-01', block.id, true)
  assert.equal((service.exportAll().backlog as any)[task.id].state, 'completed')
  await service.toggleBlock('2026-10-01', block.id, false)
  await service.removeBlock('2026-10-01', block.id)
  assert.equal(service.listBacklog()[0]?.state, 'queued')
})

test('a missed day followed by a full day carries to real capacity without duplicate tasks', async () => {
  const { service } = await fixture()
  await service.upsertBlock('2026-09-30', { title: '未完成论文', startPeriod: 1, endPeriod: 3 })
  await service.upsertBlock('2026-10-01', { title: '会议', startPeriod: 1, endPeriod: 8 })
  const first = await service.replan()
  assert.equal(first.scheduled[0]?.date, '2026-10-02')
  const past = service.dayPlan('2026-09-30').blocks[0]!
  assert.equal(past.disposition, 'deferred'); assert.equal(past.done, false)
  await service.replan()
  const copies = Array.from({ length: 7 }, (_, i) => service.dayPlan(`2026-10-0${i + 1}`)).flatMap((day) => day.blocks).filter((block) => block.title === '未完成论文')
  assert.equal(copies.length, 1); assert.equal(copies[0]!.endPeriod - copies[0]!.startPeriod + 1, 3)
})

test('a task reserved outside the rolling horizon is not scheduled a second time', async () => {
  const { service } = await fixture()
  const task = await service.upsertBacklog({ title: '后周汇报' })
  await service.upsertBlock('2026-10-15', { title: task.title, backlogId: task.id, startPeriod: 1, endPeriod: 2 })
  assert.equal((await service.replan()).scheduled.length, 0)
})

test('linked study blocks do not invent progress and review confirmation is idempotent', async () => {
  const { service } = await fixture()
  const book = await service.upsertReading({ title: '概率论', weeklyGoal: 40, total: 300 })
  await service.replan()
  const block = service.dayPlan('2026-10-01').blocks.find((entry) => entry.learningRef === book.id)!
  assert(block)
  await service.toggleBlock('2026-10-01', block.id, true)
  assert.equal(service.listReading()[0]!.progress, 0)
  await service.saveDraft('2026-10-01', { text: '今天读了概率论40页。', usedPrompts: [] })
  const structured: any = { summary: '推进阅读', learning: [{ ref: book.id, title: book.title, kind: 'reading', mode: 'delta', value: 40 }] }
  await service.commitReview('2026-10-01', structured, [])
  await service.commitReview('2026-10-01', structured, [])
  assert.equal(service.listReading()[0]!.progress, 40)
  assert.equal(service.listReading()[0]!.log.length, 1)
  assert.equal(service.workflowContext().learning.reading[0]!.gain, 40)
})

test('reopening an older learning entry does not roll the current counter backwards', async () => {
  const { service } = await fixture()
  const book = await service.upsertReading({ title: '经济学' })
  await service.setReadingProgress(book.id, 120, '2026-10-01')
  await service.setReadingProgress(book.id, 50, '2026-09-29')
  assert.equal(service.listReading()[0]!.progress, 120)
})

test('natural-language planning applies once and records only directly evidenced memories', async () => {
  const { service, ctx } = await fixture()
  ctx.reply = JSON.stringify({ summary: '先处理作业', tasks: [{ title: '数学作业', category: 'study', periods: 2 }],
    memories: [{ text: '上午学习', evidence: '上午适合学习' }, { text: '喜欢夜跑', evidence: '不存在的证据' }] })
  const result = await service.workflowRun({ text: '上午适合学习，帮我安排数学作业。', mode: 'plan', apply: true })
  assert.equal(result.run.status, 'applied'); assert.equal(service.memories().length, 1)
  const again = await service.workflowApply(result.run.id)
  assert.equal(again.allocation, null)
  assert.equal(service.dayPlan('2026-10-01').blocks.filter((block) => block.title === '数学作业').length, 1)
  assert.match(ctx.prompts[0], /previousLearning/); assert.match(ctx.prompts[0], /recentReviews/)
  const memory = service.memories()[0]!
  await service.removeMemory(memory.id)
  await service.workflowRun({ text: '上午适合学习，帮我安排数学作业。', mode: 'plan', apply: true })
  assert.equal(service.memories().length, 0)
})

test('a temporary unavailable window displaces provisional work without losing it', async () => {
  const { service, ctx } = await fixture()
  await service.upsertBacklog({ title: '英语', estimatePeriods: 2 })
  await service.replan()
  ctx.reply = JSON.stringify({ summary: '挪开英语', unavailable: [{ date: '2026-10-01', startPeriod: 1, endPeriod: 4, reason: '临时会议' }] })
  await service.workflowRun({ text: '今天上午临时有会议，帮我调整。', mode: 'replan', apply: true })
  const blocks = service.dayPlan('2026-10-01').blocks
  assert(blocks.some((block) => block.title === '临时会议'))
  assert(blocks.filter((block) => block.adaptive).every((block) => block.startPeriod >= 5))
})

test('invalid references are rejected before tasks, memory or plan changes are written', async () => {
  const { service, ctx } = await fixture()
  ctx.reply = JSON.stringify({ summary: '无效引用', tasks: [{ title: '书籍', category: 'study', learningRef: 'missing', learningKind: 'reading' }] })
  await assert.rejects(service.workflowRun({ text: '安排读书', mode: 'plan', apply: true }), /不存在/)
  assert.equal(service.listBacklog().length, 0)
})

test('API failure retains the original input and the offline scheduler still works', async () => {
  const { service, ctx } = await fixture()
  ctx.failAI = true
  const result = await service.workflowRun({ text: '最近有点累，想先做好英语。', mode: 'plan', apply: true })
  assert.equal(result.run.status, 'failed'); assert.equal(service.workflowHistory()[0]!.rawText, '最近有点累，想先做好英语。')
  await service.upsertBacklog({ title: '英语' })
  assert.equal((await service.replan()).scheduled.length, 1)
})

test('editing review prose invalidates the previous AI result', async () => {
  const { service, ctx } = await fixture()
  await service.saveDraft('2026-10-01', { text: '做了五道题', usedPrompts: [] })
  ctx.reply = JSON.stringify({ summary: '完成练习' })
  await service.structure('2026-10-01')
  await service.saveDraft('2026-10-01', { text: '改成做了十道题', usedPrompts: [] })
  assert.equal(service.review('2026-10-01')!.status, 'draft'); assert.equal(service.review('2026-10-01')!.structured, null)
})

test('new workflow data survives export/import and legacy settings get defaults', async () => {
  const { service } = await fixture()
  await service.workflowRun({ text: '这周推进英语', mode: 'plan', apply: true })
  const exported = service.exportAll()
  const other = await fixture()
  await other.service.importAll(exported, 'replace')
  assert.equal(other.service.workflowHistory().length, 1)
  await other.service.importAll({ settings: { termStart: '2026-09-01' } }, 'merge')
  assert.equal(other.service.settings().planning.bufferRatio, 0.25)
})

test('concurrent replans serialize and keep exactly one assignment per task', async () => {
  const { service } = await fixture()
  await service.upsertBacklog({ title: '英语' })
  await Promise.all([service.replan(), service.replan(), service.replan()])
  assert.equal(service.dayPlan('2026-10-01').blocks.filter((block) => block.title === '英语').length, 1)
})

test('host timezone cannot shift Shanghai today or the current minute', async () => {
  const { service } = await fixture()
  ;(service as any).now = () => new Date('2026-09-30T16:05:00Z')
  assert.equal(service.todayIso(), '2026-10-01'); assert.equal(service.currentMinute(), 5)
})

test('reaching a learning goal retires unnecessary provisional sessions', async () => {
  const { service } = await fixture()
  const book = await service.upsertReading({ title: '历史', weeklyGoal: 30 })
  await service.replan()
  assert(service.dayPlan('2026-10-01').blocks.some((block) => block.learningRef === book.id))
  await service.setReadingProgress(book.id, 30, '2026-10-01')
  await service.replan()
  assert.equal(service.dayPlan('2026-10-01').blocks.filter((block) => block.learningRef === book.id).length, 0)
  assert.equal(service.listBacklog().filter((task) => task.learningRef === book.id).length, 0)
})

test('missed gym plans move their action list into a day with capacity', async () => {
  const { service } = await fixture()
  const exercise = service.listExercises()[0]!
  await service.setGymFocus('2026-09-30', [exercise.part])
  await service.addGymItem('2026-09-30', exercise.id)
  const task = await service.queueGymSession('2026-09-30')
  await service.upsertBlock('2026-09-30', { title: task.title, category: 'gym', backlogId: task.id, startPeriod: 1, endPeriod: 2 })
  await service.upsertBlock('2026-10-01', { title: '全天活动', category: 'activity', startPeriod: 1, endPeriod: 8 })
  const result = await service.replan()
  assert.equal(result.scheduled[0]?.date, '2026-10-02')
  assert.equal(service.gymSession('2026-10-02').items[0]?.exerciseId, exercise.id)
  assert.equal(service.gymSession('2026-09-30').items.length, 0)
  const block = service.dayPlan('2026-10-02').blocks.find((block) => block.category === 'gym')!
  assert.equal(block.gymDate, '2026-10-02')
  await service.finishGymSession('2026-10-02')
  assert.equal((service.exportAll().backlog as any)[task.id].state, 'completed')
})

test('a completed workout is never overwritten when a different workout moves', async () => {
  const { service } = await fixture()
  const exercise = service.listExercises()[0]!
  await service.addGymItem('2026-10-01', exercise.id)
  await service.addGymItem('2026-10-02', exercise.id)
  await service.finishGymSession('2026-10-02')
  const task = await service.queueGymSession('2026-10-01')
  await assert.rejects(service.upsertBlock('2026-10-02', { title: '训练', category: 'gym', backlogId: task.id, startPeriod: 1, endPeriod: 2 }), /不能覆盖/)
  assert.equal(service.gymSession('2026-10-01').items.length, 1)
  assert.equal(service.gymSession('2026-10-02').items.length, 1)
})

test('weekly fitness goals honor rest days and build editable uncompleted templates', async () => {
  const { service } = await fixture()
  await service.updateSettings({ planning: { gymWeeklyGoal: 2 }, gymRestDays: [4] })
  const result = await service.replan()
  const gyms = result.days.flatMap((day) => day.blocks.filter((block) => block.category === 'gym').map((block) => ({ date: day.date, block })))
  assert.equal(gyms.length, 2)
  assert(gyms.every((entry) => entry.date !== '2026-10-01'))
  assert(gyms.every((entry) => service.gymSession(entry.date).items.length > 0 && service.gymSession(entry.date).finishedAt === null))
})

test('explicit replanning can release an unstarted manual block around a disruption', async () => {
  const { service, ctx } = await fixture()
  await service.upsertBlock('2026-10-01', { title: '手动安排的学习', startPeriod: 2, endPeriod: 3 })
  const old = service.dayPlan('2026-10-01').blocks[0]!
  ctx.reply = JSON.stringify({ summary: '把学习挪开', rescheduleBlockIds: [old.id], unavailable: [{ date: '2026-10-01', startPeriod: 2, endPeriod: 3, reason: '临时会议' }] })
  const result = await service.workflowRun({ text: '上午临时有会议，把学习调整一下。', mode: 'replan', apply: true })
  assert.equal(result.run.status, 'applied')
  const blocks = service.dayPlan('2026-10-01').blocks
  assert.equal(blocks.find((block) => block.id === old.id)?.disposition, 'deferred')
  assert(blocks.some((block) => block.title === old.title && block.adaptive && block.startPeriod !== 2))
})

test('a model cannot release a timetable block or a completed task', async () => {
  const { service, ctx } = await fixture()
  await service.upsertBlock('2026-10-01', { title: '已经做完', startPeriod: 2, endPeriod: 3 })
  const block = service.dayPlan('2026-10-01').blocks[0]!
  await service.toggleBlock('2026-10-01', block.id, true)
  ctx.reply = JSON.stringify({ summary: '试图重新安排', rescheduleBlockIds: [block.id] })
  await assert.rejects(service.workflowRun({ text: '调整一下', mode: 'replan', apply: true }), /不能重排/)
  assert.equal(service.dayPlan('2026-10-01').blocks[0]!.done, true)
})

test('evidenced personal preferences change actual scheduling, not just the prose', async () => {
  const { service, ctx } = await fixture()
  ctx.reply = JSON.stringify({ summary: '按你的偏好减少负担', planningPatch: { preferredStudyPeriod: 5, dailyFocusMinutes: 90 }, planningEvidence: '以后从第五节开始学习，每天最多90分钟',
    tasks: [{ title: '学习任务', category: 'study', periods: 2, earliestPeriod: 5, latestPeriod: 8 }] })
  await service.workflowRun({ text: '以后从第五节开始学习，每天最多90分钟，安排学习任务。', mode: 'plan', apply: true })
  assert.equal(service.settings().planning.dailyFocusMinutes, 90)
  assert.equal(service.dayPlan('2026-10-01').blocks[0]!.startPeriod, 5)
})

test('progress episodes aggregate once and ambiguous titles produce visible warnings', async () => {
  const { service } = await fixture()
  const book = await service.upsertReading({ title: '经济学上册' })
  await service.upsertReading({ title: '经济学下册' })
  await service.saveDraft('2026-10-01', { text: '上午10页，晚上20页', usedPrompts: [] })
  const structured: any = { summary: '阅读', learning: [
    { ref: book.id, title: book.title, kind: 'reading', mode: 'delta', value: 10 },
    { ref: book.id, title: book.title, kind: 'reading', mode: 'delta', value: 20 },
    { ref: null, title: '经济学', kind: 'reading', mode: 'delta', value: 40 },
  ] }
  const result = await service.commitReview('2026-10-01', structured, [])
  assert.equal(service.listReading().find((item) => item.id === book.id)!.progress, 30)
  assert.equal(result.review.applyWarnings!.length, 1)
  await service.commitReview('2026-10-01', structured, [])
  assert.equal(service.listReading().find((item) => item.id === book.id)!.progress, 30)
})

test('a completed prior-week review carries its focus into the new week', async () => {
  const { service, ctx } = await fixture()
  ctx.reply = JSON.stringify({ summary: '上周负担过重，这周聚焦英语', focus: ['推进英语'] })
  await service.workflowRun({ text: '', mode: 'weekly', weekKey: '2026-W39', apply: true })
  assert.equal(service.dayPlan('2026-10-01').focus, '推进英语')
})

test('RPC rejects malformed workflow input and supports a complete archive without carry-over items', async () => {
  const { service, ctx } = await fixture()
  assert.equal((await ctx.rpc('workflow.run', { mode: 'invalid' }, new AbortController().signal)).ok, false)
  await service.saveDraft('2026-10-01', { text: '今天做得不错', usedPrompts: [] })
  const result = await ctx.rpc('review.commit', { date: '2026-10-01', structured: { summary: '完成记录' }, carryOver: [] }, new AbortController().signal)
  assert.equal(result.ok, true); assert.equal(service.review('2026-10-01')!.status, 'structured')
})
