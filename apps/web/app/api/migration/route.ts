import { randomUUID } from 'node:crypto'
import { checkOrigin, failure, getOwner } from '../../../lib/auth'
import { admin, commit, loadState } from '../../../lib/db'
import { mergeBackup, migrationReport, stateChecksum, validateBackup } from '../../../generated/migration.mjs'
export async function GET(request: Request) {
  try { const user = await getOwner(request); const { state } = await loadState(user.id); return Response.json({ format: 'daily-plan-backup', schemaVersion: 1, sourceId: `cloud-${user.id}`, exportedAt: new Date().toISOString(), checksum: stateChecksum(state), state }, { headers: { 'Cache-Control': 'no-store', 'Content-Disposition': 'attachment; filename="daily-plan-cloud.backup.json"' } }) } catch (error) { return failure(error) }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request)
    const owner = await getOwner(request)
    const raw = await request.text()
    if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw new Error('备份超过 4MB，请联系维护者使用数据库直连迁移，不拆分原事务。')
    const input = JSON.parse(raw)
    const backup = validateBackup(input.backup)
    const receipt = await admin().from('planner_imports').select('report').eq('owner_id', owner.id).eq('source_id', backup.sourceId).eq('checksum', backup.checksum).maybeSingle()
    if (receipt.error) throw new Error('无法核验迁移状态，请确认数据库迁移已执行')
    if (receipt.data) return Response.json({ ok: true, value: { ...receipt.data.report, alreadyImported: true } })
    const { state, revision } = await loadState(owner.id)
    const next = mergeBackup(state, backup)
    const report = { ...migrationReport(next), sourceId: backup.sourceId, checksum: backup.checksum, account: owner.email }
    if (input.preview !== false) return Response.json({ ok: true, value: report })
    const result = await commit(owner.id, next, revision, randomUUID(), { ok: true, value: report }, { sourceId: backup.sourceId, checksum: backup.checksum, report })
    return Response.json({ ...result.response, revision: result.revision })
  } catch (error) { return failure(error) }
}
