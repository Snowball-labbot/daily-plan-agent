import { checkOrigin, failure } from '../../../../lib/auth'
import { authClient, config } from '../../../../lib/db'
export async function POST(request: Request) {
  try {
    checkOrigin(request)
    const input = await request.json()
    const client = authClient()
    const result = input.refreshToken
      ? await client.auth.refreshSession({ refresh_token: String(input.refreshToken) })
      : await client.auth.signInWithPassword({ email: String(input.email ?? ''), password: String(input.password ?? '') })
    if (result.error || !result.data.session || result.data.user?.email?.toLowerCase() !== config('OWNER_EMAIL').toLowerCase()) throw Object.assign(new Error('账号或密码不正确，请重新登录个人账号'), { status:401 })
    const session = result.data.session
    return Response.json({ ok:true, value:{ owner:session.user.id, email:session.user.email, accessToken:session.access_token, refreshToken:session.refresh_token, expiresAt:session.expires_at } }, { headers:{ 'Cache-Control':'no-store' } })
  } catch(error) { return failure(error) }
}
