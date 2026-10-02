import { addDays, isoDate, parseIsoDate } from './clock.ts'
import type { LearningUpdateRecord } from './domain.ts'

/** One daily update per item, even when the review describes morning and evening separately. */
export function mergeLearningUpdates(updates: readonly LearningUpdateRecord[]): LearningUpdateRecord[] {
  const merged = new Map<string, LearningUpdateRecord>()
  for (const update of updates) {
    const key = `${update.kind}:${update.ref ?? update.title.replace(/[《》\s]/gu, '').toLowerCase()}`
    const previous = merged.get(key)
    if (!previous || update.mode === 'total') merged.set(key, { ...update })
    else merged.set(key, { ...previous, value: Math.min(100_000, previous.value + update.value) })
  }
  return [...merged.values()]
}

/**
 * Learning outside class accumulates slowly and unevenly: you read 40 pages on
 * Sunday and none on Monday. Nothing about it is worth storing as deltas, which
 * double-count when you edit today twice and lose entries when a write fails.
 *
 * Both reading and learning therefore keep **one cumulative value per day** —
 * "where the counter stood when this day ended". Every number the page shows is
 * derived from those snapshots by the functions below, so nothing can drift.
 */

export interface ValuePoint {
  readonly date: string
  readonly value: number
}

export interface Accumulator {
  readonly id: string
  readonly title: string
  readonly log: readonly ValuePoint[]
}

/** Unfinished sorts first, finished last — that is what you want at the top. */
export function statusRank(status: unknown): number {
  return status === 'paused' ? 1 : status === 'done' ? 2 : 0
}

/**
 * The cumulative value that held on `day`: the newest entry at or before it,
 * because snapshots are sparse and skip days you did nothing.
 */
export function valueAt(log: readonly ValuePoint[], day: string): number {
  let found = 0
  for (const entry of log) {
    if (entry.date > day) break
    found = entry.value
  }
  return found
}

/**
 * The counter's value after applying one update on `date`.
 *
 * A `delta` is added to whatever held **before** `date`, not to the current
 * value. That single choice makes the whole thing idempotent: confirming the
 * same review twice recomputes the same total instead of counting the pages
 * twice, and correcting today's entry overwrites it rather than stacking.
 */
export function nextValue(
  log: readonly ValuePoint[],
  date: string,
  mode: 'total' | 'delta',
  value: number,
): number {
  if (mode === 'total') return Math.max(0, Math.round(value))
  return Math.max(0, valueAt(log, previousDay(date)) + Math.round(value))
}

export function previousDay(day: string): string {
  return isoDate(addDays(parseIsoDate(day), -1))
}

/** How much this item moved over `[from, to]`, measured from the day before `from`. */
export function gainOver(log: readonly ValuePoint[], from: string, to: string): number {
  return Math.max(0, valueAt(log, to) - valueAt(log, previousDay(from)))
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  for (let cursor = parseIsoDate(from); isoDate(cursor) <= to; cursor = addDays(cursor, 1)) {
    out.push(isoDate(cursor))
  }
  return out
}

export interface WeekPoint {
  readonly date: string
  readonly reading: number
  readonly learning: number
}

export interface WeekGains {
  readonly reading: { readonly id: string; readonly title: string; readonly gain: number }[]
  readonly learning: { readonly id: string; readonly title: string; readonly gain: number }[]
  readonly daily: WeekPoint[]
  readonly readingPages: number
  readonly learningUnits: number
}

/**
 * Per-item and per-day movement across a range. Pure: give it the items and the
 * dates, get every number on the Learn page back. Nothing reads the clock.
 */
export function weekGains(
  reading: readonly Accumulator[],
  learning: readonly Accumulator[],
  from: string,
  to: string,
): WeekGains {
  const days = eachDay(from, to)
  const readGains = reading.map((item) => ({
    id: item.id,
    title: item.title,
    gain: gainOver(item.log, from, to),
  }))
  const learnGains = learning.map((item) => ({
    id: item.id,
    title: item.title,
    gain: gainOver(item.log, from, to),
  }))

  const daily = days.map((day) => {
    const before = previousDay(day)
    return {
      date: day,
      reading: reading.reduce((sum, item) => sum + Math.max(0, valueAt(item.log, day) - valueAt(item.log, before)), 0),
      learning: learning.reduce((sum, item) => sum + Math.max(0, valueAt(item.log, day) - valueAt(item.log, before)), 0),
    }
  })

  return {
    reading: readGains,
    learning: learnGains,
    daily,
    readingPages: readGains.reduce((sum, entry) => sum + entry.gain, 0),
    learningUnits: learnGains.reduce((sum, entry) => sum + entry.gain, 0),
  }
}

/**
 * Days on end with any reading or learning at all. Ends at `today`: you have not
 * broken a streak by not having read yet today, which matters more than being
 * technically precise about "today counts".
 */
export function activeStreak(reading: readonly Accumulator[], learning: readonly Accumulator[], today: string): number {
  const movedOn = (day: string): boolean =>
    reading.some((item) => valueAt(item.log, day) - valueAt(item.log, previousDay(day)) > 0) ||
    learning.some((item) => valueAt(item.log, day) - valueAt(item.log, previousDay(day)) > 0)

  // Not having read yet today must not read as "streak broken" — otherwise a
  // perfect week looks like zero every morning, which is demoralising and wrong.
  let cursor = parseIsoDate(movedOn(today) ? today : previousDay(today))
  let streak = 0
  for (;; cursor = addDays(cursor, -1)) {
    if (!movedOn(isoDate(cursor))) break
    streak += 1
    if (streak > 999) break
  }
  return streak
}
