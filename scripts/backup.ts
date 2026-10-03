import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { emptyState, migrationReport, stateChecksum, validateState } from '../src/migration.ts'

const source = path.resolve(process.argv[2] ?? path.join(homedir(), '.dsh/storages/dsh_daily_plan'))
const destination = path.resolve(process.argv[3] ?? '.local/backups')
await mkdir(destination, { recursive: true })
let sourceId: string
try { sourceId = (await readFile(path.join(destination, 'source-id'), 'utf8')).trim() }
catch { sourceId = randomUUID(); await writeFile(path.join(destination, 'source-id'), sourceId, { flag: 'wx' }) }
async function load() {
  const state = emptyState()
  state.settings = JSON.parse(await readFile(path.join(source, 'global.json'), 'utf8')).record
  for (const name of Object.keys(state.tables)) {
    let files: string[]
    try { files = await readdir(path.join(source, name)) } catch (error: any) { if (error.code === 'ENOENT') continue; throw error }
    for (const file of files.filter((name) => name.endsWith('.json')).sort()) {
      state.tables[name as keyof typeof state.tables][file.slice(0, -5)] = JSON.parse(await readFile(path.join(source, name, file), 'utf8')).record
    }
  }
  validateState(state)
  return state
}
let state = await load()
let stable = false
for (let attempt = 0; attempt < 3; attempt++) {
  const check = await load()
  if (stateChecksum(check) === stateChecksum(state)) { stable = true; break }
  state = check
}
if (!stable) throw new Error('数据库持续变化，请暂时停止编辑日程后重新备份。')
const exportedAt = new Date().toISOString()
const backup = { format: 'daily-plan-backup', schemaVersion: 1, sourceId, exportedAt, checksum: stateChecksum(state), state }
const file = path.join(destination, `daily-plan-${exportedAt.replace(/[:.]/g, '-')}.backup.json`)
await writeFile(file, JSON.stringify(backup, null, 2), { flag: 'wx' })
await writeFile(file.replace('.backup.json', '.report.json'), JSON.stringify(migrationReport(state), null, 2), { flag: 'wx' })
console.log(JSON.stringify({ backup: file, checksum: backup.checksum, ...migrationReport(state) }))
