import type { WorkflowDraft, PlanBlockRecord } from './domain.ts'

const DIGITS = '零〇一二两三四五六七八九十'
const NUMBER = `[0-9${DIGITS}]{1,3}`
function number(text: string): number {
  if (/^\d+$/u.test(text)) return Number(text)
  const digit = (char: string) => '零一二三四五六七八九'.indexOf(char.replace('〇', '零').replace('两', '二'))
  if (text.includes('十')) {
    const [left, right] = text.split('十')
    return (left ? digit(left) : 1) * 10 + (right ? digit(right) : 0)
  }
  return digit(text)
}

/** Distinguish explicit times from estimates; estimates are intentions, never facts. */
export function hasAppointmentTimeEvidence(evidence: string, startMinute: number, endMinute: number): boolean {
  // Also accept abbreviated ranges such as 14–16点 and 9:00–10:30.
  const expanded = evidence.replace(new RegExp(`(${NUMBER})\\s*(?:到|至|[-–—~～])\\s*(${NUMBER})(点|时)`, 'gu'), '$1点到$2$3')
  const clocks = [...expanded.matchAll(new RegExp(`(${NUMBER})(?:[:：]([0-9]{2})|点(?:(半|一刻|三刻)|\\s*(${NUMBER})分?)?|时(?!间|长))`, 'gu'))].map((match) => {
    const hour = number(match[1]!)
    const minute = match[2] ? Number(match[2]) : match[4] ? number(match[4]) : match[3] === '半' ? 30 : match[3] === '一刻' ? 15 : match[3] === '三刻' ? 45 : 0
    if (hour > 23 || minute > 59 || hour < 0 || minute < 0) return []
    const prefix = expanded.slice(0, match.index).slice(-10)
    const period = [...prefix.matchAll(/上午|早上|早晨|凌晨|下午|晚上|傍晚|中午|今晚/gu)].at(-1)?.[0]
    const base = hour * 60 + minute
    if (hour >= 13) return [base]
    if (period && ['下午', '晚上', '傍晚', '今晚'].includes(period)) return [(hour % 12 + 12) * 60 + minute]
    if (period && ['上午', '早上', '早晨', '凌晨'].includes(period)) return [base]
    // An unqualified four o'clock can follow an explicitly qualified afternoon two.
    return [...new Set([base, (hour % 12 + 12) * 60 + minute])]
  })
  if (clocks.some((clock, index) => clock.includes(startMinute) && clocks.slice(index + 1).some((end) => end.includes(endMinute)))) return true
  if (!clocks.some((clock) => clock.includes(startMinute))) return false
  const durations = [...expanded.matchAll(new RegExp(`(${NUMBER}(?:\\.[0-9]+)?)\\s*(?:个)?(小时|分钟)`, 'gu'))]
    .map((match) => (match[1]!.includes('.') ? Number(match[1]) : number(match[1]!)) * (match[2] === '小时' ? 60 : 1))
  return durations.includes(endMinute - startMinute)
}

/** Sanitize both new AI output and older saved drafts before showing/applying them. */
export function normalizeAppointmentEvidence(draft: WorkflowDraft): WorkflowDraft {
  const appointments = draft.appointments.map((event) => {
    const explicit = hasAppointmentTimeEvidence(event.evidence, event.startMinute, event.endMinute)
    const estimated = !explicit || event.timeBasis === 'estimated' || /大概|左右|可能|约莫/u.test(event.evidence)
    return { ...event, needsTimeConfirmation: false, timeBasis: event.timeBasis === 'manual' ? 'manual' as const : estimated ? 'estimated' as const : 'explicit' as const,
      timeAssumption: estimated ? event.timeAssumption || `暂按 ${event.endMinute - event.startMinute} 分钟预留，可修改时间；${/可能|也许/u.test(event.evidence) ? '这项活动尚未确定。' : '未明确的时段由 Agnes 估算。'}` : '' }
  })
  const obsolete = (question: string) => appointments.some((event) => question.includes(event.title) && /起止时间|预计持续|结束时间|持续到几点/u.test(question))
  const questions = draft.questions.filter((question) => !obsolete(question))
  const oldSummary = /不使用 AI 估算|尚未写入日程|不擅定时长/u.test(draft.summary)
  return { ...draft, appointments, questions, summary: oldSummary ? '已按你的描述安排活动，其他目标按容量安排。时间和描述都可以直接修改。' : draft.summary }
}

/** Repair representation errors only at the model boundary, before strict validation. */
export function normalizeCoachOutput(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input
  const value = { ...input } as Record<string, unknown>
  if (typeof value.gymAdvice === 'string') value.gymAdvice = value.gymAdvice.trim() ? [value.gymAdvice] : []
  if (value.gymAdvice === null) value.gymAdvice = []
  if (Array.isArray(value.appointments)) value.appointments = value.appointments.map((item: unknown) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item
    const event = { ...item } as Record<string, unknown>
    // JSON numbers quoted by the model have an unambiguous representation.
    // Restrict this to future clock fields; actual repetitions remain strict.
    for (const field of ['startMinute', 'endMinute']) {
      if (typeof event[field] === 'string' && /^\d{1,4}$/u.test(event[field].trim())) event[field] = Number(event[field])
    }
    const raw = `${event.title ?? ''} ${event.evidence ?? ''}`
    const duration = /饭|餐/u.test(raw) ? 120 : /酒|drink|bar/iu.test(raw) ? 90 : /健身|训练/u.test(raw) ? 75 : 60
    const missingStart = event.startMinute == null
    const missingEnd = event.endMinute == null
    // Explicit clocks should normally be extracted by Agnes. This fallback handles
    // a missing time rather than rejecting the entire user's paragraph.
    if (missingStart) {
      const match = new RegExp(`(?:(上午|早上|下午|晚上|傍晚|中午)\\s*)?(${NUMBER})(?:[:：]([0-9]{2})|点(?:(半)|(${NUMBER})分?)?)`, 'u').exec(String(event.evidence ?? ''))
      if (match) { const hour = number(match[2]!); event.startMinute = ((match[1] && /下午|晚上|傍晚/u.test(match[1]) && hour < 12 ? hour + 12 : hour) * 60) + (match[3] ? Number(match[3]) : match[4] ? 30 : match[5] ? number(match[5]) : 0) }
      else event.startMinute = /晚上|今晚|酒|drink/iu.test(raw) ? 20 * 60 : /下午/u.test(raw) ? 14 * 60 : /中午/u.test(raw) ? 12 * 60 : 9 * 60
    }
    if (missingEnd && typeof event.startMinute === 'number' && event.startMinute >= 0 && event.startMinute < 1440) event.endMinute = Math.min(1440, event.startMinute + duration)
    if (missingStart || missingEnd) {
      event.timeBasis = 'estimated'
      event.timeAssumption = `未明确${missingStart ? '开始时间' : ''}${missingStart && missingEnd ? '与' : ''}${missingEnd ? '结束时间' : ''}，按活动类型预留 ${typeof event.endMinute === 'number' && typeof event.startMinute === 'number' ? event.endMinute - event.startMinute : duration} 分钟，可微调。`
    }
    return event
  })
  return value
}

/** Place estimated intentions in available time; never move an explicit time or fact. */
export interface AppointmentPlanningContext {
  date: string; minute: number; replaceConflicts: boolean;
  days: readonly { date: string; blocks: readonly PlanBlockRecord[] }[];
  minMinute: number; maxMinute: number;
}

export function fitEstimatedAppointments(draft: WorkflowDraft, input: AppointmentPlanningContext): WorkflowDraft {
  const placed: WorkflowDraft['appointments'] = []
  const fixed = draft.appointments.filter((event) => event.timeBasis !== 'estimated')
  const appointments = draft.appointments.map((event) => {
    if (event.timeBasis !== 'estimated') { placed.push(event); return event }
    const duration = event.endMinute - event.startMinute
    const dayPart = /晚上|今晚|晚间|夜里/u.test(event.evidence) ? 18 * 60 : /下午|傍晚/u.test(event.evidence) ? 12 * 60 : /中午/u.test(event.evidence) ? 11 * 60 : 0
    const latest = /早上|早晨|上午/u.test(event.evidence) ? Math.min(input.maxMinute, 12 * 60) : input.maxMinute
    // A soft time is still a preference: don't put an evening drink at breakfast
    // merely because breakfast has space. Large changes require clarification.
    const lower = Math.max(input.minMinute, dayPart, event.startMinute - 120, event.date === input.date ? Math.ceil(input.minute / 5) * 5 : 0)
    const blocked = [
      ...(input.days.find((day) => day.date === event.date)?.blocks ?? []).filter((block) => block.disposition !== 'deferred' &&
        (block.locked || block.done || block.executionStatus === 'completed' || ['course', 'routine'].includes(block.source) ||
          (!input.replaceConflicts && !block.adaptive) || (event.date === input.date && block.startMinute <= input.minute && block.endMinute > input.minute))),
      ...fixed.filter((other) => other !== event && other.date === event.date), ...placed.filter((other) => other.date === event.date),
    ]
    const available = (start: number) => start >= lower && start <= event.startMinute + 120 && start + duration <= latest &&
      !blocked.some((other) => other.startMinute < start + duration && other.endMinute > start)
    let start = Math.max(lower, event.startMinute)
    if (!available(start)) {
      const candidates = new Set([lower, ...blocked.map((other) => other.endMinute + 15)])
      const fit = [...candidates].filter(available).sort((a, b) => Math.abs(a - event.startMinute) - Math.abs(b - event.startMinute) || a - b)[0]
      if (fit === undefined) { placed.push(event); return event } // Explicit conflict error at apply; no hidden loss.
      start = fit
    }
    const next = start === event.startMinute ? event : { ...event, startMinute: start, endMinute: start + duration,
      timeAssumption: `${event.timeAssumption ?? ''} 已避开固定安排、已开始时段或其他新活动。`.slice(0, 500) }
    placed.push(next); return next
  })
  return { ...draft, appointments }
}

/** Feed unresolved estimated times back into model repair before showing a draft. */
export function validateEstimatedAppointmentWindow(draft: WorkflowDraft, input: AppointmentPlanningContext): void {
  const hm = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
  const issues = draft.appointments.flatMap((event, index) => {
    if (event.timeBasis !== 'estimated') return []
    const earliest = Math.max(input.minMinute, event.date === input.date ? input.minute : 0)
    if (event.startMinute >= earliest && event.endMinute <= input.maxMinute) return []
    return [{ path: ['appointments', index, event.startMinute < earliest ? 'startMinute' : 'endMinute'],
      message: `「${event.title}」的推算时段 ${hm(event.startMinute)}–${hm(event.endMinute)} 超出当天可安排时间 ${hm(earliest)}–${hm(input.maxMinute)}。请根据原文顺序和 planningDays 重新调整推算时段，避开固定安排；保留用户明确的时间和所有活动意图。容量不足的弹性目标保留在 tasks 并说明取舍，不改变用户作息，也不编造实际完成。` }]
  })
  if (issues.length) throw Object.assign(new Error(issues.map(issue => issue.message).join('\n')), { issues })
}
