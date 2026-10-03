import { createHash } from 'node:crypto'
import { createEngine } from '../generated/engine.mjs'
import { admin, commit, loadState } from '../lib/db'
import { modelGateway } from '../lib/agnes'
import { perform } from '../lib/operations'

async function generate(id: string, owner: string) {
  'use step'
  const db = admin()
  const { data: job, error } = await db.from('planner_jobs').select('*').eq('id', id).eq('owner_id', owner).single()
  if (error) throw new Error('无法读取任务')
  if (job.phase !== 'generating') return false
  const { state } = await loadState(owner)
  let result: any = state.tables.workflow_runs[id] ? { run: state.tables.workflow_runs[id], allocation: null } : null
  if (!result) {
    const engine = await createEngine(state, modelGateway)
    try { result = await engine.service.workflowRun({ ...job.request, apply: false, runId: id }) } finally { await engine.close() }
  }
  const current = await db.from('planner_jobs').select('phase').eq('id', id).eq('owner_id', owner).single()
  if (current.data?.phase === 'cancelled') return false
  if (result.run.status === 'failed') {
    await db.from('planner_jobs').update({ phase: 'failed', run: result.run, error: result.run.error }).eq('id', id).eq('owner_id', owner)
    return false
  }
  for (let attempt = 0; attempt < 4; attempt++) {
    const fresh = await loadState(owner)
    fresh.state.tables.workflow_runs[id] = result.run
    try { await commit(owner, fresh.state, fresh.revision, id, { ok: true, value: result }); break }
    catch (error: any) { if (error.status !== 409 || attempt === 3) throw error }
  }
  const next = job.request.apply ? 'applying' : 'ready'
  const updated = await db.from('planner_jobs').update({ phase: next, run: result.run, updated_at: new Date().toISOString() }).eq('id', id).eq('owner_id', owner).eq('phase', 'generating').select('id')
  return !!job.request.apply && !!updated.data?.length
}
async function apply(id: string, owner: string) {
  'use step'
  const { data } = await admin().from('planner_jobs').select('phase,request').eq('id', id).eq('owner_id', owner).single()
  if (data?.phase !== 'applying') return
  const fresh = await loadState(owner)
  const hash = createHash('sha256').update(`apply:${id}`).digest('hex')
  const operation = `${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`
  const result = await perform(owner, 'workflow.apply', { id, replaceConflicts: data.request.replaceConflicts }, operation, fresh.revision)
  const phase = result.response.ok ? 'applied' : 'ready'
  await admin().from('planner_jobs').update({ phase, error: result.response.error?.message ?? null, updated_at: new Date().toISOString() }).eq('id', id).eq('owner_id', owner)
}
async function failed(id: string, owner: string) {
  'use step'
  const { state } = await loadState(owner)
  if (state.tables.workflow_runs[id]?.status === 'applied') { await admin().from('planner_jobs').update({ phase:'applied', error:null }).eq('id',id).eq('owner_id',owner); return }
  await admin().from('planner_jobs').update({ phase: 'failed', error: '后台处理未完成。原文与已生成建议保留，请恢复安排。' }).eq('id', id).eq('owner_id', owner).neq('phase', 'cancelled')
}
export async function plannerWorkflow(id: string, owner: string) {
  'use workflow'
  try { if (await generate(id, owner)) await apply(id, owner) } catch { await failed(id, owner) }
}
