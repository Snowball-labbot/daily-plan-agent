import test from 'node:test'
import assert from 'node:assert/strict'
import { fixture } from './helpers/host.ts'
import { personalSignals } from '../src/adaptive.ts'

test('checked partial work retains its outcome note and does not finish the linked goal',async()=>{
  const {service,ctx,stores}=await fixture()
  const task=await service.upsertBacklog({title:'论文第三章',estimatePeriods:2})
  const day=await service.upsertBlock('2026-09-30',{title:task.title,backlogId:task.id,startPeriod:1,endPeriod:2})
  const block=day.blocks[0]!
  const saved=await service.feedbackBlock(day.date,block.id,{done:true,progress:60,note:'写完模型部分，结果分析还没写'})
  assert.equal(saved.blocks[0]!.done,true);assert.equal(saved.blocks[0]!.executionStatus,'partial')
  assert.equal(stores.get('backlog')!.get(task.id).done,false)
  assert.equal(personalSignals([saved],[],'2026-10-01').completionRate,0.6)
  const context=service.workflowContext()
  assert.equal(context.recentDays.find(row=>row.date===day.date)!.blocks[0]!.executionNote,'写完模型部分，结果分析还没写')
  await service.workflowRun({text:'帮我复盘',mode:'review',apply:false})
  const prompt=ctx.prompts[0]
  assert.match(prompt,/结果分析还没写/);assert.match(prompt,/目标尚未全部完成/)
  await service.saveDraft(day.date,{text:'回顾今天的论文进度',usedPrompts:[]})
  ctx.reply=JSON.stringify({summary:'论文目标完成60%，继续结果分析'})
  await service.structure(day.date,true)
  assert.match(ctx.prompts.at(-1),/结果分析还没写/)
  assert.match(ctx.prompts.at(-1),/"progress":60/)
  await service.toggleBlock(day.date,block.id,false);await service.toggleBlock(day.date,block.id,true)
  assert.equal(service.dayPlan(day.date).blocks[0]!.completionProgress,60)
  await service.upsertBlock(day.date,{id:block.id,title:'修改后的论文标题',startPeriod:1,endPeriod:2})
  assert.equal(service.dayPlan(day.date).blocks[0]!.executionNote,'写完模型部分，结果分析还没写')
  await service.feedbackBlock(day.date,block.id,{done:true,progress:100,note:'结果分析也补齐了'})
  assert.equal(stores.get('backlog')!.get(task.id).done,true)
})

test('invalid progress, missing task and future outcome cannot create execution facts',async()=>{
  const {service}=await fixture()
  const day=await service.upsertBlock('2026-10-01',{title:'学习',startPeriod:1,endPeriod:1})
  const before=JSON.stringify(service.dayPlan(day.date))
  await assert.rejects(service.feedbackBlock(day.date,day.blocks[0]!.id,{note:'测试',progress:101}),/0–100/)
  await assert.rejects(service.feedbackBlock(day.date,'missing',{note:'测试',progress:60}),/找不到/)
  await assert.rejects(service.feedbackBlock('2026-10-02',day.blocks[0]!.id,{note:'测试',progress:60}),/今天或过去/)
  assert.equal(JSON.stringify(service.dayPlan(day.date)),before)
})
