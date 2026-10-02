import { cookies } from 'next/headers'
import { authClient, config } from '../../../lib/db'
import { checkOrigin, failure, getOwner, saveSession } from '../../../lib/auth'
export async function GET(request: Request) { try { const user = await getOwner(request); return Response.json({ ok: true, value: { id: user.id, email: user.email } }, { headers: { 'Cache-Control': 'no-store' } }) } catch (error) { return failure(error) } }
export async function POST(request: Request) {
  try {
    checkOrigin(request)
    const { email, password } = await request.json()
    if (typeof email !== 'string' || email.toLowerCase() !== config('OWNER_EMAIL').toLowerCase() || typeof password !== 'string') throw new Error('账号或密码不正确')
    const { data, error } = await authClient().auth.signInWithPassword({ email, password })
    if (error || !data.session) throw new Error('账号或密码不正确')
    await saveSession(data.session)
    return Response.json({ ok: true, value: { id: data.user.id, email: data.user.email } })
  } catch (error) { return failure(error) }
}
export async function DELETE(request: Request) { try { checkOrigin(request); const jar = await cookies(); jar.delete('planner_access'); jar.delete('planner_refresh'); return Response.json({ ok: true }) } catch (error) { return failure(error) } }
