import type { BodyPartValue, GymItemRecord, GymSessionRecord } from './domain.ts'

export interface FocusSuggestion {
  readonly focus: BodyPartValue[]
  readonly reason: string
}

/** Next part in the user's rotation after the last one actually trained. */
export function nextPart(
  current: BodyPartValue | null,
  rotation: readonly BodyPartValue[],
): BodyPartValue | null {
  if (rotation.length === 0) return null
  if (current === null) return rotation[0] ?? null
  const index = rotation.indexOf(current)
  if (index < 0) return rotation[0] ?? null
  return rotation[(index + 1) % rotation.length] ?? null
}

function sortedSessions(history: readonly GymSessionRecord[]): GymSessionRecord[] {
  return [...history].sort((left, right) => right.date.localeCompare(left.date))
}

function lastTrainedPart(history: readonly GymSessionRecord[]): BodyPartValue | null {
  for (const session of sortedSessions(history)) {
    const first = session.focus[0] ?? session.items[0]?.part
    if (first !== undefined) return first
  }
  return null
}

export function suggestFocus(options: {
  readonly history: readonly GymSessionRecord[]
  readonly rotation: readonly BodyPartValue[]
  readonly restDays: readonly number[]
  readonly weekday: number
}): FocusSuggestion {
  if (options.restDays.includes(options.weekday)) {
    return { focus: [], reason: 'rest' }
  }
  if (options.rotation.length === 0) {
    return { focus: [], reason: 'empty-rotation' }
  }
  const last = lastTrainedPart(options.history)
  const next = nextPart(last, options.rotation)
  if (next === null) return { focus: [], reason: 'empty-rotation' }
  return { focus: [next], reason: last === null ? 'start' : 'rotation' }
}

/** Rotate the suggestion forward once, used by the "next part" button. */
export function rotateFocus(
  current: readonly BodyPartValue[],
  rotation: readonly BodyPartValue[],
): BodyPartValue[] {
  const next = nextPart(current[0] ?? null, rotation)
  return next === null ? [...current] : [next]
}

/** Most recent session that trained this part. */
export function lastSessionForPart(
  history: readonly GymSessionRecord[],
  part: BodyPartValue,
): GymSessionRecord | undefined {
  return sortedSessions(history).find(
    (session) => session.focus.includes(part) || session.items.some((item) => item.part === part),
  )
}

/** Copy the template session's items with fresh ids and a reset checklist. */
export function reuseSessionItems(
  session: GymSessionRecord,
  part: BodyPartValue | null,
  makeId: (index: number) => string,
): GymItemRecord[] {
  const source = part === null ? session.items : session.items.filter((item) => item.part === part)
  const picked = source.length > 0 ? source : session.items
  return picked.map((item, index) => ({
    ...item,
    id: makeId(index),
    doneSets: 0,
    note: '',
    actualSets: [],
  }))
}

export function totalSets(items: readonly GymItemRecord[]): number {
  return items.reduce((sum, item) => sum + item.sets, 0)
}

export function loggedSets(items: readonly GymItemRecord[]): number {
  return items.reduce((sum, item) => sum + ((item.actualSets?.length ?? 0) > 0 ? item.actualSets!.length : Math.min(item.doneSets, item.sets)), 0)
}

export function sessionProgress(items: readonly GymItemRecord[]): {
  readonly logged: number
  readonly total: number
} {
  return { logged: loggedSets(items), total: totalSets(items) }
}

/** Only actual set logs form performance history. Planned weights and checkmarks are not measurements. */
export function gymProgress(history: readonly GymSessionRecord[]) {
  const groups = new Map<string, { exerciseId: string; name: string; part: BodyPartValue; points: {
    date: string; sets: number; reps: number; maxWeightKg: number | null; volumeKg: number | null; averageRir: number | null;
  }[] }>()
  for (const session of [...history].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const item of session.items) {
      const sets = item.actualSets ?? []
      if (sets.length === 0) continue
      const group = groups.get(item.exerciseId) ?? { exerciseId: item.exerciseId, name: item.name, part: item.part, points: [] }
      const weights = sets.map((set) => set.weight === null || set.unit === 'bodyweight' ? null : set.weight * (set.unit === 'lb' ? 0.45359237 : 1))
      const known = weights.filter((weight): weight is number => weight !== null)
      const rirs = sets.flatMap((set) => set.rir === null ? [] : [set.rir])
      const point = { date: session.date, sets: sets.length, reps: sets.reduce((sum, set) => sum + set.reps, 0),
        maxWeightKg: known.length === 0 ? null : Math.round(Math.max(...known) * 10) / 10,
        volumeKg: weights.every((weight) => weight !== null) ? Math.round(sets.reduce((sum, set, index) => sum + (weights[index] ?? 0) * set.reps, 0)) : null,
        averageRir: rirs.length === 0 ? null : Math.round(rirs.reduce((sum, value) => sum + value, 0) / rirs.length * 10) / 10 }
      const previous = group.points.find((entry) => entry.date === session.date)
      if (previous) {
        previous.sets += point.sets; previous.reps += point.reps
        previous.maxWeightKg = previous.maxWeightKg === null ? point.maxWeightKg : point.maxWeightKg === null ? previous.maxWeightKg : Math.max(previous.maxWeightKg, point.maxWeightKg)
        previous.volumeKg = previous.volumeKg === null || point.volumeKg === null ? null : previous.volumeKg + point.volumeKg
        previous.averageRir = null // Mixed exercises on the same day need set-weighted aggregation; omit rather than mislead.
      } else group.points.push(point)
      groups.set(item.exerciseId, group)
    }
  }
  return [...groups.values()]
}
/** Explicit “record set” action uses the single row editor; ranges remain plans. */
export function gymSetFromFields(repsText: string, weightText: string): { reps: number; weight: number | null; unit: 'kg' | 'lb' | 'bodyweight'; rir: null } | null {
  const reps = Number(repsText.trim())
  if (!/^\d+$/.test(repsText.trim()) || !Number.isInteger(reps) || reps < 1 || reps > 500) return null
  const text = weightText.trim()
  if (text === '' || text === '—') return { reps, weight: null, unit: 'kg', rir: null }
  if (/^(自重|bodyweight)$/i.test(text)) return { reps, weight: null, unit: 'bodyweight', rir: null }
  const match = /^(\d+(?:\.\d+)?)\s*(kg|公斤|千克|lb|磅)?$/i.exec(text)
  if (!match || Number(match[1]) > 1000) return null
  return { reps, weight: Number(match[1]), unit: /^(lb|磅)$/i.test(match[2] ?? '') ? 'lb' : 'kg', rir: null }
}
