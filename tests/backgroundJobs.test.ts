import assert from 'node:assert/strict'
import test from 'node:test'
import { fixture } from './helpers/host.ts'

test('start persists a job before returning; status and repeat application recover without duplicates',async()=>{
  const {service,ctx} = await fixture()
  ctx.reply = JSON.stringify({summary:'安排英语',tasks:[{title:'英语',category:'study',periods:1}]})
  const input = {mode:'review' as const,text:'帮我安排英语',apply:false,clientRequestId:'47e23fda-7d99-4e8a-825a-c2cc474f6836'}
  const started = await service.workflowStart(input)
  assert(service.workflowStatus(started.id).run)
  const duplicate = await service.workflowStart(input)
  assert.equal(duplicate.id,started.id)
  for(let attempt=0;attempt<50 && service.workflowStatus(started.id).run.status==='running';attempt++) await new Promise(resolve=>setTimeout(resolve,5))
  assert.equal(service.workflowStatus(started.id).phase,'ready')
  await service.workflowApply(started.id)
  const once = service.exportAll().backlog
  await service.workflowApply(started.id)
  assert.deepEqual(service.exportAll().backlog,once)
  assert.equal(service.workflowStatus(started.id).phase,'applied')
  assert.equal(ctx.prompts.length,1)
})
test('snapshot reads do not wait for a queued preparation operation',async()=>{
  const {service,ctx} = await fixture()
  let resolve!: () => void
  ;(service as any).prepareToday = ()=>new Promise<void>(done=>{resolve=done})
  const result = await Promise.race([ctx.rpc('snapshot',{},new AbortController().signal),new Promise(resolve=>setTimeout(()=>resolve('blocked'),100))])
  assert.notEqual(result,'blocked')
  resolve()
})
