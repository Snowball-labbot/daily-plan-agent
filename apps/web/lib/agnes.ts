import { config } from './db'
export async function modelGateway(options: any, turns: any) {
  const messages = [{ role: 'user', content: turns.prompt }]
  const deadline = Date.now() + Math.min(options.timeoutMs, 240000)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(`${(process.env.AGNES_BASE_URL ?? 'https://apihub.agnes-ai.com/v1').replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', headers: { Authorization: `Bearer ${config('AGNES_API_KEY')}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: process.env.AGNES_MODEL ?? 'agnes-2.5-flash', messages, stream: false, max_tokens: 12000 }),
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(Math.max(1, Math.min(120000, deadline - Date.now())))]),
      })
      if (!response.ok) return { ok: false, code: `http-${response.status}`, message: response.status === 429 ? 'Agnes 当前额度或速率受限，请稍后重试。' : `Agnes 接口返回 ${response.status}，原文已保留。` }
      const payload = await response.json()
      const text = payload.choices?.[0]?.message?.content
      if (typeof text !== 'string' || !text.trim()) throw new Error('Agnes 没有返回有效正文')
      try { return { ok: true, value: turns.parse(text) } }
      catch { messages.push({ role: 'assistant', content: text }, { role: 'user', content: turns.repair('返回结构不符合计划格式，请重新输出完整 JSON。') }) }
    } catch (error: any) {
      return { ok: false, code: options.signal.aborted ? 'cancelled' : 'connection', message: options.signal.aborted ? '已停止整理，原文已保留。' : error.name === 'TimeoutError' ? 'Agnes 等待超时，原文已保留。' : error.message?.startsWith('云端尚未') ? error.message : 'Agnes 连接失败，原文已保留。' }
    }
  }
  return { ok: false, code: 'parse-failed', message: 'Agnes 返回格式仍不完整，原文已保留，请重新整理。' }
}
