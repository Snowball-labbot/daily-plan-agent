import { randomUUID } from 'node:crypto'
import { checkOrigin, failure, getOwner } from '../../../lib/auth'
import { perform, uuid } from '../../../lib/operations'
import { attachActiveJob, beginJob, cancelJob, jobStatus } from '../../../lib/jobs'
import { loadState } from '../../../lib/db'
export const maxDuration = 300
export async function POST(request: Request) {
  try {
    checkOrigin(request)
    const owner = await getOwner(request)
    const body = await request.text()
    if (body.length > 100000) throw new Error('请求过大，请减少描述')
    const { endpoint, payload = {}, operationId, expectedRevision } = JSON.parse(body)
    if (typeof endpoint !== 'string' || !payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('无效的请求')
    let result: any
    if (endpoint === 'workflow.start') result = { response: { ok: true, value: await beginJob(owner.id, payload) }, revision: (await loadState(owner.id)).revision }
    else if (endpoint === 'workflow.status') result = await jobStatus(owner.id, payload.id)
    else if (endpoint === 'workflow.cancel') result = await cancelJob(owner.id, payload.id)
    else result = await perform(owner.id, endpoint, payload, uuid(operationId) ? operationId : randomUUID(), typeof expectedRevision === 'number' ? expectedRevision : undefined)
    if(result.response.ok && ['snapshot','workflow.context'].includes(endpoint)) await attachActiveJob(owner.id,result.response.value,endpoint)
    return Response.json({ ...result.response, revision: result.revision }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return failure(error) }
}
