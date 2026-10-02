process.on('uncaughtException', (error) => { process.stderr.write(error.message + '\n'); process.exit(1) })
import { createServer } from 'node:http'
import { build } from 'esbuild'
import { fixture } from '../tests/helpers/host.ts'
import { DEFAULT_PERIODS } from '../src/seed.ts'

// Isolated preview: real service and native React UI; transport uses sample replies.
const { service, ctx } = await fixture()
await service.updateSettings({ periods: DEFAULT_PERIODS, dayEndPeriod: 17 })
const book = await service.upsertReading({ title: '概率论', total: 300, weeklyGoal: 40 })
await service.upsertLearning({ title: '英语听力', unit: '课时', weeklyGoal: 3 })
const paper = await service.upsertBacklog({ title: '论文第三章', estimatePeriods: 2, priority: 2, dueDate: '2026-10-02' })
await service.upsertBlock('2026-09-30', { title: paper.title, backlogId: paper.id, startPeriod: 4, endPeriod: 5 })
const bench = service.listExercises().find((exercise) => exercise.name === '杠铃卧推') ?? service.listExercises()[0]!
await service.addGymItem('2026-09-28', bench.id)
const oldGymItem = service.gymSession('2026-09-28').items[0]!
await service.logGymSet('2026-09-28', oldGymItem.id, { reps: 10, weight: 35 })
await service.logGymSet('2026-09-28', oldGymItem.id, { reps: 10, weight: 35 })
await service.finishGymSession('2026-09-28')
await service.saveDraft('2026-09-30', { text: '昨天读了概率论10页，下午开会打断了论文。', usedPrompts: [] })
await service.commitReview('2026-09-30', { summary: '阅读推进，会议占用了论文时间。', achievements: ['概率论10页'], blockers: ['会议打断'], adjustments: ['预留机动'],
  plan: [], learning: [{ ref: book.id, title: book.title, kind: 'reading', mode: 'delta', value: 10 }], energy: 3, mood: null, tags: [] }, [])
await service.replan()
// Dense, representative layout fixture: ordinary school weeks, holiday weeks, and compact training.
for (const [name, weekday, startPeriod, endPeriod, location] of [
  ['高级微观经济学',1,10,12,'主教206'],['马克思主义基本原理',2,4,6,'主教206'],['大学体育',2,10,11,'体育场'],
  ['形势与政策',3,8,9,'学术会堂'],['投资学（全英语）',4,4,6,'主教218'],['英汉应用笔译',4,8,9,'学院南路'],
  ['概率论与数理统计',4,10,12,'主教308'],['中日文化比较',4,14,15,'学院南路'],['博弈论',5,4,6,'主教212'],['数学分析原理',5,8,10,'主教218'],
] as const) await service.upsertCourse({ name, weekday, startPeriod, endPeriod, location })
await service.generateWeek('2026-W40')
await service.generateWeek('2026-W42')
for (const [title,category,startPeriod,endPeriod] of [['论文修改','study',4,5],['英语听力','study',8,9],['朋友聚餐','activity',12,13],['健身','gym',16,17]] as const) await service.upsertBlock('2026-10-01', {title,category,startPeriod,endPeriod}).catch(() => undefined)
for (const exercise of service.listExercises().filter((item)=>item.part === 'chest').slice(0,4)) await service.addGymItem('2026-10-01',exercise.id)

const client = await build({ entryPoints: ['scripts/workflow-preview-client.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic' })
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>每日计划 · 隔离预览</title><style>body{margin:0;font-family:system-ui;color:#242424;--dsw-alias-label-primary:#242424;--dsw-alias-label-secondary:#666;--dsw-alias-label-tertiary:#888;--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#fafafa;--dsw-alias-border-primary:#ddd;--dsw-alias-interactive-bg-hover:#f4f4f4;--dsw-alias-interactive-bg-active:#eaeaea}</style><div id="root"></div><script src="/client.js"></script></html>`
const server = createServer(async (request, response) => {
  if (request.url === '/client.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(client.outputFiles[0]!.text); return }
  if (request.url === '/rpc' && request.method === 'POST') {
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk)
    const { endpoint, payload } = JSON.parse(Buffer.concat(chunks).toString())
    if (endpoint === 'workflow.run') ctx.reply = JSON.stringify({ summary: '根据复盘补记已完成的论文与真实训练数据，撤回重复顺延，英语推进放在上午，保留25%机动。', focus: ['推进英语'],
      tasks: payload.text.includes('作业') ? [{ title: '数学作业', category: 'study', periods: 2, dueDate: '2026-10-02' }] : [],
      taskActions: payload.text.includes('昨天论文第三章完成了') && service.workflowContext().tasks.some((task) => task.id === paper.id)
        ? [{ taskId: paper.id, action: 'complete', date: '2026-09-30', evidence: '昨天论文第三章完成了' }] : [],
      learningLogs: payload.text.includes('今天概率论读了20页') ? [{ date: '2026-10-01', ref: book.id, title: book.title, kind: 'reading', mode: 'delta', value: 20, evidence: '今天概率论读了20页' }] : [],
      gymLogs: payload.text.includes('昨天杠铃卧推40kg做了3组每组10次，训练结束') ? [{ date: '2026-09-30', finished: true,
        evidence: '昨天杠铃卧推40kg做了3组每组10次，训练结束', exercises: [{ exerciseId: bench.id, name: bench.name, part: bench.part,
          evidence: '昨天杠铃卧推40kg做了3组每组10次', sets: Array.from({ length: 3 }, () => ({ reps: 10, weight: 40, unit: 'kg', rir: null })) }] }] : [],
      memories: payload.text.includes('以后上午学习') ? [{ text: '更喜欢上午学习', evidence: '以后上午学习' }] : [],
      questions: payload.text.includes('不知道次数') ? ['是哪一天训练？能回忆各组次数吗？不确定可以只记出勤。'] : [],
      gymAdvice: payload.text.includes('卧推') ? ['这次实记40kg共30次，上次实记35kg共20次；先观察相同组数下的表现和恢复，不直接据此增加重量。'] : [] })
    if (endpoint === 'review.structure') ctx.reply = JSON.stringify({ summary: '推进阅读，并给明天留出机动。', achievements: ['概率论阅读20页'],
      learning: [{ ref: book.id, title: book.title, kind: 'reading', mode: 'delta', value: 20 }], plan: [], energy: 3 })
    if (endpoint === 'workflow.run' && payload.mode === 'plan') ctx.reply = JSON.stringify({ summary: '把明确的活动写入日程，论文修改安排在下周，保留机动时间。',
      appointments: [
        ...(payload.text.includes('明天19:10–20:35和朋友聚餐') ? [{ date: '2026-10-02', title: '朋友聚餐', category: 'activity', lifeArea: 'relationships', startMinute: 1150, endMinute: 1235, evidence: '明天19:10–20:35和朋友聚餐' }] : []),
        ...(payload.text.includes('下周日10:00–11:00开会') ? [{ date: '2026-10-11', title: '周日会议', category: 'intern', lifeArea: 'work', startMinute: 600, endMinute: 660, evidence: '下周日10:00–11:00开会' }] : []),
      ], tasks: payload.text.includes('论文修改') ? [{ title: '下周论文修改', category: 'study', periods: 2, notBefore: '2026-10-05', dueDate: '2026-10-11' }] : [],
      questions: payload.text.includes('聚餐') && !payload.text.includes('19:10–20:35') ? ['聚餐在哪天，几点开始、几点结束？'] : [],
    })
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(await ctx.rpc(endpoint, payload, new AbortController().signal)))
    return
  }
  response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html)
})
server.listen(4178, '127.0.0.1', () => process.stdout.write('Isolated workflow preview: http://127.0.0.1:4178\n'))
