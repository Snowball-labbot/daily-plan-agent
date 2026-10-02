import { spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { DailyPlanService } from './service.ts'
import { emptyState, mergeBackup, migrationReport, stateChecksum, type PlanBackup } from './migration.ts'

type Session = { base: string; owner: string; email: string; accessToken: string; refreshToken: string; expiresAt: number }
/** Windows stores only a DPAPI-encrypted session; tokens never enter renderer state. */
async function protectedText(value: string, decrypt: boolean): Promise<string> {
  if (process.platform !== 'win32') throw new Error('此原生连接目前支持 Windows；其他电脑可以使用网页版。')
  const script = decrypt
    ? '$v=[Console]::In.ReadToEnd(); $b=[Convert]::FromBase64String($v); [Console]::Out.Write([Text.Encoding]::UTF8.GetString([Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))'
    : '$v=[Console]::In.ReadToEnd(); $b=[Text.Encoding]::UTF8.GetBytes($v); [Console]::Out.Write([Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)))'
  return new Promise((resolve,reject)=>{
    const child = spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Add-Type -AssemblyName System.Security; ${script}`],{windowsHide:true,stdio:'pipe'})
    let output=''; child.stdout.on('data',chunk=>{output+=String(chunk)})
    const timer=setTimeout(()=>{child.kill();reject(new Error('本机安全存储未响应'))},10000)
    child.on('error',()=>{clearTimeout(timer);reject(new Error('无法打开本机安全存储'))})
    child.on('close',code=>{clearTimeout(timer);code===0?resolve(output):reject(new Error('无法读取本机加密的会话，请重新连接'))})
    child.stdin.end(value)
  })
}
export class CloudBridge {
  private session: Session | null = null
  private revision: number | undefined
  private tail: Promise<unknown> = Promise.resolve()
  private file = path.join(homedir(),'.dsh','daily-plan-cloud-session.dpapi')
  constructor(private service: DailyPlanService) {}
  async load() { try { this.session=JSON.parse(await protectedText(await readFile(this.file,'utf8'),true)) } catch { /* Remain local when not configured. */ } }
  get enabled() { return this.session !== null }
  status() { return { connected:this.enabled, url:this.session?.base ?? '', email:this.session?.email ?? '', mode:this.enabled?'cloud':'local' } }
  private async save() { await mkdir(path.dirname(this.file),{recursive:true}); await writeFile(this.file,await protectedText(JSON.stringify(this.session),false),'utf8') }
  private localBackup(): PlanBackup {
    const dump=this.service.exportAll(), state=emptyState()
    state.settings=dump.settings as Record<string,unknown>
    for(const name of Object.keys(state.tables) as (keyof typeof state.tables)[]) state.tables[name]=dump[name] as any
    return { format:'daily-plan-backup',schemaVersion:1,sourceId:'dsh-desktop',exportedAt:new Date().toISOString(),checksum:stateChecksum(state),state }
  }
  async connect(input: any) {
    const base=new URL(String(input.url))
    if(base.protocol!=='https:' || base.username || base.password || base.pathname!=='/') throw new Error('请输入 HTTPS 网站根网址')
    const result=await fetch(`${base.origin}/api/device/session`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:input.email,password:input.password}),signal:AbortSignal.timeout(25000)}).then(response=>response.json()) as any
    if(!result.ok) throw new Error(result.error?.message ?? '连接失败')
    const candidate={...result.value,base:base.origin} as Session
    // Switch only when all local IDs and facts already exist identically in this account.
    const remote=await fetch(`${candidate.base}/api/migration`,{headers:{Authorization:`Bearer ${candidate.accessToken}`},signal:AbortSignal.timeout(25000)}).then(response=>response.json()) as any
    if(remote.format!=='daily-plan-backup') throw new Error(remote.error?.message ?? '无法核验云端数据')
    const local=this.localBackup()
    const cloud={...remote.state,settings:local.state.settings}
    const merged=mergeBackup(cloud,local)
    if(stateChecksum(merged)!==stateChecksum(cloud)) throw new Error('部分电脑记录尚未迁入此账号，请先在网页版导入最新备份，再连接。')
    this.session=candidate
    try { await this.save() } catch(error) { this.session=null; throw error }
    return {...this.status(),records:migrationReport(remote.state).total}
  }
  async disconnect() { this.session=null;this.revision=undefined;await unlink(this.file).catch(()=>undefined);return this.status() }
  private async token() {
    if(!this.session) throw new Error('尚未连接云端')
    if(this.session.expiresAt*1000<Date.now()+90000) {
      const response=await fetch(`${this.session.base}/api/device/session`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refreshToken:this.session.refreshToken}),signal:AbortSignal.timeout(20000)}).then(value=>value.json()) as any
      if(!response.ok) throw new Error('云端登录已过期，请重新连接；没有切回本地写入。')
      this.session={...response.value,base:this.session.base}; await this.save()
    }
    return this.session!.accessToken
  }
  private async send(endpoint: string,payload: any,signal?: AbortSignal) {
    const token=await this.token()
    const response=await fetch(`${this.session!.base}/api/rpc`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({endpoint,payload,operationId:randomUUID(),expectedRevision:this.revision}),signal:AbortSignal.any([AbortSignal.timeout(30000),...(signal?[signal]:[])])})
    const result=await response.json() as any
    if(typeof result.revision==='number') this.revision=result.revision
    return result
  }
  async call(endpoint: string,payload: any,signal?: AbortSignal): Promise<any> {
    if(endpoint==='cloud.status') return {ok:true,value:this.status()}
    if(endpoint==='cloud.connect') return {ok:true,value:await this.connect(payload)}
    if(endpoint==='cloud.disconnect') return {ok:true,value:await this.disconnect()}
    const next=this.tail.then(async()=>{
      if(this.revision===undefined && endpoint!=='snapshot') { const snapshot=await this.send('snapshot',{}); if(!snapshot.ok)return snapshot }
      return this.send(endpoint,payload,signal)
    })
    this.tail=next.catch(()=>undefined)
    return next
  }
  async tool(name: string,args: any,signal: AbortSignal) {
    const unpack=async(endpoint:string,payload:any={})=>{const result=await this.call(endpoint,payload,signal);if(!result.ok)throw new Error(result.error?.message ?? '云端请求失败');return result.value}
    if(name==='daily_plan_today') return {ok:true,value:await unpack('snapshot')}
    if(name==='daily_plan_week') return {ok:true,value:await unpack('snapshot',{weekKey:args.week_key})}
    if(name==='daily_plan_workflow_context') return {ok:true,value:await unpack('workflow.context',{weekKey:args.week_key})}
    if(name==='daily_plan_rebalance') return {ok:true,value:await unpack('workflow.replan',{fromDate:args.from_date})}
    if(name==='daily_plan_backlog') {
      if(!args.title)return {ok:true,value:await unpack('backlog.list')}
      return {ok:true,value:await unpack('backlog.upsert',{item:{title:args.title,category:args.category ?? 'study',estimatePeriods:args.estimate_periods ?? 2,dueDate:args.due_date ?? null}})}
    }
    if(name==='daily_plan_schedule') return {ok:true,value:await unpack('plan.block.upsert',{date:args.date,block:{title:args.title,category:args.category ?? 'study',startPeriod:args.start_period,endPeriod:args.end_period,source:'manual'}})}
    if(name==='daily_plan_workflow' || (name==='daily_plan_review' && typeof args.text==='string')) {
      const value=await unpack('workflow.start',{clientRequestId:randomUUID(),text:args.text ?? '',mode:args.mode ?? 'review',weekKey:args.week_key,apply:args.apply===true || args.archive===true,replaceConflicts:args.replace_conflicts===true,rangeStart:args.range_start,rangeEnd:args.range_end,planStart:args.plan_start,planEnd:args.plan_end})
      return {ok:true,value:{...value,status:'running',message:'已提交云端后台处理，可以在「告诉 Agnes」恢复安排。'}}
    }
    if(name==='daily_plan_review')return {ok:true,value:await unpack('review.get',{date:args.date ?? this.service.todayIso()})}
    throw new Error('此操作尚未接入云端，未修改本地记录。')
  }
}
