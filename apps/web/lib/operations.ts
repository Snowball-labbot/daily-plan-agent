import { createEngine } from '../generated/engine.mjs'
import { commit, loadState, previousOperation } from './db'
import { modelGateway } from './agnes'
const reads = new Set(['snapshot','workflow.context','workflow.history','plan.day','plan.snap-gap','courses.list','courses.parse-paste','backlog.list','gym.exercises','gym.session','gym.performance','gym.focus.suggest','review.get','review.history','stats.range','stats.summary','stats.day','reading.list','learning.list','learn.week-stats','learn.streak','settings.get','settings.agnes.check','export.json'])
export const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
export async function perform(owner: string, endpoint: string, payload: any, operationId: string, expected?: number) {
  if (['workflow.run','workflow.start','workflow.status','workflow.cancel','import.json'].includes(endpoint)) throw new Error('请使用专用的后台任务或迁移入口')
  const read = reads.has(endpoint)
  if (!read) { const previous = await previousOperation(owner, operationId); if (previous) return previous }
  const { state, revision } = await loadState(owner)
  if (!read && expected !== undefined && expected !== revision) throw Object.assign(new Error('其他设备已修改数据，请先刷新；你的微调仍然保留。'), { status: 409 })
  const engine = await createEngine(state, modelGateway)
  try {
    const response = await engine.call(endpoint, payload)
    if (!response.ok || read) return { response, revision }
    return await commit(owner, engine.state, revision, operationId, response)
  } finally { await engine.close() }
}
