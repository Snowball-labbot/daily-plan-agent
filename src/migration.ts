import { createHash } from 'node:crypto'
import { dailyPlanDomainSpec, SettingsSchema } from './domain.ts'

export type TableName = keyof typeof dailyPlanDomainSpec.tables
export interface PortableState { settings: Record<string, unknown>; tables: Record<TableName, Record<string, any>> }
export interface PlanBackup { format: 'daily-plan-backup'; schemaVersion: 1; sourceId: string; exportedAt: string; checksum: string; state: PortableState }
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value !== null && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as any)[key])}`).join(',')}}`
  return JSON.stringify(value)
}
export function stateChecksum(state: PortableState): string { return createHash('sha256').update(stableJson(state)).digest('hex') }
export function emptyState(): PortableState { return { settings: {}, tables: Object.fromEntries(Object.keys(dailyPlanDomainSpec.tables).map((name) => [name, {}])) as PortableState['tables'] } }
export function validateState(state: PortableState): void {
  SettingsSchema.parse(state.settings)
  for (const [name, spec] of Object.entries(dailyPlanDomainSpec.tables)) {
    const rows = state.tables[name as TableName]
    if (!rows || Array.isArray(rows) || typeof rows !== 'object') throw new Error(`备份缺少表 ${name}`)
    for (const [key, value] of Object.entries(rows)) {
      if (!key || key.length > 240 || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('无效的记录编号')
      spec.valueSchema.parse(value)
    }
  }
}
export function validateBackup(value: unknown): PlanBackup {
  const backup = value as PlanBackup
  if (!backup || backup.format !== 'daily-plan-backup' || backup.schemaVersion !== 1 || typeof backup.sourceId !== 'string' || !backup.sourceId || typeof backup.exportedAt !== 'string') throw new Error('不是有效的计划备份')
  validateState(backup.state)
  if (stateChecksum(backup.state) !== backup.checksum) throw new Error('备份校验值不匹配，文件可能不完整')
  return backup
}
export function migrationReport(state: PortableState) {
  const counts = Object.fromEntries(Object.entries(state.tables).map(([name, records]) => [name, Object.keys(records).length]))
  const warnings: string[] = []
  for (const day of Object.values(state.tables.plans)) for (const block of day.blocks ?? []) {
    if (block.backlogId && !state.tables.backlog[block.backlogId]) warnings.push(`${day.date}「${block.title}」引用的任务已不在任务池；保留原记录。`)
  }
  for (const session of Object.values(state.tables.gym_sessions)) for (const item of session.items ?? []) {
    if (item.exerciseId && !state.tables.exercises[item.exerciseId]) warnings.push(`${session.date}「${item.name}」的动作库引用已不存在；保留实际训练。`)
  }
  return { counts, total: Object.values(counts).reduce((sum, count) => sum + count, 0), warnings,
    actualSets: Object.values(state.tables.gym_sessions).reduce((sum, session) => sum + (session.items ?? []).reduce((n: number, item: any) => n + (item.actualSets?.length ?? 0), 0), 0) }
}
/** Import remains all-or-nothing; a changed record must never overwrite cloud edits. */
export function mergeBackup(current: PortableState, backup: PlanBackup): PortableState {
  validateBackup(backup)
  const next = structuredClone(current)
  const existingCount = Object.values(current.tables).reduce((n, rows) => n + Object.keys(rows).length, 0)
  if (existingCount > 0 && stableJson(current.settings) !== stableJson(backup.state.settings)) throw new Error('云端设置与备份不同，请先核对差异；没有覆盖任何记录。')
  next.settings = structuredClone(backup.state.settings)
  for (const name of Object.keys(dailyPlanDomainSpec.tables) as TableName[]) for (const [key, record] of Object.entries(backup.state.tables[name])) {
    if (next.tables[name][key] && stableJson(next.tables[name][key]) !== stableJson(record)) throw new Error(`${name}/${key} 与云端记录冲突；没有覆盖任何记录。`)
    next.tables[name][key] = structuredClone(record)
  }
  return next
}
