'use client'
import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
const Planner = dynamic(() => import('./generated-placeholder').then((module) => module.PlannerWeb), { ssr: false, loading: () => <p className="loading">正在打开日计划…</p> })
export default function PlannerClient() {
  const [user, setUser] = useState<{ id: string; email: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [remember, setRemember] = useState(true)
  const [email, setEmail] = useState('')
  useEffect(() => {
    try { const saved=JSON.parse(localStorage.getItem('daily-plan-login') ?? 'null'); if(saved) { setRemember(saved.remember===true); setEmail(saved.email ?? '') } } catch { /* Optional preference. */ }
    void fetch('/api/auth').then(async (response) => ({ status: response.status, data: await response.json() })).then(({ status, data }) => {
      if (data.ok && data.value) { setUser(data.value); localStorage.setItem('daily-plan-account',JSON.stringify(data.value)) }
      else { if(status===401)localStorage.removeItem('daily-plan-account'); else setError(data.error?.message ?? '') }
    }).catch(() => { try { const saved=localStorage.getItem('daily-plan-account'); if(!navigator.onLine && saved) { setUser(JSON.parse(saved)); return } } catch { /* Optional. */ } setError('网络未连接，请稍后重试') }).finally(() => setLoading(false))
    if ('serviceWorker' in navigator && process.env.NODE_ENV==='production') void navigator.serviceWorker.register('/sw.js').catch(() => undefined)
  }, [])
  if (loading) return <p className="loading">连接你的账号…</p>
  if (user) return <Planner owner={user.id} email={user.email} onLogout={async () => { await fetch('/api/auth', { method:'DELETE' }); localStorage.removeItem('daily-plan-account'); setUser(null) }} />
  return <main className="login"><div className="login-mark">✧</div><h1>每日计划</h1><p>告诉 Agnes 近况，接着安排你的生活。</p><form onSubmit={async (event) => {
    event.preventDefault(); setBusy(true); setError('')
    const form = event.currentTarget, fields = new FormData(form)
    try {
      const data = await fetch('/api/auth', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ email:fields.get('email'), password:fields.get('password'), remember }) }).then((response) => response.json())
      if (!data.ok || !data.value) throw new Error(data.error?.message ?? '无法登录')
      // Passwords belong to the browser/iCloud password manager, never localStorage.
      if (remember) {
        localStorage.setItem('daily-plan-login',JSON.stringify({remember:true,email:fields.get('email')}))
        const Password = (window as any).PasswordCredential
        try { if (Password && navigator.credentials?.store) void navigator.credentials.store(new Password(form)).catch(()=>undefined) } catch { /* Browser password manager remains available through autocomplete. */ }
      } else localStorage.setItem('daily-plan-login',JSON.stringify({remember:false}))
      localStorage.setItem('daily-plan-account',JSON.stringify(data.value)); setUser(data.value)
    } catch (failure) { setError(failure instanceof Error ? failure.message : '连接失败') } finally { setBusy(false) }
  }}><label>邮箱<input type="email" name="email" value={email} onChange={event=>setEmail(event.target.value)} autoComplete="username" required /></label><label>密码<input type="password" name="password" autoComplete="current-password" required minLength={8} /></label><label className="login-remember"><input type="checkbox" checked={remember} onChange={event=>setRemember(event.target.checked)} />记住密码与登录</label><small>密码由浏览器或 iCloud 钥匙串保存；勾选后保持登录 30 天。</small><button disabled={busy}>{busy ? '登录中…' : '登录个人账号'}</button></form>{error && <p role="alert" className="login-error">{error}</p>}<small>仅开放你的个人账号。账号与数据库配置见项目部署指南。</small></main>
}
