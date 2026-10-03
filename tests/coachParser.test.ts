import assert from 'node:assert/strict'
import test from 'node:test'
import { parseCoachDraft } from '../src/coachParser.ts'

test('trailing punctuation is repaired without modifying quoted text or evidence', () => {
  const text = '{"summary":"保留 ,] 和 ,} 与 \\\"引号\\\"", "tasks":[{"title":"高微", "category":"study", "note":"代码 ,]",},],}'
  const result = parseCoachDraft(text)
  assert.equal(result.summary, '保留 ,] 和 ,} 与 "引号"')
  assert.equal(result.tasks[0]!.note, '代码 ,]')
})

test('invisible field separators are removed while the same characters in source text survive', () => {
  const result = parseCoachDraft('\ufeff{"summary":"原文\u200b不可改",\u200b"tasks":[],\u2060"appointments":[]}')
  assert.equal(result.summary, '原文\u200b不可改')
  assert.deepEqual(result.tasks, [])
})

test('unescaped prose quotes use the existing review parser repair', () => {
  const result = parseCoachDraft('{"summary":"先做"投资学"，再做高微","tasks":[]}')
  assert.equal(result.summary, '先做"投资学"，再做高微')
})

test('domain-invalid priorities are sent back for model repair instead of silently changing urgency', () => {
  assert.throws(() => parseCoachDraft('{"summary":"学习","tasks":[{"title":"高微","category":"study","priority":4}]}'), error => {
    const issues = (error as any).issues
    return issues?.some((issue: any) => issue.path.join('.') === 'tasks.0.priority' && issue.maximum === 3)
  })
})

test('duplicated property syntax needs a targeted model repair rather than a guessed event', () => {
  assert.throws(() => parseCoachDraft('{"summary":"安排","appointments":[{"date":"date":"2026-10-03"}]}'), SyntaxError)
})

test('quoted future minutes are normalized without weakening actual training validation', () => {
  const event = { title: '投资学作业', date: '2026-10-03', category: 'study', startMinute: '510', endMinute: '630', evidence: '明天早上做投资学' }
  const plan = parseCoachDraft(JSON.stringify({ summary: '明天投资学', appointments: [event] }))
  assert.equal(plan.appointments[0]!.startMinute, 510)
  assert.equal(plan.appointments[0]!.endMinute, 630)
  assert.throws(() => parseCoachDraft(JSON.stringify({ summary: '训练', gymLogs: [{ date: '2026-10-02', evidence: '今天卧推', exercises: [{ name: '卧推', part: 'chest', evidence: '今天卧推', sets: [{ reps: '10', weight: 40 }] }] }] })))
})

test('deterministic time fitting corrects a soft late estimate without another model call', () => {
  const event = { date: '2026-10-03', title: '视频学习', category: 'study', startMinute: 1365, endMinute: 1440,
    evidence: '明天晚上看学习视频', timeBasis: 'estimated' }
  const result = parseCoachDraft(JSON.stringify({ summary: '学习', appointments: [event] }),
    { date: '2026-10-02', minute: 600, replaceConflicts: true, days: [], minMinute: 420, maxMinute: 1350 })
  assert(result.appointments[0]!.endMinute <= 1350)
  assert.equal(result.appointments[0]!.endMinute - result.appointments[0]!.startMinute, 75)
  const explicit = parseCoachDraft(JSON.stringify({ summary: '明确时间', appointments: [{ ...event, endMinute: 1425, evidence: '明天22:45–23:45看学习视频', timeBasis: 'explicit' }] }),
    { date: '2026-10-02', minute: 600, replaceConflicts: true, days: [], minMinute: 420, maxMinute: 1350 })
  assert.equal(explicit.appointments[0]!.startMinute, 1365)
  assert.equal(explicit.appointments[0]!.endMinute, 1425)
})
