import {
  periodRange,
  type Period,
} from './clock.ts'
import type { CourseRecord, PlanBlockRecord, RoutineRecord } from './domain.ts'
import { generatedBlockId, routineBlockId } from './identity.ts'
import { courseWeekday, type CourseCalendar } from './calendar.ts'
import { PICK_COLORS } from './palette.ts'

export function courseColor(course: Pick<CourseRecord, 'name' | 'colorKey'>): string {
  if (course.colorKey) return course.colorKey
  let hash = 0
  for (const char of course.name) hash = ((hash * 31) + char.charCodeAt(0)) >>> 0
  return PICK_COLORS[hash % PICK_COLORS.length]!
}

export interface Gap {
  readonly startPeriod: number
  readonly endPeriod: number
}

function rangeBlocked(used: ReadonlySet<number>, from: number, to: number): boolean {
  for (let period = from; period <= to; period += 1) {
    if (used.has(period)) return true
  }
  return false
}

function reserve(used: Set<number>, from: number, to: number): void {
  for (let period = from; period <= to; period += 1) used.add(period)
}

export function blockLength(block: PlanBlockRecord): number {
  return block.endPeriod - block.startPeriod + 1
}

/** Contiguous runs of periods not covered by any block, in order. */
export function freeGaps(blocks: readonly PlanBlockRecord[], dayEndPeriod: number): Gap[] {
  const used = new Set<number>()
  for (const block of blocks) reserve(used, block.startPeriod, block.endPeriod)

  const gaps: Gap[] = []
  let start: number | null = null
  for (let period = 1; period <= dayEndPeriod + 1; period += 1) {
    const free = period <= dayEndPeriod && !used.has(period)
    if (free && start === null) start = period
    if (!free && start !== null) {
      gaps.push({ startPeriod: start, endPeriod: period - 1 })
      start = null
    }
  }
  return gaps
}

export function largestGap(gaps: readonly Gap[]): Gap | null {
  let best: Gap | null = null
  for (const gap of gaps) {
    if (best === null || gap.endPeriod - gap.startPeriod > best.endPeriod - best.startPeriod) best = gap
  }
  return best
}

function nearestGap(gaps: readonly Gap[], anchorPeriod: number): Gap {
  let best = gaps[0] as Gap
  let bestDistance = Number.POSITIVE_INFINITY
  for (const gap of gaps) {
    const distance =
      anchorPeriod < gap.startPeriod
        ? gap.startPeriod - anchorPeriod
        : anchorPeriod > gap.endPeriod
          ? anchorPeriod - gap.endPeriod
          : 0
    if (distance < bestDistance) {
      bestDistance = distance
      best = gap
    }
  }
  return best
}

/**
 * Where a drop of `wantPeriods` anchored on `anchorPeriod` should land.
 * Never crosses a locked block, because locked blocks are simply not free.
 * Shrinks to the available run when the request does not fit.
 */
export function snapToGap(
  blocks: readonly PlanBlockRecord[],
  anchorPeriod: number,
  wantPeriods: number,
  dayEndPeriod: number,
): Gap | null {
  const gaps = freeGaps(blocks, dayEndPeriod)
  if (gaps.length === 0) return null
  const containing = gaps.find(
    (gap) => anchorPeriod >= gap.startPeriod && anchorPeriod <= gap.endPeriod,
  )
  const target = containing ?? nearestGap(gaps, anchorPeriod)
  const available = target.endPeriod - target.startPeriod + 1
  const length = Math.max(1, Math.min(wantPeriods, available))
  const start = Math.max(
    target.startPeriod,
    Math.min(anchorPeriod, target.endPeriod - length + 1),
  )
  return { startPeriod: start, endPeriod: start + length - 1 }
}

export function overlaps(from: number, to: number, gap: Gap): boolean {
  return from <= gap.endPeriod && to >= gap.startPeriod
}

/**
 * Move one block and push any colliding movable blocks down into later free
 * space. Locked timetable blocks are immovable walls. Blocks with nowhere to go
 * are left in place rather than dropped — the UI flags the overlap.
 */
export function moveBlock(
  blocks: readonly PlanBlockRecord[],
  blockId: string,
  startPeriod: number,
  endPeriod: number,
  dayEndPeriod: number,
): PlanBlockRecord[] {
  const moving = blocks.find((block) => block.id === blockId)
  if (moving === undefined || moving.locked) return [...blocks]

  const length = endPeriod - startPeriod + 1
  const used = new Set<number>()
  for (const block of blocks) {
    if (block.locked) reserve(used, block.startPeriod, block.endPeriod)
  }
  reserve(used, startPeriod, startPeriod + length - 1)

  const others = blocks
    .filter((block) => !block.locked && block.id !== blockId)
    .sort((left, right) => left.startPeriod - right.startPeriod)

  const packed: PlanBlockRecord[] = []
  for (const other of others) {
    if (!rangeBlocked(used, other.startPeriod, other.endPeriod)) {
      reserve(used, other.startPeriod, other.endPeriod)
      packed.push(other)
      continue
    }
    const otherLength = blockLength(other)
    let candidate = startPeriod + length
    while (
      candidate + otherLength - 1 <= dayEndPeriod &&
      rangeBlocked(used, candidate, candidate + otherLength - 1)
    ) {
      candidate += 1
    }
    if (candidate + otherLength - 1 > dayEndPeriod) {
      packed.push(other)
      continue
    }
    reserve(used, candidate, candidate + otherLength - 1)
    packed.push({ ...other, startPeriod: candidate, endPeriod: candidate + otherLength - 1 })
  }

  // Locked blocks are walls: they inform the collision map but are never pushed,
  // and they must survive the rebuild. They used to be dropped here — `packed`
  // only ever collected non-locked blocks — so dragging any block erased the
  // rest of that day's classes.
  const walls = blocks.filter((block) => block.locked)
  const updated: PlanBlockRecord = { ...moving, startPeriod, endPeriod }
  return [...walls, updated, ...packed].sort(
    (left, right) => left.startPeriod - right.startPeriod || left.id.localeCompare(right.id),
  )
}

/** Grid-based tasks follow periods; explicitly timed appointments keep their clock times. */
export function syncBlockMinutes(
  blocks: readonly PlanBlockRecord[],
  periods: readonly Period[],
): PlanBlockRecord[] {
  return blocks.map((block) => {
    if (block.appointment) return block
    const range = periodRange(periods, block.startPeriod, block.endPeriod)
    return { ...block, startMinute: range.startMinute, endMinute: range.endMinute }
  })
}

export function blockFromCourse(
  course: CourseRecord,
  date: string,
  weekday: number,
  periods: readonly Period[],
): PlanBlockRecord {
  const range = periodRange(periods, course.startPeriod, course.endPeriod)
  return {
    schemaVersion: 1,
    id: generatedBlockId(course.id, date, course.startPeriod),
    title: course.name,
    category: course.category,
    weekday,
    startPeriod: course.startPeriod,
    endPeriod: course.endPeriod,
    startMinute: range.startMinute,
    endMinute: range.endMinute,
    courseId: course.id,
    gymDate: null,
    backlogId: null,
    locked: true,
    source: 'course',
    colorKey: courseColor(course),
    done: false,
    doneAt: null,
    carriedFrom: null,
    note: course.location,
  }
}

export function courseRunsOn(course: CourseRecord, teachingWeek: number | null): boolean {
  if (course.archived) return false
  if (course.weeks.length === 0) return true
  if (teachingWeek === null) return true
  return course.weeks.includes(teachingWeek)
}

export function coursesForDay(
  courses: readonly CourseRecord[],
  weekday: number,
  teachingWeek: number | null,
): CourseRecord[] {
  return courses.filter(
    (course) => course.weekday === weekday && courseRunsOn(course, teachingWeek),
  )
}

export interface GenerateDayInput {
  readonly courseCalendar?: CourseCalendar
  readonly courses: readonly CourseRecord[]
  /** Standing commitments — meals, commute, practice. Empty = classes only. */
  readonly routines: readonly RoutineRecord[]
  readonly date: string
  readonly weekday: number
  readonly teachingWeek: number | null
  readonly periods: readonly Period[]
  readonly dayEndPeriod: number
}

/** Enabled routines that land on this weekday. Empty `weekdays` means every day. */
export function routinesForDay(
  routines: readonly RoutineRecord[],
  weekday: number,
): RoutineRecord[] {
  return routines.filter(
    (routine) =>
      routine.enabled && (routine.weekdays.length === 0 || routine.weekdays.includes(weekday)),
  )
}

function blockFromRoutine(
  routine: RoutineRecord,
  date: string,
  weekday: number,
  periods: readonly Period[],
): PlanBlockRecord {
  const range = periodRange(periods, routine.startPeriod, routine.endPeriod)
  return {
    schemaVersion: 1,
    id: routineBlockId(routine.id, date),
    title: routine.title,
    category: routine.category,
    weekday,
    startPeriod: routine.startPeriod,
    endPeriod: routine.endPeriod,
    startMinute: range.startMinute,
    endMinute: range.endMinute,
    courseId: null,
    gymDate: null,
    backlogId: null,
    locked: false,
    source: 'routine',
    colorKey: routine.colorKey,
    done: false,
    doneAt: null,
    carriedFrom: null,
    note: '',
  }
}

/**
 * Timetable skeleton plus standing routines.
 *
 * No gym slot: the user schedules training themselves, either as a routine or
 * by dragging the block the gym page creates. Guessing "you should train at
 * 21:00 on Tuesday" is exactly the kind of decision this tool is here to remove,
 * and a wrong guess sits in the calendar looking like a commitment.
 *
 * Routines that collide with a class are **skipped rather than moved**: a meal
 * that silently slides to 15:00 is worse than one that is visibly absent, and
 * the user placed it deliberately.
 */
export function generateDayBlocks(input: GenerateDayInput): PlanBlockRecord[] {
  const classDay = courseWeekday(input.date, input.weekday, input.courseCalendar)
  const eligible = input.courses.filter((course) => courseRunsOn(course, input.teachingWeek) && course.weekday === (course.kind === 'fixed' ? input.weekday : classDay))
  const blocks = eligible.map((course) =>
    blockFromCourse(course, input.date, input.weekday, input.periods),
  )

  const used = new Set<number>()
  for (const block of blocks) reserve(used, block.startPeriod, block.endPeriod)
  for (const routine of routinesForDay(input.routines, input.weekday)) {
    if (rangeBlocked(used, routine.startPeriod, routine.endPeriod)) continue
    reserve(used, routine.startPeriod, routine.endPeriod)
    blocks.push(blockFromRoutine(routine, input.date, input.weekday, input.periods))
  }

  return blocks.sort(
    (left, right) => left.startPeriod - right.startPeriod || left.id.localeCompare(right.id),
  )
}

export function dateRelations(from: string, to: string): 'before' | 'same' | 'after' {
  if (from === to) return 'same'
  return from < to ? 'before' : 'after'
}
