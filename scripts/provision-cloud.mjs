import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { randomBytes, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const local=path.join(root,'.local')
await mkdir(local,{recursive:true})
function env(text) { return Object.fromEntries(text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(line=>line.trim()&&!line.startsWith('#')&&line.includes('=')).map(line=>{const index=line.indexOf('=');return [line.slice(0,index).trim(),line.slice(index+1).trim().replace(/^"|"$/g,'')] })) }
const settings={...process.env,...env(await readFile(path.join(local,'cloud-provision.env'),'utf8'))}
let receipt={}
try { receipt=JSON.parse(await readFile(path.join(local,'cloud-resources.json'),'utf8')) } catch {}
async function checkpoint() { await writeFile(path.join(local,'cloud-resources.json'),JSON.stringify(receipt,null,2)+'\n') }
async function request(base,token,url,method='GET',body,extra={}) {
  const response=await fetch(`${base}${url}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...extra},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(45000)})
  const result=await response.json().catch(()=>null)
  if(!response.ok) throw new Error(`${method} ${url.split('?')[0]}: HTTP ${response.status}. 请核验账号权限和免费额度；没有升级付费方案。`)
  return result
}
const supabase=(url,method,body)=>request('https://api.supabase.com',settings.SUPABASE_ACCESS_TOKEN,url,method,body)
const owner=settings.OWNER_EMAIL ?? 'wu13527880029@gmail.com'
let cloudEnv
if(settings.SUPABASE_ACCESS_TOKEN) {
  let orgs=await supabase('/v1/organizations')
  const projects=await supabase('/v1/projects')
  const chosenId=settings.SUPABASE_PROJECT_REF ?? receipt.supabase?.id
  let project=chosenId ? projects.find(item=>item.id===chosenId) : undefined
  if(chosenId&&!project)throw new Error('指定的 Supabase 项目不在授权账号下，已停止；不会另建项目。')
  let org=project ? orgs.find(item=>item.id===project.organization_id || item.slug===project.organization_slug) : orgs.find(item=>(item.slug ?? item.id)===settings.SUPABASE_ORGANIZATION_SLUG) ?? orgs.find(item=>item.name==='daily-plan-agent')
  // A project-scoped PAT may list its project while organization reads are denied.
  // Reusing that existing project never changes subscriptions or creates resources.
  if(project&&!org)org={id:project.organization_id,slug:project.organization_slug ?? project.organization_id}
  if(!org) {
    const free=[]
    for(const item of orgs) { const detail=await supabase(`/v1/organizations/${item.slug ?? item.id}`);if(detail.plan==='free')free.push(item) }
    if(free.length===1)org=free[0]
    else org=await supabase('/v1/organizations','POST',{name:'daily-plan-agent'})
  }
  const slug=org.slug ?? org.id
  if(!project){const detail=await supabase(`/v1/organizations/${slug}`);if(detail.plan!=='free')throw new Error('目标 Supabase 组织不是 Free，已停止创建，未更改订阅。')}
  project ??= projects.find(item=>item.name==='daily-plan-agent'&&(item.organization_id===org.id||item.organization_slug===slug))
  if(!project) {
    const passwordPath=path.join(local,'supabase-db-password.txt')
    let dbPassword=await readFile(passwordPath,'utf8').then(text=>text.trim()).catch(()=>null)
    if(!dbPassword){dbPassword=randomBytes(24).toString('base64url');await writeFile(passwordPath,dbPassword+'\n',{flag:'wx'})}
    project=await supabase('/v1/projects','POST',{name:'daily-plan-agent',organization_slug:slug,db_pass:dbPassword,region:'ap-southeast-1',plan:'free'})
  }
  receipt.supabase={id:project.id,organization:slug,url:`https://${project.id}.supabase.co`,dashboard:`https://supabase.com/dashboard/project/${project.id}`};await checkpoint()
  console.log(`Supabase project: ${receipt.supabase.dashboard}`)
  if(project.status!=='ACTIVE_HEALTHY') { project=await supabase(`/v1/projects/${project.id}`);if(project.status!=='ACTIVE_HEALTHY') { console.log('Supabase 正在初始化。稍后重新运行同一命令即可，不会重复创建。');process.exit(0) } }
  const keys=await supabase(`/v1/projects/${project.id}/api-keys`)
  const anon=keys.find(key=>key.name==='anon')?.api_key,service=keys.find(key=>key.name==='service_role')?.api_key
  if(!anon||!service)throw new Error('项目没有可用的服务端 API key，请检查项目 API 设置。')
  const query=(sql)=>supabase(`/v1/projects/${project.id}/database/query`,'POST',{query:sql})
  const schema=await query("select to_regclass('public.planner_schema_versions') as ledger")
  if(!schema?.[0]?.ledger)await query(`begin;\n${await readFile(path.join(root,'supabase/migrations/001_planner.sql'),'utf8')}\ncommit;`)
  await supabase(`/v1/projects/${project.id}/config/auth`,'PATCH',{disable_signup:true})
  const dbUrl=receipt.supabase.url
  const rest=(url,method,body)=>request(dbUrl,service,url,method,body,{apikey:service})
  const users=await rest('/auth/v1/admin/users?page=1&per_page=1000')
  let user=users.users?.find(item=>item.email?.toLowerCase()===owner.toLowerCase())
  let accountPassword=settings.PLANNER_ACCOUNT_PASSWORD
  if(!user) {
    accountPassword ||= randomBytes(18).toString('base64url')
    await writeFile(path.join(local,'planner-account-password.txt'),accountPassword+'\n',{flag:'wx'})
    user=await rest('/auth/v1/admin/users','POST',{email:owner,password:accountPassword,email_confirm:true})
  }
  receipt.account={id:user.id,email:owner};await checkpoint()
  cloudEnv={SUPABASE_URL:dbUrl,SUPABASE_ANON_KEY:anon,SUPABASE_SERVICE_ROLE_KEY:service,OWNER_EMAIL:owner,AGNES_BASE_URL:settings.AGNES_BASE_URL ?? 'https://apihub.agnes-ai.com/v1',AGNES_MODEL:'agnes-2.5-flash',AGNES_API_KEY:settings.AGNES_API_KEY ?? '',ENABLE_EXPERIMENTAL_COREPACK:'1'}
  await writeFile(path.join(root,'apps/web/.env.local'),Object.entries(cloudEnv).map(([key,value])=>`${key}=${value}`).join('\n')+'\n')
  console.log('数据库结构和个人账号已建立；密钥保存在 apps/web/.env.local，未输出或上传 Git。')
  if(process.argv.includes('--import-backup')) {
    const {validateBackup,mergeBackup,migrationReport,stateChecksum,emptyState}=await import('../apps/web/generated/migration.mjs')
    const files=(await readdir(path.join(local,'backups'))).filter(name=>name.endsWith('.backup.json')).sort()
    const backup=validateBackup(JSON.parse(await readFile(path.join(local,'backups',files.at(-1)),'utf8')))
    const existing=await rest(`/rest/v1/planner_imports?owner_id=eq.${user.id}&source_id=eq.${encodeURIComponent(backup.sourceId)}&checksum=eq.${backup.checksum}&select=report`)
    if(existing.length)console.log('同一备份已导入，跳过重复写入。')
    else {
      const rows=await rest(`/rest/v1/planner_states?owner_id=eq.${user.id}&select=data,revision`)
      const state=mergeBackup(rows[0]?.data ?? emptyState(),backup)
      const report=migrationReport(state)
      console.log(`迁移预览：${report.total} 条记录，${report.warnings.length} 项关联警告。`)
      if(report.warnings.length)throw new Error('发现关联警告，停止迁移，请先核对。')
      await rest('/rest/v1/rpc/commit_planner_state','POST',{p_owner:user.id,p_data:state,p_expected:rows[0]?.revision ?? 0,p_operation:randomUUID(),p_result:{ok:true,value:report},p_import:{sourceId:backup.sourceId,checksum:backup.checksum,report}})
      const saved=await rest(`/rest/v1/planner_states?owner_id=eq.${user.id}&select=data,revision`)
      if(stateChecksum(saved[0].data)!==stateChecksum(state))throw new Error('云端校验未一致，暂不切换桌面连接。')
      await writeFile(path.join(local,'cloud-migration-report.json'),JSON.stringify({source:backup.checksum,account:owner,revision:saved[0].revision,verified:true,...report},null,2))
      console.log('云端迁移与完整校验已完成。原 DSH 数据库保持原样。')
    }
  }
} else console.log('待 Supabase 授权：请在 .local/cloud-provision.env 填写 SUPABASE_ACCESS_TOKEN。')
let vercelToken=settings.VERCEL_TOKEN
if(!vercelToken)for(const filename of [path.join(process.env.APPDATA ?? '', 'com.vercel.cli/Data/auth.json'),path.join(process.env.APPDATA ?? '', 'com.vercel.cli/auth.json'),path.join(homedir(),'.local/share/com.vercel.cli/auth.json')]) { try {const auth=JSON.parse(await readFile(filename,'utf8'));vercelToken=auth.token ?? auth.accessToken;if(vercelToken)break} catch{} }
if(vercelToken) {
  const team='team_5H1XfteUOqzgPRgnAzOdGKDD'
  const vercel=(url,method,body)=>request('https://api.vercel.com',vercelToken,`${url}${url.includes('?')?'&':'?'}teamId=${team}`,method,body)
  const teamInfo=await vercel(`/v2/teams/${team}`)
  if(teamInfo.billing?.plan!=='hobby')throw new Error('当前 Vercel 团队不是 Hobby 免费方案，停止自动创建，未升级订阅。')
  const list=await vercel('/v9/projects')
  let project=list.projects?.find(item=>item.name==='daily-plan-agent')
  if(!project)project=await vercel('/v11/projects','POST',{name:'daily-plan-agent',framework:'nextjs',rootDirectory:'apps/web',nodeVersion:'22.x',gitRepository:{type:'github',repo:'Snowball-labbot/daily-plan-agent'},installCommand:'corepack enable && pnpm install --frozen-lockfile',buildCommand:'pnpm run build'})
  project=await vercel(`/v9/projects/${project.id}`,'PATCH',{framework:'nextjs',rootDirectory:'apps/web',nodeVersion:'22.x',sourceFilesOutsideRootDirectory:true,installCommand:'corepack enable && pnpm install --frozen-lockfile',buildCommand:'pnpm run build',outputDirectory:null})
  receipt.vercel={id:project.id,team,url:`https://vercel.com/wus-projects-9aa55391/${project.name}`};await checkpoint()
  if(!cloudEnv) { try {cloudEnv=env(await readFile(path.join(root,'apps/web/.env.local'),'utf8'))}catch{} }
  if(cloudEnv) {
    const variables=await vercel(`/v10/projects/${project.id}/env`)
    for(const [key,value]of Object.entries(cloudEnv).filter(([,value])=>value)) {
      const existing=variables.envs?.find(row=>row.key===key&&row.target?.includes('preview'))
      if(existing)await vercel(`/v9/projects/${project.id}/env/${existing.id}`,'PATCH',{value,type:'encrypted',target:['preview','production']})
      else await vercel(`/v10/projects/${project.id}/env`,'POST',{key,value,type:'encrypted',target:['preview','production']})
    }
  }
  if(process.argv.includes('--deploy')) {
    const deployment=await vercel('/v13/deployments','POST',{name:project.name,project:project.id,gitSource:{type:'github',repo:'daily-plan-agent',org:'Snowball-labbot',ref:'feat/cloud-mobile-sync'}})
    receipt.deployment={id:deployment.id,url:`https://${deployment.url}`,state:deployment.readyState};await checkpoint()
    console.log(`Vercel 预览部署已提交: ${receipt.deployment.url}`)
  }
  console.log(`Vercel project: ${receipt.vercel.url}`)
} else console.log('待 Vercel CLI 登录；或在 .local/cloud-provision.env 填写 VERCEL_TOKEN。')
