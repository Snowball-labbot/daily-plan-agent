import test from 'node:test'
import assert from 'node:assert/strict'
import { CloudBridge } from '../src/cloudBridge.ts'

test('desktop cloud tools use the web RPC contract and stop on network failure',async()=>{
  const bridge=new CloudBridge({todayIso:()=> '2026-10-02'} as never)
  // Inject a test session; never read or write the actual encrypted account file.
  ;(bridge as any).session={base:'https://planner.example.invalid',owner:'fixture',accessToken:'test-only',refreshToken:'test-only',expiresAt:Date.now()/1000+3600}
  const previous=globalThis.fetch
  const bodies:any[]=[]
  globalThis.fetch=async(_input,options)=>{
    const body=JSON.parse(String(options?.body));bodies.push(body)
    return Response.json({ok:true,value:{id:'test-record'},revision:bodies.length})
  }
  try {
    await bridge.tool('daily_plan_backlog',{title:'论文',estimate_periods:3},new AbortController().signal)
    assert.equal(bodies[0].endpoint,'snapshot')
    assert.deepEqual(bodies[1].payload,{item:{title:'论文',category:'study',estimatePeriods:3,dueDate:null}})
    assert.equal(bodies[1].expectedRevision,1)
    await bridge.tool('daily_plan_schedule',{date:'2026-10-02',title:'会议',start_period:4,end_period:5},new AbortController().signal)
    assert.equal(bodies[2].payload.block.title,'会议')
    assert.equal(bodies[2].expectedRevision,2)
    globalThis.fetch=async()=>{throw new TypeError('offline')}
    await assert.rejects(bridge.tool('daily_plan_backlog',{title:'离线任务'},new AbortController().signal),/offline/)
    assert.equal(bridge.enabled,true)
  }finally{globalThis.fetch=previous}
})
