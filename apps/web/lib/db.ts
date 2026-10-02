import { createClient } from '@supabase/supabase-js'
import { emptyState } from '../generated/migration.mjs'
export function config(name: string) { const value = process.env[name]; if (!value) throw Object.assign(new Error(`云端尚未配置 ${name}，请按部署说明填写服务器环境变量。`), { status: 503 }); return value }
export function admin() { return createClient(config('SUPABASE_URL'), config('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } }) }
export function authClient() { return createClient(config('SUPABASE_URL'), config('SUPABASE_ANON_KEY'), { auth: { persistSession: false, autoRefreshToken: false } }) }
export async function loadState(owner: string) {
  const { data, error } = await admin().from('planner_states').select('data,revision').eq('owner_id', owner).maybeSingle()
  if (error) throw new Error('读取云端数据失败，请确认数据库迁移已执行。')
  return { state: data?.data ?? emptyState(), revision: Number(data?.revision ?? 0) }
}
export async function commit(owner: string, state: any, revision: number, operation: string, response: any, receipt: any = null) {
  const { data, error } = await admin().rpc('commit_planner_state', { p_owner: owner, p_data: state, p_expected: revision, p_operation: operation, p_result: response, p_import: receipt })
  if (error) {
    if (error.code === '40001') throw Object.assign(new Error('另一台设备已更新安排。微调已保留，请刷新后核对再保存。'), { status: 409 })
    throw new Error('保存云端数据失败，本次更改没有提交。')
  }
  return data as { revision: number; response: any }
}
export async function previousOperation(owner: string, id: string) {
  const { data, error } = await admin().from('planner_operations').select('result').eq('owner_id', owner).eq('operation_id', id).maybeSingle()
  if (error) throw new Error('无法核验保存状态，请稍后重试。')
  return data?.result ?? null
}
