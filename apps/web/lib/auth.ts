import { cookies } from 'next/headers'
import { authClient, config } from './db'
import { sessionCookiePolicy } from './session-policy'
export { checkOrigin } from './origin'
export async function saveSession(session: any, remember?: boolean) {
  const jar = await cookies()
  // Preserve the choice when refreshing. Existing accounts retain their former
  // persistent session until their next explicit login.
  const persistent = remember ?? jar.get('planner_remember')?.value !== '0'
  const policy = sessionCookiePolicy(persistent, session.expires_in ?? 3600)
  const common = { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' }
  jar.set('planner_access', session.access_token, { ...common, ...policy.access })
  jar.set('planner_refresh', session.refresh_token, { ...common, ...policy.refresh })
  jar.set('planner_remember', persistent ? '1' : '0', { ...common, ...policy.preference })
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
