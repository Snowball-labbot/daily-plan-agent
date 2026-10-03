import { periodRange, weekdayOf, parseIsoDate } from './clock.ts'
import type { BacklogItemRecord, DayPlanRecord, PeriodRecord, PlanBlockRecord, ReviewRecord, SettingsRecord } from './domain.ts'

export const activeBlock = (block: PlanBlockRecord): boolean => block.disposition !== 'deferred'
export const flexibleBlock = (block: PlanBlockRecord): boolean => !block.locked && !block.appointment && !['course', 'routine'].includes(block.source)

export interface Capacity {
  date: string
  budgetMinutes: number
  plannedMinutes: number
  bufferMinutes: number
  topTasks: string[]
}

export interface AdaptiveResult {
  days: DayPlanRecord[]
  scheduled: { taskId: string; date: string; blockId: string }[]
  waiting: { taskId: string; title: string; reason: string }[]
  capacity: Capacity[]
}

/** Feedback is observational and bounded. Sparse records never change capacity. */
export function personalSignals(plans: readonly DayPlanRecord[], reviews: readonly ReviewRecord[], before: string) {
  const samples = plans.filter((day) => day.date < before).slice(-14)
    .map((day) => day.blocks.filter((block) => flexibleBlock(block) && (block.done || block.executionStatus === 'missed')))
    .filter((blocks) => blocks.length > 0)
  const planned = samples.flat().reduce((sum, block) => sum + block.endMinute - block.startMinute, 0)
  const completed = samples.flat().filter((block) => block.done)
    .reduce((sum, block) => sum + (block.endMinute - block.startMinute) * (block.completionProgress === undefined ? 1 : block.completionProgress / 100), 0)
  const rate = planned === 0 ? null : completed / planned
  const energies = reviews.filter((review) => review.date < before && review.status === 'structured')
    .slice(-7).flatMap((review) => review.structured?.energy == null ? [] : [review.structured.energy])
  const energy = energies.length === 0 ? null : energies.reduce((sum, value) => sum + value, 0) / energies.length
  return {
    sampleDays: samples.length, completionRate: rate, averageEnergy: energy,
    loadFactor: samples.length >= 3 && rate !== null ? Math.max(0.5, Math.min(1, rate + 0.15)) : 1,
    explanation: samples.length < 3 ? '先按你的容量安排；至少 3 天有明确执行反馈后再校准。未打勾不等于未完成。'
      : `根据最近 ${samples.length} 个有明确反馈的日子，已确认任务完成率 ${Math.round((rate ?? 0) * 100)}%；未确认事项不参与容量校准。`,
  }
}

/** Full-length placement: a packed day returns a visible waiting item, never a shortened task. */
export function allocateAdaptive(input: {
  days: readonly DayPlanRecord[]
  tasks: readonly BacklogItemRecord[]
  periods: readonly PeriodRecord[]
  settings: SettingsRecord['planning']
  fromDate: string
  today: string
  currentMinute: number
  dayEndPeriod: number
  gymRestDays?: readonly number[]
  completedGymDates?: readonly string[]
  preparedGymDates?: readonly string[]
  loadFactor?: number
  energy?: number | null
}): AdaptiveResult {
  const periods = input.periods
  const days = input.days.map((day) => ({ ...day, blocks: day.blocks.filter((block) =>
    !block.adaptive || block.done || !activeBlock(block) || day.date < input.fromDate ||
    (day.date === input.today && block.startMinute <= input.currentMinute && block.endMinute > input.currentMinute),
  ) }))
  const scheduled: AdaptiveResult['scheduled'] = []
  const waiting: AdaptiveResult['waiting'] = []
  const capacity: Capacity[] = []
  const reserved = new Set(days.flatMap((day) => day.blocks.filter(activeBlock).flatMap((block) => block.backlogId ? [block.backlogId] : [])))
  const tasks = [...input.tasks].filter((task) => !task.done && task.state !== 'completed' && task.state !== 'cancelled' && !reserved.has(task.id))
    .sort((a, b) => (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || b.priority - a.priority || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))

  for (const day of days) {
    if (day.date < input.fromDate) continue
    const usable = periods.filter((period) => period.index <= input.dayEndPeriod &&
      (day.date !== input.today || period.startMinute >= input.currentMinute))
    const used = new Set<number>()
    for (const block of day.blocks.filter(activeBlock)) {
      for (let p = block.startPeriod; p <= block.endPeriod; p++) used.add(p)
    }
    const freeMinutes = usable.filter((period) => !used.has(period.index))
      .reduce((sum, period) => sum + period.endMinute - period.startMinute, 0)
    const existing = day.blocks.filter((block) => activeBlock(block) && flexibleBlock(block))
    const existingMinutes = existing.reduce((sum, block) => sum + block.endMinute - block.startMinute, 0)
    const energyFactor = input.energy != null && input.energy <= 2 ? 0.65 : 1
    const budget = Math.floor(Math.min(input.settings.dailyFocusMinutes * (input.loadFactor ?? 1) * energyFactor,
      (freeMinutes + existingMinutes) * (1 - input.settings.bufferRatio)))
    let remaining = Math.max(0, budget - existingMinutes)
    let count = existing.length
    const cap: Capacity = { date: day.date, budgetMinutes: budget, plannedMinutes: existingMinutes,
      bufferMinutes: Math.ceil(freeMinutes * input.settings.bufferRatio), topTasks: existing.map((block) => block.title).slice(0, 3) }
    for (const task of tasks) {
      if (reserved.has(task.id) || count >= input.settings.maxDailyTasks) continue
      if (task.notBefore && day.date < task.notBefore) continue
      if (task.learningRef && day.blocks.some((block) => activeBlock(block) && block.learningRef === task.learningRef)) continue
      if (task.dueDate && task.dueDate >= input.fromDate && day.date > task.dueDate) continue
      if (task.gymDate && day.date < task.gymDate) continue
      if (task.gymDate && day.date !== task.gymDate && (input.preparedGymDates ?? []).includes(day.date)) continue
      if (task.category === 'gym' && ((input.gymRestDays ?? []).includes(weekdayOf(parseIsoDate(day.date))) ||
        (input.completedGymDates ?? []).includes(day.date) || day.blocks.some((block) => activeBlock(block) && block.category === 'gym'))) continue
      const preference = task.preferredPeriod ?? (task.category === 'gym' ? input.settings.preferredGymPeriod : input.settings.preferredStudyPeriod)
      const starts = [...usable].sort((a, b) => Math.abs(a.index - preference) - Math.abs(b.index - preference) || a.index - b.index)
      for (const start of starts) {
        const end = start.index + task.estimatePeriods - 1
        if (task.earliestPeriod && start.index < task.earliestPeriod) continue
        if (task.latestPeriod && end > task.latestPeriod) continue
        const span = usable.filter((period) => period.index >= start.index && period.index <= end)
        if (span.length !== task.estimatePeriods || span.some((period) => used.has(period.index))) continue
        if (span.some((period, index) => index > 0 && period.startMinute - (span[index - 1]?.endMinute ?? period.startMinute) > 30)) continue
        const range = periodRange(periods, start.index, end)
        const minutes = range.endMinute - range.startMinute
        if (minutes > remaining) continue
        const block: PlanBlockRecord = {
          schemaVersion: 1, id: `auto:${task.id}:${day.date}`, title: task.title, category: task.category,
          ...(task.lifeArea ? { lifeArea: task.lifeArea } : {}), executionStatus: 'unknown',
          weekday: weekdayOf(parseIsoDate(day.date)), startPeriod: start.index, endPeriod: end, ...range,
          courseId: null, gymDate: task.category === 'gym' ? day.date : null, backlogId: task.id,
          locked: false, source: task.originBlockId ? 'carry' : 'backlog', colorKey: task.colorKey,
          done: false, doneAt: null, carriedFrom: task.originDate ?? null, note: task.note ?? '', adaptive: true,
          learningRef: task.learningRef ?? null, learningKind: task.learningKind ?? null,
        }
        day.blocks.push(block)
        for (let p = start.index; p <= end; p++) used.add(p)
        reserved.add(task.id)
        scheduled.push({ taskId: task.id, date: day.date, blockId: block.id })
        remaining -= minutes; count++; cap.plannedMinutes += minutes
        if (cap.topTasks.length < 3) cap.topTasks.push(task.title)
        break
      }
    }
    capacity.push(cap)
    day.blocks.sort((a, b) => a.startMinute - b.startMinute || a.id.localeCompare(b.id))
  }
  for (const task of tasks) {
    if (reserved.has(task.id)) continue
    waiting.push({ taskId: task.id, title: task.title,
      reason: task.dueDate && task.dueDate < (days.at(-1)?.date ?? input.fromDate)
        ? '截止日前容量不足；保留在任务池，需要减少范围或调整截止日期。'
        : '这段时间没有足够的完整空档或容量；已保留在任务池。' })
  }
  return { days, scheduled, waiting, capacity }
}
