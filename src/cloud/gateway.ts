import type { AgnesJsonOptions, AgnesJsonTurns, AgnesJsonResult } from '../agnesJsonTypes'

interface GatewayConfig {
  baseUrl: string
  apiKey: string
  model: string
  fetch?: typeof globalThis.fetch
  onRepair?: (diagnostic: { attempt: number; kind: string; paths: string[] }) => void
}

function validationFailure(error: unknown): { feedback: string; paths: string[]; field: string } {
  const issues = (error as { issues?: { path: (string | number)[]; message: string }[] })?.issues
  if (Array.isArray(issues)) return {
    feedback: issues.slice(0, 12).map(issue => `${issue.path.join('.') || '根对象'}: ${issue.message}`).join('\n'),
    paths: issues.slice(0, 12).map(issue => issue.path.join('.')),
    field: issues[0]?.path.includes('priority') ? '任务优先级' : issues[0]?.path.includes('gymLogs') ? '训练记录' : '安排内容',
  }
  const position = /position\s+(\d+)/u.exec(error instanceof Error ? error.message : '')?.[1]
  return { feedback: `JSON 语法无效${position ? `，错误位置为字符 ${position}` : ''}。请输出完整合法的 JSON；每个属性只写一次，正确使用冒号、逗号和双引号。`, paths: [], field: '返回格式' }
}

/** One generation and at most two targeted repairs, within the same deadline. */
export async function runCloudJson<T>(options: AgnesJsonOptions, turns: AgnesJsonTurns<T>, config: GatewayConfig): Promise<AgnesJsonResult<T>> {
  const messages = [{ role: 'user', content: turns.prompt }]
  const deadline = Date.now() + Math.min(options.timeoutMs, 240000)
  let failureField = '返回格式'
  for (let attempt = 0; attempt < 3; attempt++) {
    if (options.signal.aborted) return { ok: false, code: 'cancelled', message: '已停止整理，原文已保留。' }
    if (Date.now() >= deadline) return { ok: false, code: 'timeout', message: 'Agnes 等待超时，原文已保留。' }
    let text: string
    let truncated = false
    try {
      const response = await (config.fetch ?? globalThis.fetch)(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: config.model, messages, stream: false, max_tokens: 12000 }),
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(Math.max(1, Math.min(120000, deadline - Date.now())))]),
      })
      if (!response.ok) return { ok: false, code: `http-${response.status}`, message: response.status === 429 ? 'Agnes 当前额度或速率受限，请稍后重试。' : `Agnes 接口返回 ${response.status}，原文已保留。` }
      const payload = await response.json()
      text = payload.choices?.[0]?.message?.content
      truncated = payload.choices?.[0]?.finish_reason === 'length'
      if (typeof text !== 'string' || !text.trim()) throw new Error('empty-content')
    } catch (error) {
      return { ok: false, code: options.signal.aborted ? 'cancelled' : (error as Error)?.name === 'TimeoutError' ? 'timeout' : 'connection',
        message: options.signal.aborted ? '已停止整理，原文已保留。' : (error as Error)?.name === 'TimeoutError' ? 'Agnes 等待超时，原文已保留。' : 'Agnes 连接失败或未返回正文，原文已保留。' }
    }
    let failure: ReturnType<typeof validationFailure>
    try {
      if (truncated) throw new Error('truncated')
      return { ok: true, value: turns.parse(text) }
    } catch (error) {
      failure = truncated ? { feedback: '输出达到长度限制，内容被截断。请精简描述，只输出完整 JSON，不输出解释和推理；保留用户明确的活动与时间。', paths: [], field: '返回内容长度' } : validationFailure(error)
    }
    failureField = failure.field
    config.onRepair?.({ attempt: attempt + 1, kind: truncated ? 'truncated' : failure.paths.length ? 'validation' : 'json', paths: failure.paths })
    if (attempt < 2) messages.push({ role: 'assistant', content: text }, { role: 'user', content: turns.repair(failure.feedback) })
  }
  return { ok: false, code: 'parse-failed', message: `Agnes 的${failureField}不符合要求，自动纠错未成功。原文已保留，请重新整理。` }
}
