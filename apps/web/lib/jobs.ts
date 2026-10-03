import { randomUUID } from 'node:crypto'
import { start } from 'workflow/api'
import { admin, config, loadState } from './db'
import { uuid } from './operations'
import { plannerWorkflow } from '../workflows/planner'
export async function beginJob(owner: string, input: any) {
  config('AGNES_API_KEY')
  if (!['review','plan','weekly','replan'].includes(input.mode) || typeof input.text !== 'string' || input.text.length > 30000) throw new Error('请输入有效的复盘或安排')
  const id = uuid(input.clientRequestId) ? input.clientRequestId : randomUUID()
  const db = admin()
  const previous = await db.from('planner_jobs').select('owner_id,phase,workflow_id').eq('id', id).maybeSingle()
  if (previous.error) throw new Error('后台任务尚未初始化，请执行数据库迁移。')
  if (previous.data) { if (previous.data.owner_id !== owner) throw new Error('任务编号冲突'); return { id } }
  const stamp = new Date().toISOString()
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
  const day = new Date(`${input.planStart ?? date}T00:00:00Z`)
  day.setUTCDate(day.getUTCDate()+4-(day.getUTCDay()||7))
  const year=day.getUTCFullYear(),week=Math.ceil(((day.getTime()-Date.UTC(year,0,1))/86400000+1)/7)
  const run = { id, date, weekKey: input.weekKey ?? `${year}-W${String(week).padStart(2,'0')}`, mode: input.mode, rawText: input.text, status: 'running', phase: 'generating', createdAt: stamp, updatedAt: stamp, draft: null, error: null }
  const inserted = await db.from('planner_jobs').insert({ id, owner_id: owner, request: input, run, phase: 'generating' })
  if (inserted.error) throw new Error('无法创建后台任务，请重试。')
  try {
    const workflow = await start(plannerWorkflow, [id, owner])
    await db.from('planner_jobs').update({ workflow_id: workflow.runId }).eq('id', id).eq('owner_id', owner)
  } catch {
    await db.from('planner_jobs').update({ phase: 'failed', error: '后台任务未能启动，原文已保留。' }).eq('id', id).eq('owner_id', owner)
    throw new Error('后台任务未能启动，请重新整理。')
  }
  return { id }
}
export async function attachActiveJob(owner: string, value: any, endpoint: string) {
  const context=endpoint==='snapshot'?value.workflow:value
  if(!context?.weekKey)return value
  const {data}=await admin().from('planner_jobs').select('run,phase').eq('owner_id',owner).in('phase',['generating','applying']).order('created_at',{ascending:false}).limit(8)
  const latest=data?.find(row=>row.run.weekKey===context.weekKey)
  if(latest && (!context.latestConversation || latest.run.updatedAt>=context.latestConversation.updatedAt)) context.latestConversation=latest.run
  return value
}
export async function jobStatus(owner: string, id: string) {
  const { data, error } = await admin().from('planner_jobs').select('*').eq('id', id).eq('owner_id', owner).maybeSingle()
  if (error || !data) throw new Error('找不到这一份安排')
  const { state, revision } = await loadState(owner)
  let run = state.tables.workflow_runs[id] ?? data.run
  if (run.status !== 'applied' && (data.phase === 'failed' || data.phase === 'cancelled')) run = { ...run, status: 'failed', phase: data.phase, error: data.error ?? '已停止整理，原文已保留。' }
  else if (run.status !== 'applied' && data.error) run = { ...run, error: data.error }
  return { response: { ok: true, value: { run, phase: run.status === 'applied' ? 'applied' : data.phase, allocation: null } }, revision }
}
export async function cancelJob(owner: string, id: string) {
  const { error } = await admin().from('planner_jobs').update({ phase: 'cancelled', error: '已停止整理，原文已保留。', updated_at: new Date().toISOString() }).eq('owner_id', owner).eq('id', id).in('phase', ['queued','generating'])
  if (error) throw new Error('无法停止任务，请恢复安排查看状态。')
  return jobStatus(owner, id)
}
