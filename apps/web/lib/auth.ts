import { cookies } from 'next/headers'
import { authClient, config } from './db'
export function checkOrigin(request: Request) {
  const origin = request.headers.get('origin')
  // Next may normalize request.url to its internal localhost address. The actual
  // Host header identifies the browser's destination, including its public port.
  if (origin) {
    const supplied=new URL(origin)
    const expected=(request.headers.get('host') ?? new URL(request.url).host).toLowerCase()
    const protocol=request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim() ?? new URL(request.url).protocol.replace(':','')
    if(supplied.host.toLowerCase()!==expected || supplied.protocol!==`${protocol}:`)throw Object.assign(new Error('请求来源不匹配'), {status:403})
  }
  if (!origin && request.headers.has('cookie') && !request.headers.has('authorization')) throw Object.assign(new Error('缺少请求来源'), { status: 403 })
}
export async function saveSession(session: any) {
  const jar = await cookies()
  const common = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' }
  jar.set('planner_access', session.access_token, { ...common, maxAge: session.expires_in ?? 3600 })
  jar.set('planner_refresh', session.refresh_token, { ...common, maxAge: 60 * 60 * 24 * 30 })
}
export async function getOwner(request: Request) {
  const jar = await cookies()
  const bearer = request.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1]
  let token = bearer ?? jar.get('planner_access')?.value
  const client = authClient()
  if (!token && !jar.get('planner_refresh')?.value) throw Object.assign(new Error('请先登录个人账号'), { status: 401 })
  let result = token ? await client.auth.getUser(token) : { data: { user: null }, error: new Error('expired') }
  if (result.error && !bearer && jar.get('planner_refresh')?.value) {
    const refreshed = await client.auth.refreshSession({ refresh_token: jar.get('planner_refresh')!.value })
    if (refreshed.data.session) { await saveSession(refreshed.data.session); token = refreshed.data.session.access_token; result = await client.auth.getUser(token) }
  }
  const user = result.data.user
  if (!user || result.error) throw Object.assign(new Error('登录已过期，请重新登录'), { status: 401 })
  if (user.email?.toLowerCase() !== config('OWNER_EMAIL').toLowerCase()) throw Object.assign(new Error('此网站仅开放给指定的个人账号'), { status: 403 })
  return user
}
export function failure(error: any) { return Response.json({ ok: false, error: { code: 'planner-error', message: error?.message ?? '请求失败' } }, { status: error.status ?? 400, headers: { 'Cache-Control': 'no-store' } }) }
