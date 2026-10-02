import { addDays, isoDate, parseIsoDate, todayIso as todayIsoOf } from './clock.ts'
import type { DayPlanRecord, GymSessionRecord, ReviewRecord } from './domain.ts'

/** -1 nothing planned / future · 0 planned but none done · 1..4 completion bands */
export type HeatLevel = -1 | 0 | 1 | 2 | 3 | 4

export interface DayStat {
  readonly date: string
  readonly planned: number
  readonly done: number
  readonly ratio: number
  readonly level: HeatLevel
  readonly hasReview: boolean
  readonly gymDone: boolean
  readonly unknown?: number
}

export interface StatOptions {
  readonly countCourseBlocks: boolean
  readonly todayIso: string
}

export function levelOf(ratio: number, planned: number): HeatLevel {
  if (planned === 0) return -1
  if (ratio <= 0) return 0
  if (ratio <= 0.33) return 1
  if (ratio <= 0.66) return 2
  if (ratio <= 0.99) return 3
  return 4
}

export function computeDayStat(
  date: string,
  plan: DayPlanRecord | undefined,
  session: GymSessionRecord | undefined,
  review: ReviewRecord | undefined,
  options: StatOptions,
): DayStat {
  const gymDone = session !== undefined && session.finishedAt !== null
  if (date > options.todayIso) {
    return { date, planned: 0, done: 0, ratio: 0, level: -1, hasReview: review !== undefined, gymDone }
  }

  const blocks = plan?.blocks ?? []
  const counted = options.countCourseBlocks ? blocks : blocks.filter((block) => !block.locked)
  const planned = counted.length
  const done = counted.filter((block) => block.done).length
  const unknown = counted.filter((block) => !block.done && block.executionStatus !== 'missed').length
  const ratio = planned === 0 ? 0 : done / planned

  return {
    date,
    planned,
    done,
    ratio,
    level: planned > 0 && unknown === planned ? -1 : levelOf(ratio, planned),
    unknown,
    hasReview: review !== undefined && review.raw.text.trim() !== '',
    gymDone,
  }
}

/** A dense run of DayStats covering [from, to] inclusive. */
export function buildRange(
  from: string,
  to: string,
  plans: ReadonlyMap<string, DayPlanRecord>,
  sessions: ReadonlyMap<string, GymSessionRecord>,
  reviews: ReadonlyMap<string, ReviewRecord>,
  options: { countCourseBlocks: boolean; now?: Date },
): DayStat[] {
  const today = todayIsoOf(options.now ?? new Date())
  const out: DayStat[] = []
  for (let cursor = parseIsoDate(from); cursor.getTime() <= parseIsoDate(to).getTime(); cursor = addDays(cursor, 1)) {
    const date = isoDate(cursor)
    out.push(
      computeDayStat(date, plans.get(date), sessions.get(date), reviews.get(date), {
        countCourseBlocks: options.countCourseBlocks,
        todayIso: today,
      }),
    )
  }
  return out
}

/** Columns = ISO weeks (Monday first), rows = weekdays. Like GitHub's graph. */
export function buildWeekGrid(stats: readonly DayStat[], weeks = 53): DayStat[][] {
  if (stats.length === 0) return []
  const byDate = new Map(stats.map((stat) => [stat.date, stat]))
  const first = stats[0] as DayStat
  const last = stats.at(-1) as DayStat
  const endMonday = mondayOfIso(last.date)
  const startMonday = addDays(endMonday, -(weeks - 1) * 7)
  const fallback = first

  const grid: DayStat[][] = []
  for (let week = 0; week < weeks; week += 1) {
    const column: DayStat[] = []
    for (let day = 0; day < 7; day += 1) {
      const date = isoDate(addDays(startMonday, week * 7 + day))
      column.push(byDate.get(date) ?? { ...fallback, date, planned: 0, done: 0, unknown: 0, ratio: 0, level: -1 })
    }
    grid.push(column)
  }
  return grid
}

/** Month labels sit on the first column whose Monday starts a new month. */
export function monthMarkers(grid: readonly DayStat[][]): { column: number; label: string }[] {
  const markers: { column: number; label: string }[] = []
  let lastMonth = -1
  let lastColumn = -99
  grid.forEach((column, index) => {
    const head = column[0]
    if (head === undefined) return
    const month = parseIsoDate(head.date).getMonth()
    if (month === lastMonth) return
    lastMonth = month
    // Skip labels that would collide with the previous one.
    if (index - lastColumn < 3) return
    lastColumn = index
    markers.push({ column: index, label: `${String(month + 1)}月` })
  })
  return markers
}

export interface StatsSummary {
  readonly totalDone: number
  readonly perfectDays: number
  readonly currentStreak: number
  readonly longestStreak: number
  readonly gymSessions: number
  readonly reviewDays: number
  readonly plannedDays: number
  readonly monthDone: number
  readonly monthPlanned: number
  readonly monthRate: number
}

function isQualified(stat: DayStat, threshold: number): boolean | null {
  // null = neutral day: nothing was planned, so it neither counts nor breaks.
  if (stat.planned === 0) return null
  if ((stat.unknown ?? 0) > 0) return null
  return stat.ratio >= threshold
}

export function summarize(
  stats: readonly DayStat[],
  options: { threshold: number; todayIso: string },
): StatsSummary {
  const sorted = [...stats].sort((left, right) => left.date.localeCompare(right.date))
  let totalDone = 0
  let perfectDays = 0
  let gymSessions = 0
  let reviewDays = 0
  let plannedDays = 0

  for (const stat of sorted) {
    totalDone += stat.done
    if (stat.level === 4) perfectDays += 1
    if (stat.gymDone) gymSessions += 1
    if (stat.hasReview) reviewDays += 1
    if (stat.planned > 0) plannedDays += 1
  }

  let longestStreak = 0
  let running = 0
  for (const stat of sorted) {
    const qualified = isQualified(stat, options.threshold)
    if (qualified === null) continue
    if (qualified) {
      running += 1
      longestStreak = Math.max(longestStreak, running)
    } else {
      running = 0
    }
  }

  let currentStreak = 0
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const stat = sorted[index]
    if (stat === undefined) break
    const qualified = isQualified(stat, options.threshold)
    if (qualified === null) continue
    if (qualified) {
      currentStreak += 1
      continue
    }
    // Today is still in progress — it must not break yesterday's streak.
    if (stat.date === options.todayIso) continue
    break
  }

  const monthPrefix = options.todayIso.slice(0, 7)
  let monthDone = 0
  let monthPlanned = 0
  for (const stat of sorted) {
    if (!stat.date.startsWith(monthPrefix)) continue
    monthDone += stat.done
    monthPlanned += stat.planned
  }

  return {
    totalDone,
    perfectDays,
    currentStreak,
    longestStreak,
    gymSessions,
    reviewDays,
    plannedDays,
    monthDone,
    monthPlanned,
    monthRate: monthPlanned === 0 ? 0 : monthDone / monthPlanned,
  }
}

function mondayOfIso(date: string): Date {
  const parsed = parseIsoDate(date)
  const weekday = ((parsed.getDay() + 6) % 7) + 1
  return addDays(parsed, -(weekday - 1))
}
