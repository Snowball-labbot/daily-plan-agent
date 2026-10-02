/**
 * Date / period arithmetic. Everything is local wall-clock time in the profile's
 * time zone (Asia/Shanghai) — the user is in one zone, so we deliberately avoid
 * pulling in a date library.
 */

export interface Period {
  readonly index: number
  readonly startMinute: number
  readonly endMinute: number
  readonly label: string
}

const DAY_MS = 86_400_000
const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六'] as const

export function isoDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

export function parseIsoDate(value: string): Date {
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (parts === null) throw new Error(`invalid date '${value}'`)
  return new Date(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function addDays(date: Date, days: number): Date {
  const next = startOfDay(date)
  next.setDate(next.getDate() + days)
  return next
}

/** 1 = Monday … 7 = Sunday */
export function weekdayOf(date: Date): number {
  return ((date.getDay() + 6) % 7) + 1
}

export function mondayOf(date: Date): Date {
  return addDays(date, -(weekdayOf(date) - 1))
}

export function weekdayZh(date: Date): string {
  return WEEKDAY_ZH[date.getDay()] ?? ''
}

export function todayIso(now = new Date()): string {
  return isoDate(now)
}

export function nowMinute(now = new Date()): number {
  return now.getHours() * 60 + now.getMinutes()
}

/** ISO-8601 week key, e.g. `2026-W38`. */
export function isoWeekKey(date: Date): string {
  const target = startOfDay(date)
  const thursday = addDays(target, 4 - weekdayOf(target))
  const year = thursday.getFullYear()
  const jan1 = new Date(year, 0, 1)
  const days = Math.round((thursday.getTime() - jan1.getTime()) / DAY_MS)
  const week = Math.floor(days / 7) + 1
  return `${String(year)}-W${String(week).padStart(2, '0')}`
}

export function isWeekKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-W\d{2}$/.test(value)
}

export function mondayOfWeekKey(weekKey: string): Date {
  const parts = /^(\d{4})-W(\d{2})$/.exec(weekKey)
  if (parts === null) throw new Error(`invalid week key '${weekKey}'`)
  const year = Number(parts[1])
  const week = Number(parts[2])
  // ISO: week 1 is the week containing Jan 4th.
  return addDays(mondayOf(new Date(year, 0, 4)), (week - 1) * 7)
}

export function weekDates(weekKey: string): string[] {
  const monday = mondayOfWeekKey(weekKey)
  return Array.from({ length: 7 }, (_, offset) => isoDate(addDays(monday, offset)))
}

export function shiftWeekKey(weekKey: string, weeks: number): string {
  return isoWeekKey(addDays(mondayOfWeekKey(weekKey), weeks * 7))
}

export function formatHm(minute: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(minute)))
  const hours = Math.floor(clamped / 60)
  const minutes = clamped % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function parseHm(value: string): number {
  const parts = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (parts === null) throw new Error(`invalid time '${value}'`)
  const hours = Number(parts[1])
  const minutes = Number(parts[2])
  if (hours > 23 || minutes > 59) throw new Error(`invalid time '${value}'`)
  return hours * 60 + minutes
}

export function periodByIndex(periods: readonly Period[], index: number): Period | undefined {
  return periods.find((period) => period.index === index)
}

/** Minute range covered by periods [startPeriod .. endPeriod] inclusive. */
export function periodRange(
  periods: readonly Period[],
  startPeriod: number,
  endPeriod: number,
): { readonly startMinute: number; readonly endMinute: number } {
  const first = periodByIndex(periods, startPeriod) ?? periods[0]
  const last = periodByIndex(periods, endPeriod) ?? periods.at(-1)
  if (first === undefined || last === undefined) {
    throw new Error('period table is empty')
  }
  return { startMinute: first.startMinute, endMinute: last.endMinute }
}

/** Which period contains this minute, or null when between/after periods. */
export function periodAtMinute(periods: readonly Period[], minute: number): number | null {
  for (const period of periods) {
    if (minute >= period.startMinute && minute < period.endMinute) return period.index
  }
  return null
}

/** Nearest period index for a minute, clamped into range. */
export function nearestPeriod(periods: readonly Period[], minute: number): number {
  if (periods.length === 0) return 1
  let best = periods[0] as Period
  let bestDistance = Number.POSITIVE_INFINITY
  for (const period of periods) {
    const distance =
      minute < period.startMinute
        ? period.startMinute - minute
        : minute > period.endMinute
          ? minute - period.endMinute
          : 0
    if (distance < bestDistance) {
      bestDistance = distance
      best = period
    }
  }
  return best.index
}

/** Teaching week number (1-based) relative to the term start, or null when before it. */
export function teachingWeek(termStart: string, date: Date): number | null {
  if (termStart === '') return null
  const start = parseIsoDate(termStart)
  const diff = Math.round((mondayOf(date).getTime() - mondayOf(start).getTime()) / DAY_MS)
  const week = Math.floor(diff / 7) + 1
  return week < 1 ? null : week
}

/** Inclusive list of dates between two ISO dates. */
export function dateRange(from: string, to: string): string[] {
  const start = parseIsoDate(from)
  const end = parseIsoDate(to)
  const out: string[] = []
  for (let cursor = start; cursor.getTime() <= end.getTime(); cursor = addDays(cursor, 1)) {
    out.push(isoDate(cursor))
  }
  return out
}
