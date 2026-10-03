import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyState, mergeBackup, migrationReport, stateChecksum, validateBackup, type PlanBackup } from '../src/migration.ts'
import { fixture } from './helpers/host.ts'

async function sample(): Promise<PlanBackup> {
  const { service } = await fixture()
  const task = await service.upsertBacklog({ title:'待写论文', estimatePeriods:2 })
  await service.upsertBlock('2026-10-01',{title:task.title,startPeriod:1,endPeriod:2,backlogId:task.id})
  await service.addGymItem('2026-10-01',service.listExercises()[0]!.id)
  const item = service.gymSession('2026-10-01').items[0]!
  await service.logGymSet('2026-10-01',item.id,{weight:40,reps:10},'once')
  const dump = service.exportAll()
  const state = emptyState()
  state.settings = dump.settings as Record<string,unknown>
  for (const name of Object.keys(state.tables) as (keyof typeof state.tables)[]) state.tables[name] = dump[name] as any
  return {format:'daily-plan-backup',schemaVersion:1,sourceId:'native-test',exportedAt:new Date().toISOString(),checksum:stateChecksum(state),state}
}
test('migration preserves IDs, associations and actual sets; repeating the same backup is idempotent',async()=>{
  const backup = await sample()
  const imported = mergeBackup(emptyState(),backup)
  assert.deepEqual(imported,backup.state)
  assert.equal(stateChecksum(mergeBackup(imported,backup)),backup.checksum)
  assert.equal(migrationReport(imported).actualSets,1)
  assert.deepEqual(migrationReport(imported).warnings,[])
  assert.deepEqual(imported.tables.plans,backup.state.tables.plans)
})
test('checksum or conflicting cloud changes leave the target entirely unchanged',async()=>{
  const backup = await sample()
  const edited = structuredClone(backup)
  const task = Object.values(edited.state.tables.backlog)[0]!
  task.title = '被修改的内容'
  assert.throws(()=>validateBackup(edited),/校验值/)
  const cloud = mergeBackup(emptyState(),backup)
  Object.values(cloud.tables.backlog)[0]!.title = '手机上改过的论文'
  const before = structuredClone(cloud)
  assert.throws(()=>mergeBackup(cloud,backup),/冲突/)
  assert.deepEqual(cloud,before)
})
test('planned weights and completion dots do not turn into actual training during migration',async()=>{
  const backup = await sample()
  const item = Object.values(backup.state.tables.gym_sessions)[0]!.items[0]
  delete item.actualSets
  item.doneSets = 3; item.weight = '80'
  backup.checksum = stateChecksum(backup.state)
  assert.equal(migrationReport(mergeBackup(emptyState(),backup)).actualSets,0)
})
