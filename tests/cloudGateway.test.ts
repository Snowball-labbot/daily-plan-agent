import assert from 'node:assert/strict'
import test from 'node:test'
import { runCloudJson } from '../src/cloud/gateway.ts'
import { parseCoachDraft } from '../src/coachParser.ts'
import { PlanBlockSchema } from '../src/domain.ts'
import type { AgnesJsonOptions } from '../src/agnesJson.ts'

const options: AgnesJsonOptions = { provider: 'agnes', model: 'test', agentPreset: 'standard', timeoutMs: 60000, signal: new AbortController().signal, workspacePath: '.', sessionId: 'test', label: '计划' }
const turns = { prompt: '明天早上先做投资学作业，再做高微练习。', parse: parseCoachDraft, repair: (reason: string) => `按原文纠正：${reason}` }
const config = { baseUrl: 'https://agnes.invalid/v1/', apiKey: 'test-secret', model: 'test' }
function replies(entries: { text: string; finish?: string }[]) {
  const requests: any[] = []
  const fetcher: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)))
    const entry = entries[requests.length - 1]!
    return Response.json({ choices: [{ message: { content: entry.text }, finish_reason: entry.finish ?? 'stop' }] })
  }
  return { requests, fetch: fetcher }
}

test('different syntax and priority errors are repaired automatically with their actual details', async () => {
  const broken = '{"summary":"安排","appointments":[{"date":"date":"2026-10-03"}]}'
  const invalid = JSON.stringify({ summary: '先做投资学，再高微', tasks: [{ title: '高微', category: 'study', priority: 4 }] })
  const valid = JSON.stringify({ summary: '先做投资学，再高微', tasks: [{ title: '高微', category: 'study', priority: 2 }] })
  const mock = replies([{ text: broken }, { text: invalid }, { text: valid }])
  const diagnostics: any[] = []
  const result = await runCloudJson(options, turns, { ...config, ...mock, onRepair: value => diagnostics.push(value) })
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.value.tasks[0]!.priority, 2)
  assert.equal(mock.requests.length, 3)
  assert.match(mock.requests[1].messages.at(-1).content, /JSON 语法无效/)
  assert.match(mock.requests[2].messages.at(-1).content, /tasks\.0\.priority.*<=3/)
  assert(mock.requests.every(request => request.messages[0].content === turns.prompt))
  assert.deepEqual(diagnostics[1].paths, ['tasks.0.priority'])
  assert(!JSON.stringify(diagnostics).includes(turns.prompt))
  assert(!JSON.stringify(diagnostics).includes(config.apiKey))
})

test('a truncated completion cannot be accepted even if its prefix is valid JSON', async () => {
  const mock = replies([{ text: '{"summary":"只有开头"}', finish: 'length' }, { text: '{"summary":"完整安排"}' }])
  const result = await runCloudJson(options, turns, { ...config, ...mock })
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.value.summary, '完整安排')
  assert.match(mock.requests[1].messages.at(-1).content, /截断/)
  assert.equal(mock.requests.length, 2)
})

test('persistent invalid training facts fail after a bounded retry without filling in repetitions', async () => {
  const text = JSON.stringify({ summary: '训练', gymLogs: [{ date: '2026-10-02', evidence: '今天卧推', exercises: [{ name: '卧推', part: 'chest', evidence: '今天卧推', sets: [{ reps: null, weight: 40 }] }] }] })
  const mock = replies(Array.from({ length: 3 }, () => ({ text })))
  const result = await runCloudJson(options, turns, { ...config, ...mock })
  assert.equal(result.ok, false)
  if (!result.ok) { assert.equal(result.code, 'parse-failed'); assert.match(result.message, /训练记录/); assert(!result.message.includes('gymLogs')) }
  assert.equal(mock.requests.length, 3)
  assert.match(mock.requests[1].messages.at(-1).content, /gymLogs\.0\.exercises\.0\.sets\.0\.reps/)
})

test('cancellation during repair prevents another model request', async () => {
  const controller = new AbortController()
  const mock = replies([{ text: 'not json' }])
  const result = await runCloudJson({ ...options, signal: controller.signal }, turns, { ...config, ...mock, onRepair: () => controller.abort() })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, 'cancelled')
  assert.equal(mock.requests.length, 1)
})

test('an expired overall deadline and rate limit do not start more requests', async () => {
  let calls = 0
  const fetcher: typeof fetch = async () => { calls++; return new Response('', { status: 429 }) }
  const expired = await runCloudJson({ ...options, timeoutMs: 0 }, turns, { ...config, fetch: fetcher })
  assert.equal(expired.ok, false)
  if (!expired.ok) assert.equal(expired.code, 'timeout')
  assert.equal(calls, 0)
  const limited = await runCloudJson(options, turns, { ...config, fetch: fetcher })
  assert.equal(limited.ok, false)
  if (!limited.ok) assert.equal(limited.code, 'http-429')
  assert.equal(calls, 1)
})

test('transport timeout reports the real timeout rather than a format failure', async () => {
  const fetcher: typeof fetch = async () => { throw Object.assign(new Error('timeout'), { name: 'TimeoutError' }) }
  const result = await runCloudJson(options, turns, { ...config, fetch: fetcher })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.code, 'timeout')
})

test('a valid JSON draft with an impossible estimated time is automatically rescheduled before it is accepted', async () => {
  const fixed = PlanBlockSchema.parse({ id: 'fixed', title: '固定晚间安排', category: 'activity', source: 'routine', weekday: 6,
    startPeriod: 15, endPeriod: 17, startMinute: 1200, endMinute: 1350 })
  const planning = { date: '2026-10-02', minute: 600, replaceConflicts: true,
    days: [{ date: '2026-10-03', blocks: [fixed] }], minMinute: 420, maxMinute: 1350 }
  const event = { date: '2026-10-03', title: '视频学习', category: 'study', evidence: '明天晚上看一下学习视频', timeBasis: 'estimated' }
  const mock = replies([
    { text: JSON.stringify({ summary: '学习', appointments: [{ ...event, startMinute: 1365, endMinute: 1440 }] }) },
    { text: JSON.stringify({ summary: '晚饭后学习，避开固定安排', appointments: [{ ...event, startMinute: 1140, endMinute: 1200 }] }) },
  ])
  const result = await runCloudJson(options, { ...turns, parse: text => parseCoachDraft(text, planning) }, { ...config, ...mock })
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.value.appointments[0]!.startMinute, 1140)
  assert.equal(mock.requests.length, 2)
  assert.match(mock.requests[1].messages.at(-1).content, /appointments\.0\.endMinute.*22:30/)
  assert.match(mock.requests[1].messages.at(-1).content, /不改变用户作息/)
})
