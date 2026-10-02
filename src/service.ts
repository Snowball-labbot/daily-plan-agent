import { courseWeekday } from './calendar.ts'
import { normalizeAppointmentEvidence, fitEstimatedAppointments } from './appointmentEvidence.ts'
import { courseColor } from './plan.ts'
import type { Context } from '@deepseek-ai/cordis'
import {
  addDays,
  formatHm,
  isoDate,
  isoWeekKey,
  parseIsoDate,
  periodRange,
  teachingWeek,
  weekDates,
  weekdayOf,
  weekdayZh,
} from './clock.ts'
import {
  BacklogItemSchema,
  CourseSchema,
  DayPlanSchema,
  ExerciseSchema,
  PlanBlockSchema,
  GymSessionSchema,
  GymSetSchema,
  LearningItemSchema,
  ReadingSchema,
  ReviewSchema,
  SettingsSchema,
  DateSchema,
  WorkflowDraftEditsSchema,
  WorkflowRunSchema,
  PersonalMemorySchema,
  StructuredReviewSchema,
  dailyPlanDomainSpec,
  type BacklogItemRecord,
  type BodyPartValue,
  type CategoryValue,
  type CourseRecord,
  type DayPlanRecord,
  type ExerciseRecord,
  type GymItemRecord,
  type GymSessionRecord,
  type LearningItemRecord,
  type LearningUpdateRecord,
  type PlanBlockRecord,
  type ReadingRecord,
  type ReviewRecord,
  type SettingsRecord,
  type WorkflowRunRecord,
  type PersonalMemoryRecord,
  type GymSetRecord,
} from './domain.ts'
import { generatedBlockId, isPathSafeKey, newId, stableHash } from './identity.ts'
import { activeBlock, flexibleBlock, allocateAdaptive, personalSignals, type AdaptiveResult } from './adaptive.ts'
import { runCoach } from './coach.ts'
import {
  blockFromCourse,
  coursesForDay,
  freeGaps,
  generateDayBlocks,
  moveBlock as moveBlockInDay,
  snapToGap,
  syncBlockMinutes,
} from './plan.ts'
import { BODY_PART_ZH, DEFAULT_PERIODS, SEED_EXERCISES } from './seed.ts'
import { buildRange, computeDayStat, summarize, type DayStat, type StatsSummary } from './stats.ts'
import { reuseSessionItems, sessionProgress, rotateFocus, suggestFocus, gymProgress } from './gym.ts'
import { lifeAreaOf } from './life.ts'
import { parseCourseText, type ParsedCourseRow } from './courseImport.ts'
import { activeStreak, mergeLearningUpdates, nextValue, statusRank, weekGains } from './learn.ts'
import { structureReview } from './review.ts'
import { structureRoutines as runRoutineStructuring } from './routines.ts'

export interface ServiceConfig {
  readonly timeZone: string
  readonly workspacePath: string
  readonly provider: string
  readonly model: string
  readonly agentPreset: string
  readonly reviewTimeoutMs: number
}

export interface BlockInput {
  readonly id?: string
  readonly title: string
  readonly category?: CategoryValue
  readonly startPeriod: number
  readonly endPeriod: number
  readonly source?: PlanBlockRecord['source']
  readonly backlogId?: string | null
  readonly gymDate?: string | null
  readonly note?: string
  readonly colorKey?: string
}

export interface RollforwardItem {
  readonly blockId?: string | null
  readonly title: string
  readonly category: CategoryValue
  readonly periods: number
  readonly suggestDate: string
}

export interface PlanSnapshot {
  readonly today: DayPlanRecord
  readonly week: DayPlanRecord[]
  readonly weekKey: string
  readonly courses: CourseRecord[]
  readonly backlog: BacklogItemRecord[]
  readonly gymSession: GymSessionRecord
  /** Per-day training summary for the week being browsed. */
  readonly gymWeek: readonly {
    readonly date: string
    readonly actions: number
    readonly sets: number
    readonly parts: readonly string[]
    readonly planned: boolean
  }[]
  readonly exercises: ExerciseRecord[]
  readonly gymFocus: { readonly focus: BodyPartValue[]; readonly reason: string }
  readonly todayReview: ReviewRecord | null
  readonly settings: SettingsRecord
  readonly nowIso: string
  readonly todayIso: string
  readonly currentMinute: number
  readonly workflow: ReturnType<DailyPlanService['workflowContext']>
}

interface Tables {
  courses: any
  plans: any
  backlog: any
  exercises: any
  gym_sessions: any
  reviews: any
  reading: any
  learning: any
  workflow_runs: any
  personal_memory: any
}

/**
 * Find the Learn item an update refers to: by id when the model had the list,
 * else by title. Titles are compared with book brackets and whitespace stripped,
 * and a containment match is accepted last — users write 《书名》 and 书名
 * interchangeably.
 */
function matchByRefOrTitle<T extends { readonly id: string; readonly title: string }>(
  list: readonly T[],
  update: { readonly ref: string | null; readonly title: string },
): T | undefined {
  if (update.ref !== null) {
    const byId = list.find((item) => item.id === update.ref)
    if (byId !== undefined) return byId
    throw new Error('对应的学习记录已经不存在，请重新选择')
  }
  const clean = (value: string): string => value.replace(/[《》\s]/gu, '').toLowerCase()
  const needle = clean(update.title)
  if (needle === '') return undefined
  const exact = list.filter((item) => clean(item.title) === needle)
  const matches = exact.length > 0 ? exact : list.filter((item) => {
      const hay = clean(item.title)
      return hay.includes(needle) || needle.includes(hay)
    })
  if (matches.length > 1) throw new Error('名称对应多条学习记录，请填写完整名称')
  return matches[0]
}

/** Sorting a list must never be able to throw: the whole snapshot rides on it. */
function asText(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : ''
}

/**
 * How many records a table holds, without assuming the backend exposes `.size`.
 * Returns -1 when it genuinely cannot tell.
 */
function tableCount(table: any): number {
  if (typeof table?.size === 'number') return table.size
  for (const accessor of ['keys', 'entries'] as const) {
    try {
      if (typeof table?.[accessor] === 'function') return [...table[accessor]()].length
    } catch {
      // Fall through to the next accessor.
    }
  }
  return -1
}

export class DailyPlanService {
  private tables: Tables | undefined
  private settingsCache: SettingsRecord | undefined
  private readonly reviewJobs = new Map<string, AbortController>()
  private readonly coachJobs = new Map<string, AbortController>()
  private readonly startedJobs = new Map<string, AbortController>()
  private allocationQueue: Promise<unknown> = Promise.resolve()

  private constructor(
    private readonly ctx: Context,
    private readonly domain: any,
    private readonly config: ServiceConfig,
  ) {}

  static async open(ctx: Context, config: ServiceConfig): Promise<DailyPlanService> {
    // ⚠️ `version` stays at 1 forever — see the warning in domain.ts.
    const domain = await ctx.storageDomain.open(dailyPlanDomainSpec)
    const service = new DailyPlanService(ctx, domain, config)
    service.tables = {
      courses: domain.table('courses'),
      plans: domain.table('plans'),
      backlog: domain.table('backlog'),
      exercises: domain.table('exercises'),
      gym_sessions: domain.table('gym_sessions'),
      reviews: domain.table('reviews'),
      reading: domain.table('reading'),
      learning: domain.table('learning'),
      workflow_runs: domain.table('workflow_runs'),
      personal_memory: domain.table('personal_memory'),
    }
    // First run: an empty gym library makes the page useless, so ship the 44
    // built-ins. `resetExerciseSeed` is purely additive — it never overwrites a
    // custom entry. When the record count cannot be determined we seed anyway:
    // the annoyance of resurrecting a deleted built-in is far smaller than a
    // gym page with nothing in it.
    try {
      const existing = tableCount(service.tables.exercises)
      if (existing === 0 || existing === -1) await service.resetExerciseSeed()
    } catch (error) {
      ctx.logger?.warn?.(`[dsh-daily-plan] 载入内置动作库失败：${String(error)}`)
    }
    for (const [id, run] of service.tables.workflow_runs.entries() as IterableIterator<[string, WorkflowRunRecord]>) {
      await service.tables.workflow_runs.put(id, WorkflowRunSchema.parse(run.status === 'running' ? { ...run, status: 'failed', error: '上一次处理被中断，原文已保留，请重试。' } : run))
    }
    for (const [date, review] of service.tables.reviews.entries() as IterableIterator<[string, ReviewRecord]>) {
      if (review.status === 'structuring') await service.tables.reviews.put(date, { ...review, status: 'failed', error: { code: 'interrupted', message: '上一次整理被中断，原文已保留，请重试。' } })
    }
    return service
  }

  async dispose(): Promise<void> {
    for (const controller of this.reviewJobs.values()) controller.abort()
    for (const controller of this.coachJobs.values()) controller.abort()
    this.reviewJobs.clear()
    await this.domain.close()
  }

  workspacePath(): string {
    return this.config.workspacePath
  }

  private table<K extends keyof Tables>(name: K): Tables[K] {
    if (this.tables === undefined) throw new Error('daily plan service is not open')
    return this.tables[name]
  }

  // ── settings ──────────────────────────────────────────────────────────────

  settings(): SettingsRecord {
    if (this.settingsCache === undefined) {
      const raw = this.domain.global.get()
      const parsed = SettingsSchema.safeParse(raw ?? { agnes: { provider: this.config.provider, model: this.config.model,
        agentPreset: this.config.agentPreset, timeoutMinutes: Math.max(1, Math.min(30, Math.round(this.config.reviewTimeoutMs / 60_000))) } })
      this.settingsCache = parsed.success ? parsed.data : SettingsSchema.parse({})
    }
    return this.settingsCache
  }

  async updateSettings(patch: Record<string, unknown>): Promise<SettingsRecord> {
    const current = this.settings()
    const merged = {
      ...current,
      ...patch,
      agnes: { ...current.agnes, ...((patch['agnes'] as object | undefined) ?? {}) },
      reminder: { ...current.reminder, ...((patch['reminder'] as object | undefined) ?? {}) },
      record: { ...current.record, ...((patch['record'] as object | undefined) ?? {}) },
      planning: { ...current.planning, ...((patch['planning'] as object | undefined) ?? {}) },
      fitness: { ...current.fitness, ...((patch['fitness'] as object | undefined) ?? {}) },
    }
    const next = SettingsSchema.parse(merged)
    await this.domain.global.set(next)
    this.settingsCache = next
    return next
  }

  periods() {
    const stored = this.settings().periods
    return stored.length > 0 ? stored : DEFAULT_PERIODS
  }

  dayEndPeriod(): number {
    const fallback = DEFAULT_PERIODS.length
    const requested = this.settings().dayEndPeriod
    return Math.max(1, Math.min(this.periods().length || fallback, requested))
  }

  private now(): Date {
    return new Date()
  }

  todayIso(): string {
    return new Intl.DateTimeFormat('en-CA', { timeZone: this.config.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(this.now())
  }

  // ── plans ─────────────────────────────────────────────────────────────────

  private plan(date: string): DayPlanRecord | undefined {
    return this.table('plans').get(date) as DayPlanRecord | undefined
  }

  private emptyDay(date: string): DayPlanRecord {
    const parsed = parseIsoDate(date)
    return {
      schemaVersion: 1,
      date,
      weekKey: isoWeekKey(parsed),
      focus: '',
      blocks: [],
      updatedAt: new Date().toISOString(),
    }
  }

  dayPlan(date: string): DayPlanRecord {
    const day = this.plan(date) ?? this.emptyDay(date)
    const courses = this.listCourses()
    const weekday = courseWeekday(date, weekdayOf(parseIsoDate(date)), this.settings().courseCalendar)
    return { ...day, blocks: day.blocks.filter((block) => {
      if (date < this.todayIso() || block.done || block.source !== 'course') return true
      const course = courses.find((item) => item.id === block.courseId)
      if (!course || course.kind === 'fixed') return true
      return weekday !== null && course.weekday === weekday
    }).map((block) => {
      const course = block.source === 'course' ? courses.find((item) => item.id === block.courseId) : undefined
      return course && !block.colorKey ? { ...block, colorKey: courseColor(course) } : block
    }) }

  }

  private async saveDay(plan: DayPlanRecord): Promise<DayPlanRecord> {
    const parsed = DayPlanSchema.parse({ ...plan, updatedAt: new Date().toISOString() })
    await this.table('plans').put(parsed.date, parsed)
    return parsed
  }

  private validateSlot(date: string, start: number, end: number, ignoreId?: string): void {
    DateSchema.parse(date)
    if (!Number.isInteger(start) || !Number.isInteger(end) || end < start || end > this.dayEndPeriod() ||
      !this.periods().some((period) => period.index === start) || !this.periods().some((period) => period.index === end)) throw new Error('时段超出作息范围')
    if (this.dayPlan(date).blocks.some((block) => block.id !== ignoreId && activeBlock(block) && block.startPeriod <= end && block.endPeriod >= start)) {
      throw new Error('这个时段已有安排，请选择空档或先动态调整计划')
    }
  }

  async upsertBlock(date: string, input: BlockInput): Promise<DayPlanRecord> {
    const current = this.dayPlan(date)
    this.validateSlot(date, input.startPeriod, input.endPeriod, input.id)
    const periods = this.periods()
    const weekday = weekdayOf(parseIsoDate(date))
    const existing = input.id === undefined ? undefined : current.blocks.find((block) => block.id === input.id)
    if (existing?.locked === true && input.startPeriod !== existing.startPeriod) {
      throw new Error('课表块不可移动')
    }
    const range = existing?.appointment && input.startPeriod === existing.startPeriod && input.endPeriod === existing.endPeriod
      ? { startMinute: existing.startMinute, endMinute: existing.endMinute } : periodRange(periods, input.startPeriod, input.endPeriod)
    // A block scheduled out of the pool inherits that item's colour.
    const poolItem =
      input.backlogId === undefined || input.backlogId === null
        ? undefined
        : (this.table('backlog').get(input.backlogId) as BacklogItemRecord | undefined)
    const gymDate = input.gymDate ?? existing?.gymDate ?? poolItem?.gymDate ?? null
    if (gymDate && gymDate !== date) await this.transferGymPlan(gymDate, date)
    const block: PlanBlockRecord = {
      schemaVersion: 1,
      id: input.id ?? newId('b'),
      title: input.title,
      category: input.category ?? existing?.category ?? 'study',
      weekday,
      startPeriod: input.startPeriod,
      endPeriod: input.endPeriod,
      startMinute: range.startMinute,
      endMinute: range.endMinute,
      courseId: existing?.courseId ?? null,
      gymDate: gymDate === null ? null : date,
      backlogId: input.backlogId ?? existing?.backlogId ?? null,
      locked: existing?.locked ?? false,
      source: input.source ?? existing?.source ?? 'manual',
      colorKey: input.colorKey ?? existing?.colorKey ?? poolItem?.colorKey ?? '',
      done: existing?.done ?? false,
      doneAt: existing?.doneAt ?? null,
      carriedFrom: existing?.carriedFrom ?? null,
      note: input.note ?? existing?.note ?? '',
      adaptive: false,
      ...(existing?.appointment ? { appointment: true, timeBasis: existing.timeBasis, timeAssumption: existing.timeAssumption } : {}),
      learningRef: existing?.learningRef ?? poolItem?.learningRef ?? null,
      learningKind: existing?.learningKind ?? poolItem?.learningKind ?? null,
      ...((existing?.lifeArea ?? poolItem?.lifeArea) ? { lifeArea: (existing?.lifeArea ?? poolItem?.lifeArea)! } : {}),
      executionStatus: existing?.executionStatus ?? 'unknown',
    }
    const blocks = existing === undefined
      ? [...current.blocks, block]
      : current.blocks.map((item) => (item.id === block.id ? block : item))
    const saved = await this.saveDay({ ...current, blocks })
    // Scheduling a pool item retires it from the pool in the same round trip.
    if (poolItem !== undefined && !poolItem.done) {
      await this.table('backlog').put(poolItem.id, { ...poolItem, gymDate: block.gymDate ?? poolItem.gymDate, state: 'scheduled', done: false })
    }
    return saved
  }

  async removeBlock(date: string, blockId: string): Promise<DayPlanRecord> {
    const current = this.dayPlan(date)
    const target = current.blocks.find((block) => block.id === blockId)
    if (target?.locked === true) throw new Error('课表块不可删除')
    const saved = await this.saveDay({ ...current, blocks: current.blocks.filter((block) => block.id !== blockId) })
    if (target?.backlogId) {
      const item = this.table('backlog').get(target.backlogId)
      if (item) await this.table('backlog').put(item.id, { ...item, done: false, state: 'queued' })
    }
    return saved
  }

  async toggleBlock(date: string, blockId: string, done: boolean): Promise<DayPlanRecord> {
    const current = this.dayPlan(date)
    const blocks = current.blocks.map((block) =>
      block.id === blockId
        ? { ...block, done, executionStatus: done ? 'completed' as const : 'unknown' as const, doneAt: done ? new Date().toISOString() : null }
        : block,
    )
    const saved = await this.saveDay({ ...current, blocks })
    const target = blocks.find((block) => block.id === blockId)
    if (target?.backlogId) {
      const item = this.table('backlog').get(target.backlogId)
      if (item) await this.table('backlog').put(item.id, { ...item, done, state: done ? 'completed' : 'scheduled' })
    }
    return saved
  }

  async moveBlock(
    date: string,
    blockId: string,
    toDate: string,
    startPeriod: number,
    endPeriod: number,
  ): Promise<{ readonly from: DayPlanRecord; readonly to: DayPlanRecord }> {
    const source = this.dayPlan(date)
    this.validateSlot(toDate, startPeriod, endPeriod, date === toDate ? blockId : undefined)
    const periods = this.periods()
    const dayEnd = this.dayEndPeriod()

    if (date === toDate) {
      const moved = moveBlockInDay(source.blocks, blockId, startPeriod, endPeriod, dayEnd)
      const previous = source.blocks.find((block) => block.id === blockId)
      const range = previous?.appointment && previous.startPeriod === startPeriod && previous.endPeriod === endPeriod
        ? { startMinute: previous.startMinute, endMinute: previous.endMinute } : periodRange(periods, startPeriod, endPeriod)
      const withMinutes = syncBlockMinutes(moved.map((block) => block.id === blockId ? { ...block, ...range, adaptive: false } : block), periods)
      const saved = await this.saveDay({ ...source, blocks: withMinutes })
      return { from: saved, to: saved }
    }

    const moving = source.blocks.find((block) => block.id === blockId)
    if (moving === undefined) throw new Error(`unknown block '${blockId}'`)
    if (moving.locked) throw new Error('课表块不可移动')
    if (moving.gymDate && moving.gymDate !== toDate) await this.transferGymPlan(moving.gymDate, toDate)

    const fromSaved = await this.saveDay({
      ...source,
      blocks: source.blocks.filter((block) => block.id !== blockId),
    })

    const target = this.dayPlan(toDate)
    const length = endPeriod - startPeriod + 1
    const range = moving.appointment && moving.startPeriod === startPeriod && moving.endPeriod === endPeriod
      ? { startMinute: moving.startMinute, endMinute: moving.endMinute } : periodRange(periods, startPeriod, startPeriod + length - 1)
    const inserted: PlanBlockRecord = {
      ...moving,
      adaptive: false,
      id: moving.id,
      gymDate: moving.gymDate ? toDate : null,
      weekday: weekdayOf(parseIsoDate(toDate)),
      startPeriod,
      endPeriod: startPeriod + length - 1,
      startMinute: range.startMinute,
      endMinute: range.endMinute,
      carriedFrom: moving.carriedFrom ?? date,
    }
    const toSaved = await this.saveDay({
      ...target,
      blocks: syncBlockMinutes([...target.blocks, inserted], periods),
    })
    if (moving.backlogId) {
      const task = this.table('backlog').get(moving.backlogId)
      if (task) await this.table('backlog').put(task.id, { ...task, gymDate: moving.gymDate ? toDate : task.gymDate, state: 'scheduled' })
    }
    return { from: fromSaved, to: toSaved }
  }

  async reorderDay(date: string, orderedIds: readonly string[]): Promise<DayPlanRecord> {
    const current = this.dayPlan(date)
    const periods = this.periods()
    const dayEnd = this.dayEndPeriod()
    const ordered = orderedIds
      .map((id) => current.blocks.find((block) => block.id === id))
      .filter((block): block is PlanBlockRecord => block !== undefined)
    const rest = current.blocks.filter((block) => !orderedIds.includes(block.id))

    let blocks: PlanBlockRecord[] = []
    let cursor = 1
    for (const block of ordered) {
      const length = block.endPeriod - block.startPeriod + 1
      const anchor = Math.min(cursor, Math.max(1, dayEnd - length + 1))
      const target = snapToGap(blocks, anchor, length, dayEnd) ?? { startPeriod: anchor, endPeriod: anchor + length - 1 }
      blocks = [...blocks, { ...block, startPeriod: target.startPeriod, endPeriod: target.endPeriod }]
      cursor = target.endPeriod + 1
    }
    for (const block of rest) blocks.push(block)
    return this.saveDay({ ...current, blocks: syncBlockMinutes(blocks, periods) })
  }

  async generateWeek(
    weekKey: string,
    placeRoutines = true,
  ): Promise<{ readonly week: DayPlanRecord[]; readonly created: number }> {
    const settings = this.settings()
    const courses = this.listCourses()
    const periods = this.periods()
    const dayEnd = this.dayEndPeriod()
    const dates = weekDates(weekKey)
    const week: DayPlanRecord[] = []
    let created = 0

    for (const date of dates) {
      const parsed = parseIsoDate(date)
      const weekday = weekdayOf(parsed)
      const generated = generateDayBlocks({
        courses,
        courseCalendar: settings.courseCalendar,
        // "Whole term" lays down classes only — the term is 16 weeks long and
        // the user has not decided anything about week 9 yet, so committing
        // today's routines to the whole term would be presuming.
        routines: placeRoutines ? settings.routines : [],
        date,
        weekday,
        teachingWeek: teachingWeek(settings.termStart, parsed),
        periods,
        dayEndPeriod: dayEnd,
      })

      const existing = this.plan(date)
      if (existing === undefined) {
        created += generated.length
        week.push(await this.saveDay({ ...this.emptyDay(date), blocks: generated }))
        continue
      }
      // Rebuilding is only allowed to touch what the generator owns.
      //
      // Two rules, both learned from losing the user's work:
      //
      //  1. Blocks the generator produced (`course`, `routine`) are replaced —
      //     that is the point of re-generating — but their **done state is the
      //     user's**, so it is carried over by id. Re-generating used to silently
      //     un-tick every class you had already marked as attended.
      //  2. Everything else (`manual`, `backlog`, `carry`) is left exactly as it
      //     was. A generated week must never be able to delete a block the user
      //     put there.
      const previous = new Map(existing.blocks.map((block) => [block.id, block]))
      const generatedWithState = generated.map((block) => {
        const before = previous.get(block.id)
        return before === undefined
          ? block
          : { ...block, done: before.done, doneAt: before.doneAt }
      })
      // What this run is allowed to replace. "Whole term" only lays down classes,
      // so it must also *not own* routines — otherwise generating the term would
      // delete the routines you had already placed in the current week.
      const owned = new Set(placeRoutines ? ['course', 'routine'] : ['course'])
      const generatedIds = new Set(generated.map((block) => block.id))
      const userBlocks = existing.blocks.filter((block) => !owned.has(block.source) || ((block.done || (date < this.todayIso() && block.source === 'course')) && !generatedIds.has(block.id)))
      const merged = [...userBlocks, ...generatedWithState]
      const deduped = new Map<string, PlanBlockRecord>()
      for (const block of merged) deduped.set(block.id, block)
      const blocks = syncBlockMinutes(
        [...deduped.values()].sort(
          (left, right) => left.startPeriod - right.startPeriod || left.id.localeCompare(right.id),
        ),
        periods,
      )
      created += generated.length
      week.push(await this.saveDay({ ...existing, blocks }))
    }
    return { week, created }
  }

  /**
   * Fill the whole term in one go — every teaching week, from the term's first
   * Monday. It is just `generateWeek` in a loop, but doing it here means the
   * calendar is never something the user has to remember to keep feeding.
   */
  /**
   * Read a plain-language description of standing commitments and turn it into
   * routines. Nothing is written here — the result goes back to the Settings
   * page, where the user edits it before saving. A draft the user cannot fix is
   * worse than no draft.
   */
  async draftRoutines(description: string): Promise<{
    readonly ok: boolean
    readonly routines: unknown[]
    readonly error: { readonly code: string; readonly message: string } | null
  }> {
    const settings = this.settings()
    const controller = new AbortController()
    try {
      const result = await runRoutineStructuring(this.ctx, {
        description,
        periods: this.periods().map((period) => ({
          index: period.index,
          label: `${formatHm(period.startMinute)}-${formatHm(period.endMinute)}`,
        })),
        existing: settings.routines,
        termStart: settings.termStart,
        provider: settings.agnes.provider,
        model: settings.agnes.model,
        agentPreset: settings.agnes.agentPreset,
        // Structuring a dozen short lines needs far less time than a day's prose.
        timeoutMs: Math.min(settings.agnes.timeoutMinutes, 3) * 60_000,
        workspacePath: this.config.workspacePath,
        signal: controller.signal,
      })
      return { ok: result.ok, routines: result.routines, error: result.error }
    } catch (error) {
      return {
        ok: false,
        routines: [],
        error: { code: 'agnes-error', message: error instanceof Error ? error.message : String(error) },
      }
    }
  }

  async generateTerm(): Promise<{
    readonly weeks: number
    readonly created: number
    readonly from: string
    readonly to: string
  }> {
    const settings = this.settings()
    const termStart = settings.termStart !== '' ? settings.termStart : this.todayIso()
    const start = parseIsoDate(termStart)
    // Monday of the week term starts in, so week 1 is a whole week even when
    // the term begins mid-week.
    const firstMonday = addDays(start, -(weekdayOf(start) - 1))
    let created = 0
    for (let index = 0; index < settings.termWeeks; index += 1) {
      const result = await this.generateWeek(isoWeekKey(addDays(firstMonday, index * 7)), false)
      created += result.created
    }
    const lastMonday = addDays(firstMonday, (settings.termWeeks - 1) * 7)
    return {
      weeks: settings.termWeeks,
      created,
      from: isoDate(firstMonday),
      to: isoDate(addDays(lastMonday, 6)),
    }
  }

  async clearWeek(weekKey: string): Promise<{ readonly cleared: number }> {
    let cleared = 0
    for (const date of weekDates(weekKey)) {
      const existing = this.plan(date)
      if (existing === undefined) continue
      const kept = existing.blocks.filter((block) => block.locked || block.done)
      cleared += existing.blocks.length - kept.length
      await this.saveDay({ ...existing, blocks: kept })
      for (const block of existing.blocks.filter((block) => !kept.includes(block))) {
        if (!block.backlogId) continue
        const task = this.table('backlog').get(block.backlogId)
        if (task && !task.done) await this.table('backlog').put(task.id, { ...task, state: 'queued' })
      }
    }
    return { cleared }
  }

  snapGap(weekKey: string, weekday: number, period: number): { startPeriod: number; endPeriod: number } | null {
    const dates = weekDates(weekKey)
    const date = dates[weekday - 1]
    if (date === undefined) return null
    const plan = this.plan(date)
    return snapToGap(plan?.blocks ?? [], period, 2, this.dayEndPeriod())
  }

  /** Persist every request in the task pool before allocating it. Overflow cannot disappear. */
  async rollforward(
    fromDate: string,
    items: readonly RollforwardItem[],
  ): Promise<{ readonly created: PlanBlockRecord[]; readonly skipped: string[] }> {
    DateSchema.parse(fromDate)
    const taskIds = new Set<string>()
    for (const item of items) {
      const targetDate = DateSchema.parse(item.suggestDate)
      const source = this.dayPlan(fromDate).blocks.find((block) => block.id === item.blockId)
      if (source && (source.done || !flexibleBlock(source))) continue
      const id = source?.backlogId ?? `carry_${stableHash(`${fromDate}:${item.blockId ?? item.title}`)}`
      const existing = this.table('backlog').get(id) as BacklogItemRecord | undefined
      if (existing?.state === 'completed') continue
      await this.upsertBacklog({
        id, title: item.title, category: item.category,
        estimatePeriods: Math.max(1, Math.min(6, Math.round(item.periods))),
        notBefore: targetDate, colorKey: source?.colorKey ?? '',
        originDate: fromDate, originBlockId: source?.id ?? null,
        learningRef: source?.learningRef ?? null, learningKind: source?.learningKind ?? null,
        gymDate: source?.gymDate ?? null,
        done: false, state: existing?.state ?? 'queued',
      })
      taskIds.add(id)
      if (source && activeBlock(source)) {
        const day = this.dayPlan(fromDate)
        await this.saveDay({ ...day, blocks: day.blocks.map((block) => block.id === source.id ? { ...block, disposition: 'deferred' } : block) })
      }
    }
    const tomorrow = isoDate(addDays(parseIsoDate(fromDate), 1))
    const result = await this.replan(tomorrow < this.todayIso() ? this.todayIso() : tomorrow)
    return { created: result.days.flatMap((day) => day.blocks.filter((block) => block.backlogId && taskIds.has(block.backlogId))),
      skipped: result.waiting.filter((item) => taskIds.has(item.taskId)).map((item) => item.title) }
  }

  // ── backlog ───────────────────────────────────────────────────────────────

  listBacklog(): BacklogItemRecord[] {
    return [...(this.table('backlog').entries() as IterableIterator<[string, BacklogItemRecord]>)]
      .map(([, item]) => item)
      .filter((item) => !item.done && item.state !== 'scheduled' && item.state !== 'cancelled')
      .sort(
        (left, right) =>
          asText(right.priority).localeCompare(asText(left.priority)) ||
          asText(left.createdAt).localeCompare(asText(right.createdAt)),
      )
  }

  async upsertBacklog(input: Partial<BacklogItemRecord> & { title: string }): Promise<BacklogItemRecord> {
    const table = this.table('backlog')
    const existing = input.id === undefined ? undefined : (table.get(input.id) as BacklogItemRecord | undefined)
    const item = BacklogItemSchema.parse({
      ...(existing ?? {}),
      ...input,
      id: input.id ?? newId('k'),
      category: input.category ?? existing?.category ?? 'study',
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    })
    await table.put(item.id, item)
    return item
  }

  async removeBacklog(id: string): Promise<{ readonly ok: true }> {
    await this.table('backlog').delete(id)
    return { ok: true }
  }

  // ── courses ───────────────────────────────────────────────────────────────

  listCourses(): CourseRecord[] {
    return [...(this.table('courses').entries() as IterableIterator<[string, CourseRecord]>)]
      .map(([, course]) => course)
      .filter((course) => !course.archived)
      .sort(
        (left, right) =>
          asText(left.weekday).localeCompare(asText(right.weekday)) ||
          asText(left.startPeriod).localeCompare(asText(right.startPeriod)) ||
          asText(left.name).localeCompare(asText(right.name)),
      )
  }

  async upsertCourse(input: Partial<CourseRecord> & { name: string }): Promise<CourseRecord> {
    const table = this.table('courses')
    const existing = input.id === undefined ? undefined : (table.get(input.id) as CourseRecord | undefined)
    const course = CourseSchema.parse({
      ...(existing ?? {}),
      ...input,
      id: input.id ?? newId('c'),
    })
    await table.put(course.id, course)
    return course
  }

  async removeCourse(id: string): Promise<{ readonly ok: true }> {
    await this.table('courses').delete(id)
    return { ok: true }
  }

  parseCourses(text: string): ReturnType<typeof parseCourseText> {
    return parseCourseText(text)
  }

  async importCourses(rows: readonly ParsedCourseRow[], replace: boolean): Promise<{ readonly imported: number }> {
    const table = this.table('courses')
    if (replace) {
      for (const key of [...(table.keys() as IterableIterator<string>)]) await table.delete(key)
    }
    let imported = 0
    for (const row of rows) {
      const course = CourseSchema.parse({ ...row, id: newId('c') })
      await table.put(course.id, course)
      imported += 1
    }
    return { imported }
  }

  // ── gym ───────────────────────────────────────────────────────────────────

  listExercises(): ExerciseRecord[] {
    return [...(this.table('exercises').entries() as IterableIterator<[string, ExerciseRecord]>)]
      .map(([, exercise]) => exercise)
      .filter((exercise) => !exercise.archived)
      .sort((left, right) => asText(left.part).localeCompare(asText(right.part)) || asText(left.name).localeCompare(asText(right.name)))
  }

  async upsertExercise(input: Partial<ExerciseRecord> & { name: string; part: BodyPartValue }): Promise<ExerciseRecord> {
    const table = this.table('exercises')
    const existing = input.id === undefined ? undefined : (table.get(input.id) as ExerciseRecord | undefined)
    const exercise = ExerciseSchema.parse({
      ...(existing ?? {}),
      ...input,
      id: input.id ?? newId('x'),
      custom: existing?.custom ?? true,
    })
    await table.put(exercise.id, exercise)
    return exercise
  }

  async removeExercise(id: string): Promise<{ readonly ok: true }> {
    await this.table('exercises').delete(id)
    return { ok: true }
  }

  async resetExerciseSeed(): Promise<ExerciseRecord[]> {
    const table = this.table('exercises')
    // Fail loudly and early. The storage layer rejects a non-ASCII key with a
    // message about file paths, which reads as noise; this says what broke.
    const unsafe = SEED_EXERCISES.filter((seed) => !isPathSafeKey(seed.id))
    if (unsafe.length > 0) {
      throw new Error(
        `内置动作库的 id 必须是纯 ASCII（存储层会拿 id 当文件名），以下不合法：${unsafe
          .slice(0, 3)
          .map((seed) => seed.id)
          .join('、')}${unsafe.length > 3 ? ' …' : ''}`,
      )
    }
    for (const seed of SEED_EXERCISES) {
      const existing = table.get(seed.id) as ExerciseRecord | undefined
      if (existing !== undefined) continue
      const exercise = ExerciseSchema.parse({
        id: seed.id,
        name: seed.name,
        part: seed.part,
        equipment: seed.equipment,
        defaultSets: seed.defaultSets,
        defaultReps: seed.defaultReps,
        restSeconds: seed.restSeconds,
        custom: false,
      })
      await table.put(exercise.id, exercise)
    }
    return this.listExercises()
  }

  gymSession(date: string): GymSessionRecord {
    const stored = this.table('gym_sessions').get(date) as GymSessionRecord | undefined
    return stored ?? {
      schemaVersion: 1,
      date,
      focus: [],
      items: [],
      finishedAt: null,
      feeling: null,
    }
  }

  private async saveSession(session: GymSessionRecord): Promise<GymSessionRecord> {
    const parsed = GymSessionSchema.parse(session)
    await this.table('gym_sessions').put(parsed.date, parsed)
    return parsed
  }

  private async transferGymPlan(fromDate: string, toDate: string): Promise<void> {
    const source = this.gymSession(fromDate)
    if (source.items.length === 0) return
    if (source.finishedAt !== null || source.items.some((item) => item.doneSets > 0)) throw new Error('已经记录的训练保留在原日期，请为新日期创建训练')
    if (this.gymSession(toDate).items.length > 0) throw new Error('目标日期已有训练，不能覆盖动作清单')
    await this.saveSession({ ...source, date: toDate })
    await this.table('gym_sessions').delete(fromDate)
  }

  private gymHistory(limit = 20): GymSessionRecord[] {
    return [...(this.table('gym_sessions').entries() as IterableIterator<[string, GymSessionRecord]>)]
      .map(([, session]) => session)
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, limit)
  }

  suggestGymFocus(date: string): { readonly focus: BodyPartValue[]; readonly reason: string } {
    const settings = this.settings()
    return suggestFocus({
      history: this.gymHistory(365).filter((session) => session.date < date && (session.finishedAt !== null || session.items.some((item) => item.doneSets > 0))),
      rotation: settings.gymRotation,
      restDays: settings.gymRestDays,
      weekday: weekdayOf(parseIsoDate(date)),
    })
  }

  async setGymFocus(date: string, focus: readonly BodyPartValue[], rotate = false): Promise<GymSessionRecord> {
    const current = this.gymSession(date)
    const next = rotate ? rotateFocus(focus, this.settings().gymRotation) : [...focus]
    return this.saveSession({ ...current, focus: next })
  }

  async addGymItem(date: string, exerciseId: string, atIndex?: number): Promise<GymSessionRecord> {
    const current = this.gymSession(date)
    const exercise = this.table('exercises').get(exerciseId) as ExerciseRecord | undefined
    if (exercise === undefined) throw new Error(`unknown exercise '${exerciseId}'`)
    const item: GymItemRecord = {
      id: newId('gi'),
      exerciseId: exercise.id,
      name: exercise.name,
      part: exercise.part,
      sets: exercise.defaultSets,
      reps: exercise.defaultReps,
      weight: exercise.defaultWeight,
      doneSets: 0,
      note: '',
    }
    const items = [...current.items]
    const index = atIndex === undefined ? items.length : Math.max(0, Math.min(atIndex, items.length))
    items.splice(index, 0, item)
    return this.saveSession({ ...current, items })
  }

  async updateGymItem(
    date: string,
    itemId: string,
    patch: Partial<Pick<GymItemRecord, 'sets' | 'reps' | 'weight' | 'note' | 'doneSets'>>,
  ): Promise<GymSessionRecord> {
    const current = this.gymSession(date)
    const items = current.items.map((item) => {
      if (item.id !== itemId) return item
      const merged = { ...item, ...patch }
      return { ...merged, doneSets: Math.max(merged.actualSets?.length ?? 0, Math.max(0, Math.min(merged.sets, merged.doneSets))) }
    })
    return this.saveSession({ ...current, items })
  }

  gymPerformance(toDate = this.todayIso()) {
    DateSchema.parse(toDate)
    return gymProgress(this.gymHistory(2000).filter((session) => session.date <= toDate))
      .map((group) => ({ ...group, points: group.points.slice(-12) }))
  }

  logGymSet(date: string, itemId: string, input: Partial<GymSetRecord>, requestId?: string): Promise<GymSessionRecord> {
    return this.enqueueAllocation(async () => {
      DateSchema.parse(date)
      if (date > this.todayIso()) throw new Error('实际训练只能记录今天或过去的日期')
      const session = this.gymSession(date)
      const item = session.items.find((entry) => entry.id === itemId)
      if (!item) throw new Error('训练动作不存在')
      const set = GymSetSchema.parse({ ...input, id: requestId ?? newId('set'), source: 'manual', evidence: '' })
      const actualSets = [...(item.actualSets ?? []).filter((entry) => entry.id !== set.id), set]
      return this.saveSession({ ...session, items: session.items.map((entry) => entry.id === itemId ? {
        ...entry, actualSets, doneSets: actualSets.length,
      } : entry) })
    })
  }

  removeGymSet(date: string, itemId: string, setId: string): Promise<GymSessionRecord> {
    return this.enqueueAllocation(async () => {
      const session = this.gymSession(date)
      return this.saveSession({ ...session, items: session.items.map((entry) => {
        if (entry.id !== itemId) return entry
        const actualSets = (entry.actualSets ?? []).filter((set) => set.id !== setId)
        return { ...entry, actualSets, doneSets: actualSets.length }
      }) })
    })
  }

  async removeGymItem(date: string, itemId: string): Promise<GymSessionRecord> {
    const current = this.gymSession(date)
    return this.saveSession({ ...current, items: current.items.filter((item) => item.id !== itemId) })
  }

  async reorderGymItems(date: string, orderedIds: readonly string[]): Promise<GymSessionRecord> {
    const current = this.gymSession(date)
    const ordered = orderedIds
      .map((id) => current.items.find((item) => item.id === id))
      .filter((item): item is GymItemRecord => item !== undefined)
    const rest = current.items.filter((item) => !orderedIds.includes(item.id))
    return this.saveSession({ ...current, items: [...ordered, ...rest] })
  }

  async applyLastGymSession(date: string, part: BodyPartValue | null): Promise<GymSessionRecord> {
    const current = this.gymSession(date)
    const history = this.gymHistory().filter((session) => session.date !== date)
    const source = part === null ? history[0] : history.find((session) => session.focus.includes(part) || session.items.some((item) => item.part === part))
    if (source === undefined) return current
    let counter = 0
    const items = reuseSessionItems(source, part, () => {
      counter += 1
      return newId(`gi${String(counter)}`)
    })
    return this.saveSession({ ...current, items })
  }

  async finishGymSession(date: string, feeling?: number | null): Promise<GymSessionRecord> {
    const current = this.gymSession(date)
    if (current.items.length === 0) throw new Error('还没有训练动作')
    const saved = await this.saveSession({
      ...current,
      finishedAt: new Date().toISOString(),
      feeling: feeling ?? current.feeling,
    })
    // Finishing does not *add* anything to the week — training reaches the
    // calendar through the backlog pool, on purpose, so nothing shows up that
    // the user did not put there. What finishing does is tick off the block they
    // did plan for today.
    await this.completeGymBlock(date)
    return saved
  }

  /** Tick off today's planned gym block, if there is one. */
  private async completeGymBlock(date: string): Promise<void> {
    const day = this.dayPlan(date)
    const target = day.blocks.find((block) => block.category === 'gym' && !block.done)
    if (target === undefined) return
    try {
      await this.toggleBlock(date, target.id, true)
    } catch (error) {
      this.ctx.logger?.warn?.(`[dsh-daily-plan] 勾选健身块失败：${String(error)}`)
    }
  }

  /**
   * Put a day's session in the backlog pool so it can be dragged onto the week.
   *
   * Deliberately *not* straight onto the calendar: training is planned a week at
   * a time, and where it lands is the user's call. Dropping it in the pool gives
   * them the block to place, instead of a block appearing that they then have to
   * move or undo.
   *
   * The date goes in the title because several sessions sit in the pool at once
   * (one per training day) and "健身 · 腿" alone would be indistinguishable.
   */
  async queueGymSession(date: string): Promise<BacklogItemRecord> {
    const session = this.gymSession(date)
    if (session.finishedAt !== null) throw new Error('这一天的训练已经完成')
    if (session.items.length === 0) throw new Error('这一天还没有动作，先从左边拖几个进来')
    const parts = session.focus
      .map((part) => BODY_PART_ZH[part])
      .filter((name): name is string => typeof name === 'string' && name !== '')
    const label = parts.length === 0 ? '健身' : `健身 · ${parts.join('/')}`
    const parsed = parseIsoDate(date)
    const title = `${label} · ${String(parsed.getMonth() + 1)}/${String(parsed.getDate())}`
    const periods = Math.min(4, Math.max(2, Math.ceil(session.items.length / 3)))
    return this.upsertBacklog({
      id: `gymsession_${date}`,
      title,
      category: 'gym',
      estimatePeriods: periods,
      dueDate: date,
      gymDate: date,
    })
  }

  // ── reviews ───────────────────────────────────────────────────────────────

  review(date: string): ReviewRecord | null {
    return (this.table('reviews').get(date) as ReviewRecord | undefined) ?? null
  }

  reviewHistory(limit = 120): ReviewRecord[] {
    return [...(this.table('reviews').entries() as IterableIterator<[string, ReviewRecord]>)]
      .map(([, review]) => review)
      .sort((left, right) => right.date.localeCompare(left.date))
      .slice(0, limit)
  }

  async saveDraft(date: string, raw: { text: string; usedPrompts: ReviewRecord['raw']['usedPrompts'] }): Promise<ReviewRecord> {
    const existing = this.review(date)
    const next = ReviewSchema.parse({
      ...(existing ?? {}),
      date,
      raw,
      status: existing?.raw.text === raw.text && existing?.status === 'structured' ? 'structured' : 'draft',
      structured: existing?.raw.text === raw.text ? existing.structured : null,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await this.table('reviews').put(date, next)
    return next
  }

  daySnapshot(date: string) {
    const plan = this.plan(date)
    const settings = this.settings()
    const stat = computeDayStat(
      date,
      plan,
      this.table('gym_sessions').get(date) as GymSessionRecord | undefined,
      undefined,
      { countCourseBlocks: settings.countCourseBlocks, todayIso: this.todayIso() },
    )
    return { planned: stat.planned, done: stat.done, ratio: stat.ratio, gymDone: stat.gymDone }
  }

  /** Non-idempotent: this one actually calls Agnes. */
  async structure(date: string, force = false): Promise<ReviewRecord> {
    const existing = this.review(date)
    if (existing === null || existing.raw.text.trim() === '') {
      throw new Error('还没有写下任何内容')
    }
    if (!force && existing.status === 'structured' && existing.structured !== null) return existing
    if (this.reviewJobs.has(date)) throw new Error('这一天的复盘正在整理中')
    const controller = new AbortController()
    this.reviewJobs.set(date, controller)
    try {
      const settings = this.settings()
      const busy = ReviewSchema.parse({ ...existing, status: 'structuring', updatedAt: new Date().toISOString() })
      await this.table('reviews').put(date, busy)
      const dayPlan = this.dayPlan(date)
      const counted = settings.countCourseBlocks
        ? dayPlan.blocks
        : dayPlan.blocks.filter((block) => !block.locked)
      const result = await structureReview(this.ctx, {
        date,
        weekdayZh: weekdayZh(parseIsoDate(date)),
        rawText: existing.raw.text,
        usedPrompts: existing.raw.usedPrompts,
        snapshot: this.daySnapshot(date),
        completedTitles: counted.filter((block) => block.done).map((block) => block.title),
        openTitles: counted.filter((block) => !block.done && flexibleBlock(block)).map((block) => `${block.title} (id: ${block.id})`),
        personalContext: JSON.stringify(this.workflowContext(isoWeekKey(parseIsoDate(date)))),
        upcoming: this.upcomingContext(date, 7),
        periods: this.periods().map((period) => ({
          index: period.index,
          label: `${formatHm(period.startMinute)}-${formatHm(period.endMinute)}`,
        })),
        // Only what is still in progress — a finished book has no progress to add.
        reading: this.listReading()
          .filter((book) => book.status === 'reading')
          .map((book) => ({
            id: book.id,
            title: book.title,
            progress: book.progress,
            total: book.total,
            unit: book.unit,
          })),
        practice: this.listLearning()
          .filter((item) => item.status === 'active')
          .map((item) => ({
            id: item.id,
            title: item.title,
            done: item.done,
            target: item.target,
            unit: item.unit,
          })),
        provider: settings.agnes.provider,
        model: settings.agnes.model,
        agentPreset: settings.agnes.agentPreset,
        timeoutMs: settings.agnes.timeoutMinutes * 60_000,
        workspacePath: this.config.workspacePath,
        signal: controller.signal,
      })
      const next = ReviewSchema.parse({
        ...existing,
        structured: result.structured,
        daySnapshot: this.daySnapshot(date),
        status: result.ok ? 'structured' : 'failed',
        error: result.ok ? null : result.error,
        updatedAt: new Date().toISOString(),
      })
      await this.table('reviews').put(date, next)
      return next
    } finally {
      this.reviewJobs.delete(date)
    }
  }

  async commitReview(
    date: string,
    structured: ReviewRecord['structured'],
    plan: readonly RollforwardItem[],
  ): Promise<{ readonly review: ReviewRecord; readonly rolled: PlanBlockRecord[] }> {
    const existing = this.review(date)
    if (existing === null) throw new Error('还没有可归档的复盘')
    const valid = StructuredReviewSchema.parse(structured ?? existing.structured)
    const snapshot = this.daySnapshot(date)
    // Saying "read about 100 pages" in prose should be enough — apply it to the
    // Learn page so the user never re-types what they already wrote.
    const applyWarnings = await this.applyLearningUpdates(valid.learning, date)
    const carried = plan.length === 0 ? { created: [], skipped: [] } : await this.rollforward(date, plan)
    const rolled = carried.created
    applyWarnings.push(...carried.skipped.map((title) => `${title}：容量不足，已保留在任务池。`))
    const next = ReviewSchema.parse({
      ...existing,
      structured: valid,
      daySnapshot: snapshot,
      status: 'structured',
      planApplied: [...new Set([...existing.planApplied, ...rolled.map((block) => block.id)])],
      applyWarnings,
      updatedAt: new Date().toISOString(),
    })
    await this.table('reviews').put(date, next)
    for (const memory of valid.memories ?? []) {
      if (!existing.raw.text.includes(memory.evidence)) continue
      const id = `memory_${stableHash(memory.text)}`
      const previous = this.table('personal_memory').get(id)
      if (previous?.active === false) continue
      await this.table('personal_memory').put(id, PersonalMemorySchema.parse({ id, ...memory, sourceId: `review:${date}`, date }))
    }
    if (this.settings().planning.autoReplanAfterReview && date <= this.todayIso()) {
      const tomorrow = isoDate(addDays(parseIsoDate(date), 1))
      await this.replan(tomorrow < this.todayIso() ? this.todayIso() : tomorrow, date === this.todayIso() ? valid.energy : null)
    }
    return { review: next, rolled }
  }

  /**
   * Apply progress the review mentioned to the Learn page.
   *
   * Idempotent by construction: a `delta` is measured against whatever the
   * counter stood at **before** `date`, not against its current value. Confirming
   * the same review twice therefore computes the same total rather than adding
   * the pages twice — which matters, because re-confirming after an edit is the
   * normal way to use this.
   */
  private async applyLearningUpdates(
    updates: readonly LearningUpdateRecord[],
    date: string,
  ): Promise<string[]> {
    const warnings: string[] = []
    if (updates.length === 0) return warnings
    const books = this.listReading()
    const items = this.listLearning()

    for (const update of mergeLearningUpdates(updates)) {
      try {
        if (update.kind === 'reading') {
          const book = matchByRefOrTitle(books, update)
          if (book === undefined) {
            // A title the user mentioned that the Learn page has never seen.
            // Creating it is the honest reading of "I read X pages of《…》".
            const created = await this.upsertReading({ title: update.title, unit: 'page' })
            await this.setReadingProgress(created.id, update.value, date)
            continue
          }
          await this.setReadingProgress(
            book.id,
            nextValue(book.log, date, update.mode, update.value),
            date,
          )
          continue
        }
        const item = matchByRefOrTitle(items, update)
        if (item === undefined) {
          const created = await this.upsertLearning({ title: update.title, unit: '题' })
          await this.setLearningCount(created.id, update.value, date)
          continue
        }
        await this.setLearningCount(
          item.id,
          nextValue(item.log, date, update.mode, update.value),
          date,
        )
      } catch (error) {
        warnings.push(`${update.title}：${error instanceof Error ? error.message : String(error)}`)
        // A progress update is a convenience; never let it break archiving.
        this.ctx.logger?.warn?.(
          `[dsh-daily-plan] 应用学习进度失败（${update.title}）：${String(error)}`,
        )
      }
    }
    return warnings
  }

  async removeReview(date: string): Promise<{ readonly ok: true }> {
    await this.table('reviews').delete(date)
    return { ok: true }
  }

  // ── adaptive workflow ────────────────────────────────────────────────────

  private allTasks(): BacklogItemRecord[] {
    return [...this.table('backlog').entries()].map(([, item]: [string, BacklogItemRecord]) => item)
  }

  memories(): PersonalMemoryRecord[] {
    return [...this.table('personal_memory').entries()].map(([, item]: [string, PersonalMemoryRecord]) => item)
      .filter((item: PersonalMemoryRecord) => item.active).sort((a: PersonalMemoryRecord, b: PersonalMemoryRecord) => b.date.localeCompare(a.date))
  }

  async removeMemory(id: string): Promise<void> {
    const memory = this.table('personal_memory').get(id)
    if (memory) await this.table('personal_memory').put(id, { ...memory, active: false })
  }

  workflowHistory(weekKey?: string): WorkflowRunRecord[] {
    return [...this.table('workflow_runs').entries()].map(([, item]: [string, WorkflowRunRecord]) => item)
      .filter((item: WorkflowRunRecord) => (weekKey === undefined || item.weekKey === weekKey) && !item.id.startsWith('prepare_'))
      .sort((a: WorkflowRunRecord, b: WorkflowRunRecord) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 20)
  }

  workflowContext(weekKey = isoWeekKey(parseIsoDate(this.todayIso()))) {
    const dates = weekDates(weekKey)
    if (isoWeekKey(parseIsoDate(dates[0] as string)) !== weekKey) throw new Error('无效的 ISO 周')
    const first = dates[0] as string
    const last = dates[6] as string
    const previousStart = isoDate(addDays(parseIsoDate(first), -7))
    const previousEnd = isoDate(addDays(parseIsoDate(first), -1))
    const history = Array.from({ length: 21 }, (_, i) => this.dayPlan(isoDate(addDays(parseIsoDate(this.todayIso()), i - 20))))
    const reviews = this.reviewHistory(2000).sort((a, b) => a.date.localeCompare(b.date))
    const signals = personalSignals(history, reviews, this.todayIso())
    const week = dates.map((date) => this.dayPlan(date))
    const actual = week.filter((day) => day.date <= this.todayIso())
    const blocks = actual.flatMap((day) => day.blocks.filter((block) => flexibleBlock(block)))
    const unconfirmed = actual.flatMap((day) => day.blocks.filter((block) => flexibleBlock(block) && !block.done && block.executionStatus !== 'missed' &&
      (day.date < this.todayIso() || block.endMinute <= this.currentMinute())))
    const previousBlocks = Array.from({ length: 7 }, (_, i) => this.dayPlan(isoDate(addDays(parseIsoDate(previousStart), i))))
      .filter((day) => day.date <= this.todayIso()).flatMap((day) => day.blocks.filter(flexibleBlock))
    return {
      weekKey, dates, personalContext: this.settings().personalContext, memories: this.memories(), signals,
      planning: this.settings().planning,
      focus: week.map((day) => day.focus).find((value) => value !== '') ?? '',
      completion: { done: blocks.filter((block) => block.done).length, planned: blocks.length,
        unknown: unconfirmed.length },
      previousCompletion: { done: previousBlocks.filter((block) => block.done).length, planned: previousBlocks.length },
      learning: this.learnWeekStats(first, last), previousLearning: this.learnWeekStats(previousStart, previousEnd),
      reading: this.listReading(), practice: this.listLearning(),
      gym: this.gymHistory(2000).filter((session) => session.date >= first && session.date <= last),
      previousGym: this.gymHistory(2000).filter((session) => session.date >= previousStart && session.date <= previousEnd),
      gymRestDays: this.settings().gymRestDays,
      exercises: this.listExercises(), gymPerformance: this.gymPerformance(),
      fitness: this.settings().fitness,
      lifeAreas: ['work', 'health', 'relationships'].map((area) => ({ area,
        planned: blocks.filter((block) => lifeAreaOf(block) === area).length,
        completed: blocks.filter((block) => lifeAreaOf(block) === area && block.done).length,
        observations: actual.flatMap((day) => (day.observations ?? []).filter((entry) => entry.lifeArea === area)).length })),
      recentDays: history.slice(-14),
      reviews: reviews.filter((review) => review.date >= previousStart && review.date <= last),
      recentReviews: reviews.filter((review) => review.date <= this.todayIso()).slice(-14),
      recentFeedback: this.workflowHistory().filter((run) => ['review', 'weekly', 'plan'].includes(run.mode) && run.status === 'applied').slice(0, 14),
      tasks: this.allTasks().filter((task) => !task.done && task.state !== 'cancelled'),
      archivedTasks: this.allTasks().filter((task) => task.done || task.state === 'cancelled').slice(-30),
      days: week,
      upcomingDays: Array.from({ length: 31 }, (_, i) => this.dayPlan(isoDate(addDays(parseIsoDate(this.todayIso()), i)))),
      periods: this.periods(),
      latestRun: this.workflowHistory(weekKey)[0] ?? null,
      latestConversation: this.workflowHistory()[0] ?? null,
    }
  }

  /** Seed small linked sessions from actual weekly deficits, not fabricated progress. */
  private async seedGoalTasks(fromDate: string): Promise<void> {
    const weekKey = isoWeekKey(parseIsoDate(fromDate))
    const dates = weekDates(weekKey)
    const gains = this.learnWeekStats(dates[0] as string, dates[6] as string)
    const sources = [
      ...this.listReading().filter((book) => book.status === 'reading').map((book) => ({ id: book.id, title: book.title,
        goal: book.weeklyGoal, gain: gains.reading.find((entry) => entry.id === book.id)?.gain ?? 0, kind: 'reading' as const })),
      ...this.listLearning().filter((item) => item.status === 'active').map((item) => ({ id: item.id, title: item.title,
        goal: item.weeklyGoal, gain: gains.learning.find((entry) => entry.id === item.id)?.gain ?? 0, kind: 'practice' as const })),
    ]
    const retired = new Set<string>()
    for (const task of this.allTasks()) {
      if (!task.id.startsWith('goal_') || task.weekKey !== weekKey || task.done) continue
      const source = sources.find((item) => item.id === task.learningRef && item.kind === task.learningKind)
      if (!source || source.goal <= 0 || source.gain >= source.goal) {
        retired.add(task.id)
        await this.table('backlog').put(task.id, { ...task, state: 'cancelled', cancelledBy: task.cancelledBy === 'user' ? 'user' : 'goal_met' })
      }
    }
    if (retired.size > 0) {
      for (const date of dates) {
        if (date < this.todayIso()) continue
        const day = this.dayPlan(date)
        await this.saveDay({ ...day, blocks: day.blocks.filter((block) => !block.adaptive || block.done || !block.backlogId || !retired.has(block.backlogId) ||
          (date === this.todayIso() && block.startMinute <= this.currentMinute() && block.endMinute > this.currentMinute())) })
      }
    }
    for (const source of sources) {
      if (source.goal <= 0 || source.gain >= source.goal) continue
      for (let index = 0; index < 2; index++) {
        const id = `goal_${stableHash(`${weekKey}:${source.kind}:${source.id}:${index}`)}`
        const existing = this.table('backlog').get(id) as BacklogItemRecord | undefined
        if (existing && (existing.state !== 'cancelled' || existing.cancelledBy === 'user')) continue
        await this.upsertBacklog({ id, title: `${source.title} · 本周推进 ${index + 1}`, category: 'study', estimatePeriods: 1,
          weekKey, notBefore: fromDate, dueDate: dates[6] as string, learningRef: source.id, learningKind: source.kind, state: 'queued' })
      }
    }
    const target = this.settings().planning.gymWeeklyGoal
    const sessions = this.gymHistory().filter((session) => dates.includes(session.date) && session.finishedAt !== null).length
    for (let index = sessions; index < target; index++) {
      const id = `gymgoal_${stableHash(`${weekKey}:${index}`)}`
      if (this.table('backlog').get(id)) continue
      await this.upsertBacklog({ id, title: `健身 · 本周第 ${index + 1} 次`, category: 'gym', estimatePeriods: 2,
        weekKey, notBefore: fromDate, dueDate: dates[6] as string })
    }
  }

  private enqueueAllocation<T>(task: () => Promise<T>): Promise<T> {
    const result = this.allocationQueue.then(task, task)
    this.allocationQueue = result.catch(() => undefined)
    return result
  }

  replan(fromDate = this.todayIso(), energy: number | null = null): Promise<AdaptiveResult> {
    return this.enqueueAllocation(() => this.replanCore(fromDate, energy))
  }

  private async replanCore(fromDate: string, energy: number | null, throughDate?: string): Promise<AdaptiveResult> {
    DateSchema.parse(fromDate)
    const start = fromDate < this.todayIso() ? this.todayIso() : fromDate
    await this.seedGoalTasks(start)
    // Recover missed tasks once. Stable task ids connect retries and subsequent carry-overs.
    for (let offset = -14; offset <= 0; offset++) {
      const date = isoDate(addDays(parseIsoDate(start), offset))
      if (date > this.todayIso()) continue
      const day = this.dayPlan(date)
      const missed = day.blocks.filter((block) => activeBlock(block) && flexibleBlock(block) && !block.done &&
        (date < this.todayIso() || block.endMinute <= this.currentMinute()))
      for (const block of missed) {
        const id = block.backlogId ?? `missed_${stableHash(`${date}:${block.id}`)}`
        const task = this.table('backlog').get(id) as BacklogItemRecord | undefined
        if (task?.state === 'completed' || task?.state === 'cancelled') continue
        await this.upsertBacklog({ id, title: block.title, category: block.category,
          estimatePeriods: block.endPeriod - block.startPeriod + 1, colorKey: block.colorKey,
          learningRef: block.learningRef ?? null, learningKind: block.learningKind ?? null,
          ...(block.lifeArea ? { lifeArea: block.lifeArea } : {}),
          gymDate: block.gymDate, originDate: task?.originDate ?? date, originBlockId: task?.originBlockId ?? block.id,
          notBefore: start, state: 'queued', done: false })
      }
      if (missed.length > 0) await this.saveDay({ ...day, blocks: day.blocks.map((block) => missed.includes(block) ? { ...block, disposition: 'deferred' } : block) })
    }
    const length = throughDate ? Math.round((parseIsoDate(throughDate).getTime() - parseIsoDate(start).getTime()) / 86400000) + 1 : 7
    const dates = Array.from({ length }, (_, i) => isoDate(addDays(parseIsoDate(start), i)))
    const days = dates.map((date) => {
      const day = this.dayPlan(date)
      const skeleton = generateDayBlocks({ courses: this.listCourses(), courseCalendar: this.settings().courseCalendar, routines: this.settings().routines,
        date, weekday: weekdayOf(parseIsoDate(date)), teachingWeek: teachingWeek(this.settings().termStart, parseIsoDate(date)),
        periods: this.periods(), dayEndPeriod: this.dayEndPeriod() })
      const existingIds = new Set(day.blocks.map((block) => block.id))
      return { ...day, blocks: [...day.blocks, ...skeleton.filter((block) => !existingIds.has(block.id))] }
    })
    const signals = this.workflowContext(isoWeekKey(parseIsoDate(start))).signals
    const outsideIds = new Set<string>([...this.table('plans').entries()].flatMap(([, day]: [string, DayPlanRecord]) =>
      dates.includes(day.date) ? [] : day.blocks.filter(activeBlock).flatMap((block) => block.backlogId ? [block.backlogId] : [])))
    const result = allocateAdaptive({ days, tasks: this.allTasks().filter((task) => !outsideIds.has(task.id)), periods: this.periods(), settings: this.settings().planning,
      fromDate: start, today: this.todayIso(), currentMinute: this.currentMinute(), dayEndPeriod: this.dayEndPeriod(),
      gymRestDays: this.settings().gymRestDays,
      completedGymDates: this.gymHistory(365).filter((session) => session.finishedAt !== null).map((session) => session.date),
      preparedGymDates: this.gymHistory(365).filter((session) => session.items.length > 0).map((session) => session.date),
      loadFactor: signals.loadFactor, energy: energy ?? signals.averageEnergy })
    for (const day of result.days) {
      for (const assignment of result.scheduled.filter((item) => item.date === day.date)) {
        const task = this.table('backlog').get(assignment.taskId) as BacklogItemRecord | undefined
        if (task?.gymDate && task.gymDate !== day.date) {
          await this.transferGymPlan(task.gymDate, day.date)
          await this.table('backlog').put(task.id, { ...task, gymDate: day.date })
        }
      }
      const hasGym = day.blocks.some((block) => activeBlock(block) && block.category === 'gym')
      if (hasGym && this.gymSession(day.date).items.length === 0) {
        const focus = this.suggestGymFocus(day.date).focus
        if (focus.length > 0) {
          await this.setGymFocus(day.date, focus)
          const history = this.gymHistory().find((session) => session.date < day.date && session.items.length > 0 && session.focus.some((part) => focus.includes(part)))
          if (history) {
            await this.saveSession({ ...this.gymSession(day.date), items: reuseSessionItems(history, focus[0] ?? null, () => newId('gi')) })
          } else {
            for (const exercise of this.listExercises().filter((item) => focus.includes(item.part)).slice(0, 3)) await this.addGymItem(day.date, exercise.id)
          }
        }
      }
      await this.saveDay(day)
    }
    const plannedIds = new Set(result.days.flatMap((day) => day.blocks.filter(activeBlock).flatMap((block) => block.backlogId ? [block.backlogId] : [])))
    for (const task of this.allTasks()) {
      if (task.done || task.state === 'completed' || task.state === 'cancelled') continue
      const outside = [...this.table('plans').entries()].some(([, day]: [string, DayPlanRecord]) =>
        !dates.includes(day.date) && day.blocks.some((block) => activeBlock(block) && block.backlogId === task.id))
      await this.table('backlog').put(task.id, { ...task, state: plannedIds.has(task.id) || outside ? 'scheduled' : 'queued' })
    }
    return result
  }

  async prepareToday(): Promise<void> {
    if (!this.settings().planning.autoPrepareToday) return
    const date = this.todayIso()
    const id = `prepare_${date}`
    await this.enqueueAllocation(async () => {
      if (this.table('workflow_runs').get(id)) return
      await this.replanCore(date, null)
      const stamp = new Date().toISOString()
      await this.table('workflow_runs').put(id, WorkflowRunSchema.parse({ id, date, weekKey: isoWeekKey(parseIsoDate(date)),
        mode: 'replan', rawText: '', status: 'applied', createdAt: stamp, updatedAt: stamp }))
    })
  }

  async workflowStart(input: { text: string; mode: WorkflowRunRecord['mode']; weekKey?: string; apply?: boolean; rangeStart?: string; rangeEnd?: string; planStart?: string; planEnd?: string; replaceConflicts?: boolean; clientRequestId?: string }) {
    const id = input.clientRequestId ? `coach_${stableHash(input.clientRequestId)}` : newId('coach')
    if (this.table('workflow_runs').get(id)) return { id }
    const controller = new AbortController()
    this.startedJobs.set(id, controller)
    let resolve!: () => void, reject!: (error: unknown) => void
    const started = new Promise<void>((yes, no) => { resolve = yes; reject = no })
    void this.workflowRun({ ...input, runId: id, signal: controller.signal, onStarted: resolve }).catch(async (error) => {
      reject(error)
      const run = this.table('workflow_runs').get(id)
      if (run) await this.table('workflow_runs').put(id, { ...run, status: run.draft ? 'ready' : 'failed', phase: run.draft ? 'ready' : 'failed', error: String(error instanceof Error ? error.message : error) })
    }).finally(() => { this.startedJobs.delete(id) }).catch(() => undefined)
    await started
    return { id }
  }

  workflowStatus(id: string) {
    const run = this.table('workflow_runs').get(id) as WorkflowRunRecord | undefined
    if (!run) throw new Error('没有找到这一份安排')
    return { run, phase: run.phase ?? (run.status === 'running' ? 'generating' : run.status), allocation: null }
  }

  async workflowCancel(id: string) {
    const controller = this.startedJobs.get(id)
    const run = this.table('workflow_runs').get(id) as WorkflowRunRecord | undefined
    if (run?.status !== 'running') return this.workflowStatus(id)
    controller?.abort()
    if (run) await this.table('workflow_runs').put(id, { ...run, status: 'failed', phase: 'cancelled', error: '已停止整理，原文已保留。' })
    return this.workflowStatus(id)
  }

  async workflowRun(input: { text: string; mode: WorkflowRunRecord['mode']; weekKey?: string; apply?: boolean; signal?: AbortSignal; rangeStart?: string; rangeEnd?: string; planStart?: string; planEnd?: string; replaceConflicts?: boolean; runId?: string; onStarted?: () => void }) {
    const date = this.todayIso()
    const weekKey = input.weekKey ?? isoWeekKey(parseIsoDate(date))
    const weekEnd = weekDates(weekKey)[6] as string
    const rangeEnd = DateSchema.parse(input.rangeEnd ?? (input.mode === 'weekly' && weekEnd < date ? weekEnd : date))
    const rangeStart = DateSchema.parse(input.rangeStart ?? (input.mode === 'weekly' ? weekDates(weekKey)[0] : isoDate(addDays(parseIsoDate(rangeEnd), -1))))
    if (rangeStart > rangeEnd || rangeEnd > date || rangeStart < isoDate(addDays(parseIsoDate(rangeEnd), -30))) throw new Error('复盘区间最多 31 天，且不能包含未来')
    const first = weekDates(weekKey)[0]!
    const planStart = DateSchema.parse(input.planStart ?? (input.mode === 'plan' && first > date ? first : date))
    const planEnd = DateSchema.parse(input.planEnd ?? isoDate(addDays(parseIsoDate(planStart), 13)))
    if (planStart < date || planStart > planEnd || planEnd > isoDate(addDays(parseIsoDate(date), 30))) throw new Error('展望范围须从今天或之后开始，并在未来 31 天内')
    const key = `${weekKey}:${input.mode}`
    if (this.coachJobs.has(key)) throw new Error('计划教练正在处理这一周，请等这一轮完成')
    if (input.text.length > 30_000) throw new Error('一次描述请控制在 30000 字以内')
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    input.signal?.addEventListener('abort', onAbort, { once: true })
    if (input.signal?.aborted) controller.abort()
    this.coachJobs.set(key, controller)
    const stamp = new Date().toISOString()
    let run = WorkflowRunSchema.parse({ id: input.runId ?? newId('coach'), date, weekKey, mode: input.mode, rawText: input.text,
      status: 'running', phase: 'generating', createdAt: stamp, updatedAt: stamp, rangeStart, rangeEnd, planStart, planEnd,
      ...(input.replaceConflicts !== undefined ? { replaceConflicts: input.replaceConflicts } : {}) })
    try {
      await this.table('workflow_runs').put(run.id, run)
      input.onStarted?.()
      const settings = this.settings()
      const planningDays = Array.from({ length: Math.round((parseIsoDate(planEnd).getTime() - parseIsoDate(planStart).getTime()) / 86400000) + 1 }, (_, index) => {
        const day = this.dayPlan(isoDate(addDays(parseIsoDate(planStart), index)))
        const skeleton = generateDayBlocks({ courses: this.listCourses(), courseCalendar: settings.courseCalendar, routines: settings.routines,
          date: day.date, weekday: weekdayOf(parseIsoDate(day.date)), teachingWeek: teachingWeek(settings.termStart, parseIsoDate(day.date)), periods: this.periods(), dayEndPeriod: this.dayEndPeriod() })
        return { ...day, blocks: [...day.blocks, ...skeleton.filter((block) => !day.blocks.some((existing) => existing.id === block.id))] }
      })
      const result = await runCoach(this.ctx, { date, weekKey, mode: input.mode, text: input.text,
        context: { ...this.workflowContext(weekKey), upcomingDays: undefined, latestConversation: undefined, replaceConflicts: input.replaceConflicts === true, reviewDays: Array.from({ length: Math.round((parseIsoDate(rangeEnd).getTime() - parseIsoDate(rangeStart).getTime()) / 86400000) + 1 },
          (_, index) => this.dayPlan(isoDate(addDays(parseIsoDate(rangeStart), index)))),
          planningDays, currentMinute: this.currentMinute() }, rangeStart, rangeEnd, planStart, planEnd,
        provider: settings.agnes.provider, model: settings.agnes.model,
        agentPreset: settings.agnes.agentPreset, timeoutMs: settings.agnes.timeoutMinutes * 60_000,
        workspacePath: this.config.workspacePath, signal: controller.signal })
      run = WorkflowRunSchema.parse({ ...run, status: result.ok && !controller.signal.aborted ? 'ready' : 'failed', phase: controller.signal.aborted ? 'cancelled' : result.ok ? 'ready' : 'failed', draft: result.ok && !controller.signal.aborted ? fitEstimatedAppointments(normalizeAppointmentEvidence(result.value), {
          date, minute: this.currentMinute(), replaceConflicts: input.replaceConflicts === true, days: planningDays,
          minMinute: Math.min(...this.periods().map((period) => period.startMinute)),
          maxMinute: Math.max(...this.periods().filter((period) => period.index <= this.dayEndPeriod()).map((period) => period.endMinute)),
        }) : null,
        error: controller.signal.aborted ? '已停止整理，原文已保留。' : result.ok ? null : result.message, updatedAt: new Date().toISOString() })
      if (run.draft) run = this.supportedWorkflow(run)
      await this.table('workflow_runs').put(run.id, run)
      if (result.ok && input.apply === true && !controller.signal.aborted) return await this.workflowApply(run.id)
      return { run, allocation: null }
    } finally {
      input.signal?.removeEventListener('abort', onAbort)
      this.coachJobs.delete(key)
    }
  }

  /** Keep valid intentions usable without weakening evidence checks for actual facts. */
  private supportedWorkflow(run: WorkflowRunRecord): WorkflowRunRecord {
    const draft = structuredClone(run.draft!)
    const warnings = [...(run.applyWarnings ?? [])]
    const warn = (message: string) => { if (!warnings.includes(message)) warnings.push(message) }
    if (!run.factsApplied) {
      const fields = ['taskActions', 'executions', 'learningLogs', 'activityLogs', 'gymLogs'] as const
      for (const field of fields) {
        const accepted: any[] = [], seen = new Set<string>()
        for (const entry of draft[field]) {
          const evidence = entry.evidence?.trim()
          const key = 'taskId' in entry ? entry.taskId : 'blockId' in entry ? `${entry.date}:${entry.blockId}` : JSON.stringify(entry)
          const candidate: any = { ...draft, taskActions: [], executions: [], learningLogs: [], activityLogs: [], gymLogs: [], [field]: [entry] }
          try {
            if (!evidence || !run.rawText.includes(evidence)) throw new Error('缺少本次原文依据')
            if (field !== 'taskActions' && /打算|准备|计划|明天|下周|想去|可能去/.test(evidence) && !/完成|做完|练完|结束|读了|练了|做了|写完|去了|吃了/.test(evidence)) throw new Error('描述的是计划，不能记为已完成')
            if (seen.has(key)) throw new Error('重复记录')
            this.validateWorkflowFacts({ ...run, draft: candidate })
            seen.add(key); accepted.push(entry)
          } catch (error) { warn(`未补记${'title' in entry ? `「${entry.title}」` : '一项记录'}：${error instanceof Error ? error.message : String(error)}。有效安排仍可应用。`) }
        }
        ;(draft as any)[field] = accepted
      }
    }
    draft.appointments = draft.appointments.filter((event) => {
      if (event.evidence.trim() && run.rawText.includes(event.evidence)) return true
      const sources = [...this.table('workflow_runs').entries()] as [string, WorkflowRunRecord][]
      const source = sources.map(([, value]) => value).find((value) => value.id !== run.id && value.date === event.date && event.evidence.trim() && value.rawText.includes(event.evidence))
      const withdrawn = this.dayPlan(event.date).blocks.some((block) => block.title.trim() === event.title.trim() && block.appointment && !activeBlock(block))
      if (source && !withdrawn) { event.sourceRunId = source.id; return true }
      warn(`未新增「${event.title}」：没有可核验的用户原文，或旧安排已撤回。`)
      return false
    })
    return { ...run, draft, applyWarnings: warnings }
  }

  private validateWorkflowFacts(run: WorkflowRunRecord): void {
    const draft = run.draft!
    const validateEvidence = (evidence: string, date?: string | null) => {
      if (!run.rawText.includes(evidence)) throw new Error('执行记录缺少当前复盘中的原文依据，请重新整理')
      if (date && (date > this.todayIso() || date < (run.rangeStart ?? run.date) || date > (run.rangeEnd ?? run.date))) {
        throw new Error('实际执行日期超出所选复盘区间，请调整区间或重新整理')
      }
    }
    for (const action of draft.taskActions) {
      validateEvidence(action.evidence, action.date)
      const task = this.table('backlog').get(action.taskId) as BacklogItemRecord | undefined
      if (!task || task.done || task.state === 'cancelled') throw new Error('要调整的任务已不存在或已结束，请重新整理')
      if (action.action === 'complete' && !action.date) throw new Error('完成记录需要明确日期')
      if (action.action === 'cancel' && [...this.table('plans').entries()].some(([, day]: [string, DayPlanRecord]) => day.date === this.todayIso() &&
        day.blocks.some((block) => block.backlogId === action.taskId && activeBlock(block) && block.startMinute <= this.currentMinute() && block.endMinute > this.currentMinute()))) {
        throw new Error('任务正在进行，取消前请先更新实际执行状态')
      }
    }
    for (const entry of draft.executions) {
      validateEvidence(entry.evidence, entry.date)
      if (!this.dayPlan(entry.date).blocks.some((block) => block.id === entry.blockId)) throw new Error('补记对应的计划已不存在，请重新整理')
    }
    for (const entry of draft.learningLogs) {
      validateEvidence(entry.evidence, entry.date)
      matchByRefOrTitle<ReadingRecord | LearningItemRecord>(entry.kind === 'reading' ? this.listReading() : this.listLearning(), entry)
    }
    for (const entry of draft.activityLogs) validateEvidence(entry.evidence, entry.date)
    const uniqueExercises = new Set<string>()
    for (const entry of draft.gymLogs) {
      validateEvidence(entry.evidence, entry.date)
      for (const exercise of entry.exercises) {
        validateEvidence(exercise.evidence)
        if (exercise.exerciseId && !this.listExercises().some((item) => item.id === exercise.exerciseId)) throw new Error('动作引用已不存在，请重新整理')
        const key = `${entry.date}:${exercise.exerciseId ?? exercise.name.trim()}`
        if (uniqueExercises.has(key)) throw new Error('同一天同一动作请合并成一份实际记录')
        uniqueExercises.add(key)
      }
    }
    const ids = new Set<string>()
    for (const action of draft.taskActions) {
      if (ids.has(action.taskId)) throw new Error('同一任务的变更请合并后应用')
      ids.add(action.taskId)
    }
  }

  /** Remove only future unstarted copies; historical missed/unknown observations stay visible. */
  private async retireTaskCopies(taskId: string): Promise<void> {
    for (const [, day] of this.table('plans').entries() as IterableIterator<[string, DayPlanRecord]>) {
      if (day.date < this.todayIso()) continue
      const blocks = day.blocks.flatMap((block) => {
        if (block.backlogId !== taskId || block.done || !activeBlock(block) || !flexibleBlock(block)) return [block]
        // Wall-clock start is not evidence of execution. An automatic duplicate can be withdrawn after factual reconciliation.
        if (day.date === this.todayIso() && block.startMinute <= this.currentMinute() && !block.adaptive) {
          return [{ ...block, disposition: 'deferred' as const, note: `${block.note} 原任务已结束，撤回此重复安排。`.trim() }]
        }
        return []
      })
      if (JSON.stringify(blocks) !== JSON.stringify(day.blocks)) await this.saveDay({ ...day, blocks })
    }
  }

  private async acknowledgeExecution(date: string, blockId: string, status: 'completed' | 'missed', evidence: string): Promise<void> {
    const day = this.dayPlan(date)
    const block = day.blocks.find((entry) => entry.id === blockId)!
    const done = status === 'completed'
    await this.saveDay({ ...day, blocks: day.blocks.map((entry) => entry.id === blockId ? {
      ...entry, done, doneAt: done ? entry.doneAt ?? new Date().toISOString() : null, executionStatus: status, completionEvidence: evidence,
    } : entry) })
    const taskId = block.backlogId ?? `missed_${stableHash(`${date}:${block.id}`)}`
    const task = this.table('backlog').get(taskId) as BacklogItemRecord | undefined
    if (done && task) {
      await this.table('backlog').put(taskId, { ...task, done: true, state: 'completed' })
      await this.retireTaskCopies(taskId)
    }
  }

  private async applyWorkflowFacts(run: WorkflowRunRecord) {
    const draft = run.draft!
    const changes: string[] = [], warnings: string[] = []
    for (const action of draft.taskActions) {
      const task = this.table('backlog').get(action.taskId) as BacklogItemRecord
      if (action.action === 'update') {
        await this.upsertBacklog(BacklogItemSchema.parse({ ...task, ...action.patch }))
        for (const [, day] of this.table('plans').entries() as IterableIterator<[string, DayPlanRecord]>) {
          if (day.date < this.todayIso()) continue
          await this.saveDay({ ...day, blocks: day.blocks.map((block) => block.backlogId === task.id && !block.done && block.adaptive ? {
            ...block, title: action.patch.title ?? block.title,
            ...(action.patch.lifeArea ? { lifeArea: action.patch.lifeArea } : {}),
          } : block) })
        }
        changes.push(`任务池已更新：${action.patch.title ?? task.title}`)
      } else {
        if (action.action === 'complete') {
          for (const block of this.dayPlan(action.date!).blocks.filter((entry) => entry.backlogId === task.id || entry.id === task.originBlockId)) {
            await this.acknowledgeExecution(action.date!, block.id, 'completed', action.evidence)
          }
        }
        await this.table('backlog').put(task.id, { ...task, done: action.action === 'complete', state: action.action === 'complete' ? 'completed' : 'cancelled',
          ...(action.action === 'cancel' ? { cancelledBy: 'user' } : {}) })
        await this.retireTaskCopies(task.id)
        changes.push(`${action.action === 'complete' ? '已补记完成' : '已取消并保留历史'}：${task.title}`)
      }
    }
    for (const entry of draft.executions) {
      const title = this.dayPlan(entry.date).blocks.find((block) => block.id === entry.blockId)!.title
      await this.acknowledgeExecution(entry.date, entry.blockId, entry.status, entry.evidence)
      if (entry.lifeArea) {
        const day = this.dayPlan(entry.date)
        await this.saveDay({ ...day, blocks: day.blocks.map((block) => block.id === entry.blockId ? { ...block, lifeArea: entry.lifeArea } : block) })
      }
      changes.push(`${entry.date} ${entry.status === 'completed' ? '已补记完成' : '已记录未完成'}：${title}`)
    }
    const learningDates = [...new Set(draft.learningLogs.map((entry) => entry.date))].sort()
    for (const entry of draft.activityLogs) {
      const day = this.dayPlan(entry.date)
      const id = `observed_${stableHash(`${entry.date}:${entry.title.trim()}:${entry.lifeArea}`)}`
      const observation = { id, title: entry.title, lifeArea: entry.lifeArea, evidence: entry.evidence, sourceId: run.id }
      await this.saveDay({ ...day, observations: [...(day.observations ?? []).filter((item) => item.id !== id), observation] })
      changes.push(`${entry.date} 已补记实际活动：${entry.title}`)
    }
    for (const date of learningDates) {
      const updates = mergeLearningUpdates(draft.learningLogs.filter((entry) => entry.date === date))
      const applicable = updates.filter((entry) => {
        const source = matchByRefOrTitle<ReadingRecord | LearningItemRecord>(entry.kind === 'reading' ? this.listReading() : this.listLearning(), entry)
        const previous = source?.log.find((log) => log.date === date)
        if (previous && entry.mode === 'delta' && previous.value !== nextValue(source!.log, date, entry.mode, entry.value)) {
          warnings.push(`${date} ${entry.title}已有进度记录；新的增量与它不同，保留原记录，请核对或给累计值。`)
          return false
        }
        return true
      })
      warnings.push(...await this.applyLearningUpdates(applicable, date))
      for (const entry of applicable) changes.push(`${date} 已同步学习进度：${entry.title}`)
    }
    for (const entry of draft.gymLogs) {
      let session = this.gymSession(entry.date)
      for (const logged of entry.exercises) {
        let exercise = logged.exerciseId ? this.listExercises().find((item) => item.id === logged.exerciseId) : this.listExercises().find((item) => item.name.trim() === logged.name.trim())
        if (!exercise) exercise = await this.upsertExercise({ id: `review_ex_${stableHash(logged.name.trim())}`, name: logged.name, part: logged.part, custom: true })
        let item = session.items.find((candidate) => candidate.exerciseId === exercise!.id)
        if (!item) {
          item = { id: `review_gi_${stableHash(`${entry.date}:${exercise.id}`)}`, exerciseId: exercise.id, name: exercise.name,
            part: exercise.part, sets: Math.max(1, logged.sets.length), reps: '', weight: '', doneSets: 0, note: '', actualSets: [] }
          session = { ...session, items: [...session.items, item], focus: [...new Set([...session.focus, item.part])] }
        }
        if (logged.sets.length === 0) {
          warnings.push(`${entry.date} ${logged.name}：已记动作，次数不清楚，未生成实际组数。`)
          continue
        }
        const existing = item.actualSets ?? []
        const signature = (set: Pick<GymSetRecord, 'reps' | 'weight' | 'unit' | 'rir'>) => JSON.stringify([set.reps, set.weight, set.unit, set.rir])
        if (existing.length > 0) {
          if (JSON.stringify(existing.map(signature)) !== JSON.stringify(logged.sets.map(signature))) warnings.push(`${entry.date} ${logged.name}已有实际组记录，与本次描述不同；保留原记录，待核对。`)
          else changes.push(`${entry.date} ${logged.name}：已核对已有记录，未重复添加。`)
          continue
        }
        const actualSets = logged.sets.map((set, index) => GymSetSchema.parse({ ...set,
          id: `recall_${stableHash(`${entry.date}:${exercise!.id}:${index}`)}`, source: 'review', evidence: logged.evidence }))
        session = { ...session, items: session.items.map((candidate) => candidate.id === item!.id ? { ...candidate, actualSets, doneSets: actualSets.length } : candidate) }
        changes.push(`${entry.date} ${logged.name}：补记 ${actualSets.length} 组实际表现。`)
      }
      session = await this.saveSession({ ...session, ...(entry.finished ? { finishedAt: session.finishedAt ?? new Date().toISOString(), completionEvidence: entry.evidence } : {}) })
      if (entry.finished) {
        for (const block of this.dayPlan(entry.date).blocks.filter((block) => block.category === 'gym')) {
          await this.acknowledgeExecution(entry.date, block.id, 'completed', entry.evidence)
        }
        changes.push(`${entry.date} 已补记训练出勤；未提供的组数和重量保持空白。`)
      }
    }
    if (run.mode === 'review') {
      const date = run.rangeEnd ?? run.date
      const existing = this.review(date)
      const structured = StructuredReviewSchema.parse({ summary: draft.summary, adjustments: draft.focus,
        energy: date === this.todayIso() ? draft.energy : null })
      if (existing && existing.raw.text.trim() !== '' && existing.sourceRunId !== run.id) {
        changes.push('本次区间复盘已保存在教练记录；原有每日复盘保持原文。')
      } else {
        await this.table('reviews').put(date, ReviewSchema.parse({ ...(existing ?? {}), date,
          raw: { text: run.rawText, usedPrompts: [] }, structured, status: 'structured', sourceRunId: run.id,
          rangeStart: run.rangeStart, rangeEnd: run.rangeEnd, daySnapshot: this.daySnapshot(date),
          createdAt: existing?.createdAt ?? run.createdAt, updatedAt: new Date().toISOString(), applyWarnings: warnings }))
        changes.push('已保存复盘原文与区间，后续计划可以使用这次反馈。')
      }
    }
    return { changes, warnings }
  }

  /** Edit future intentions in place after applying, without replaying any facts. */
  workflowEditSchedule(id: string, input: unknown, expectedUpdatedAt?: string): Promise<WorkflowRunRecord> {
    return this.enqueueAllocation(async () => {
      const run = this.table('workflow_runs').get(id) as WorkflowRunRecord | undefined
      if (!run?.draft || run.status !== 'applied') throw new Error('请先应用安排，再保存日程微调')
      if (expectedUpdatedAt && run.updatedAt !== expectedUpdatedAt) throw new Error('安排已有新版本，请重新打开后修改')
      const parsed = WorkflowDraftEditsSchema.safeParse(input)
      if (!parsed.success) throw new Error('请填写名称、日期与完整的起止时间')
      const edits = parsed.data
      if (new Set(edits.appointments.map((edit) => edit.index)).size !== edits.appointments.length) throw new Error('微调活动重复')
      for (const edit of edits.tasks) {
        const task = run.draft.tasks[edit.index]
        if (!task || task.title !== edit.title || task.dueDate !== edit.dueDate || task.note !== edit.note || edit.startMinute !== null || edit.endMinute !== null) throw new Error('任务池目标请用文字调整，已保存活动可直接微调')
      }
      const draft = structuredClone(run.draft)
      const moves: { oldDate: string; date: string; id: string; block: PlanBlockRecord }[] = []
      const periods = this.periods().filter((period) => period.index <= this.dayEndPeriod())
      const receipts: string[] = []
      for (const edit of edits.appointments) {
        const event = run.draft.appointments[edit.index]
        if (!event) throw new Error('活动已不存在')
        if (event.title === edit.title && event.date === edit.date && event.startMinute === edit.startMinute && event.endMinute === edit.endMinute && event.note === edit.note) continue
        const blockId = event.blockId ?? `appointment_${stableHash(`${event.date}:${event.title.trim()}:${event.startMinute}:${event.endMinute}`)}`
        const block = this.dayPlan(event.date).blocks.find((item) => item.id === blockId)
        if (!block || !activeBlock(block) || block.locked || block.done || block.executionStatus === 'completed' || !block.appointment || block.source !== 'manual' ||
          event.date < this.todayIso() || (event.date === this.todayIso() && block.startMinute <= this.currentMinute())) throw new Error('已开始、已完成、固定或撤下的活动不能在这里修改')
        if (block.title !== event.title.trim() || block.startMinute !== event.startMinute || block.endMinute !== event.endMinute || block.note !== event.note) throw new Error('这项日程已在其他地方调整，请重新让 Agnes 整理后再修改')
        if (edit.startMinute === null || edit.endMinute === null || edit.endMinute <= edit.startMinute) throw new Error('请填写完整起止时间，结束须晚于开始')
        if (edit.date < this.todayIso() || edit.date < (run.planStart ?? this.todayIso()) || edit.date > (run.planEnd ?? isoDate(addDays(parseIsoDate(this.todayIso()), 13))) ||
          (edit.date === this.todayIso() && edit.startMinute < this.currentMinute())) throw new Error('时间超出当前安排范围或已经过去')
        if (edit.startMinute < Math.min(...periods.map((period) => period.startMinute)) || edit.endMinute > Math.max(...periods.map((period) => period.endMinute))) throw new Error('时间超出作息范围，请先在设置中扩展时段')
        if (block.category === 'gym' && edit.date !== event.date) throw new Error('训练改日请用文字告诉 Agnes，以便一起移动训练计划')
        const covered = periods.filter((period) => period.startMinute < edit.endMinute! && period.endMinute > edit.startMinute!)
        const nearest = periods.reduce((best, period) => Math.abs(period.startMinute - edit.startMinute!) < Math.abs(best.startMinute - edit.startMinute!) ? period : best)
        const next = PlanBlockSchema.parse({ ...block, title: edit.title.trim(), note: edit.note, startMinute: edit.startMinute, endMinute: edit.endMinute,
          weekday: weekdayOf(parseIsoDate(edit.date)), startPeriod: covered[0]?.index ?? nearest.index, endPeriod: covered.at(-1)?.index ?? nearest.index, timeBasis: 'manual', timeAssumption: '' })
        moves.push({ oldDate: event.date, date: edit.date, id: blockId, block: next })
        draft.appointments[edit.index] = { ...event, blockId, title: next.title, date: edit.date, startMinute: edit.startMinute, endMinute: edit.endMinute, note: edit.note, timeBasis: 'manual', timeAssumption: '' }
        receipts.push(`${edit.date} 已微调活动：${next.title} · ${formatHm(next.startMinute)}–${formatHm(next.endMinute)}`)
      }
      if (!moves.length) return run
      const affected = [...new Set(moves.flatMap((move) => [move.oldDate, move.date]))]
      const original = affected.map((date) => this.dayPlan(date))
      const nextDays = original.map((day) => ({ ...day, blocks: [
        ...day.blocks.filter((block) => !moves.some((move) => move.oldDate === day.date && move.id === block.id)),
        ...moves.filter((move) => move.date === day.date).map((move) => move.block),
      ] }))
      for (const move of moves) {
        const skeleton = generateDayBlocks({ courses: this.listCourses(), courseCalendar: this.settings().courseCalendar, routines: this.settings().routines,
          date: move.date, weekday: weekdayOf(parseIsoDate(move.date)), teachingWeek: teachingWeek(this.settings().termStart, parseIsoDate(move.date)), periods: this.periods(), dayEndPeriod: this.dayEndPeriod() })
        const conflict = [...nextDays.find((day) => day.date === move.date)!.blocks, ...skeleton].find((other) => other.id !== move.id && activeBlock(other) && other.startMinute < move.block.endMinute && other.endMinute > move.block.startMinute)
        if (conflict) throw new Error(`「${move.block.title}」与「${conflict.title}」时间重叠，请修改时间，或通过文字让 Agnes 一起重排`)
      }
      const updated = WorkflowRunSchema.parse({ ...run, draft, appliedChanges: [...(run.appliedChanges ?? []), ...receipts], updatedAt: new Date(Math.max(Date.now(), Date.parse(run.updatedAt) + 1)).toISOString() })
      try {
        for (const day of nextDays) await this.saveDay(day)
        await this.table('workflow_runs').put(id, updated)
      } catch (error) {
        for (const day of original) await this.saveDay(day)
        throw error
      }
      return updated
    })
  }

  workflowEditDraft(id: string, input: unknown, expectedUpdatedAt?: string): Promise<WorkflowRunRecord> {
    return this.enqueueAllocation(async () => {
      const run = this.table('workflow_runs').get(id) as WorkflowRunRecord | undefined
      if (!run?.draft || run.status !== 'ready' || run.factsApplied || run.intentApplied) throw new Error('只能微调尚未应用的建议；已开始应用的建议请先重试')
      if (expectedUpdatedAt && expectedUpdatedAt !== run.updatedAt) throw new Error('建议已有新版本，请重新打开后微调')
      const parsedEdits = WorkflowDraftEditsSchema.safeParse(input)
      if (!parsedEdits.success) throw new Error('微调内容不完整，请填写名称、日期及有效时间')
      const edits = parsedEdits.data
      if (new Set(edits.tasks.map((edit) => edit.index)).size !== edits.tasks.length || new Set(edits.appointments.map((edit) => edit.index)).size !== edits.appointments.length) throw new Error('微调条目重复')
      const draft = structuredClone(run.draft)
      const lines: string[] = []
      const converted = new Set<number>()
      const editedTitles: string[] = []
      const validate = (date: string, start: number | null, end: number | null) => {
        if (date < this.todayIso() || date > (run.planEnd ?? isoDate(addDays(parseIsoDate(this.todayIso()), 13))) || date < (run.planStart ?? this.todayIso())) throw new Error('微调日期超出当前展望范围')
        if (start !== null && end !== null && end <= start) throw new Error('结束时间须晚于开始时间，跨日活动请分开安排')
      }
      const line = (date: string, title: string, start: number | null, end: number | null) => `用户微调计划：${date} ${title.slice(0, 200)}；${start === null ? '开始待定' : formatHm(start)}–${end === null ? '结束待定' : formatHm(end)}。`
      for (const edit of edits.tasks) {
        const task = draft.tasks[edit.index]
        if (!task) throw new Error('微调任务已不存在')
        if ((edit.startMinute === null) !== (edit.endMinute === null)) throw new Error(`「${edit.title}」指定时段时请同时填写起止时间`)
        if (edit.startMinute !== null && edit.endMinute !== null) {
          validate(edit.date, edit.startMinute, edit.endMinute)
          const evidence = line(edit.date, edit.title, edit.startMinute, edit.endMinute)
          draft.appointments.push({ date: edit.date, title: edit.title, category: task.category, ...(task.lifeArea ? { lifeArea: task.lifeArea } : {}),
            startMinute: edit.startMinute, endMinute: edit.endMinute, note: edit.note, evidence, learningRef: task.learningRef, learningKind: task.learningKind })
          converted.add(edit.index); lines.push(evidence)
        } else if (task.title !== edit.title || task.dueDate !== edit.dueDate || task.note !== edit.note) {
          draft.tasks[edit.index] = { ...task, title: edit.title, dueDate: edit.dueDate, note: edit.note }
          lines.push(`用户微调任务：${edit.title}；截止 ${edit.dueDate ?? '不限'}。`)
        }
      }
      for (const edit of edits.appointments) {
        const event = run.draft.appointments[edit.index]
        if (!event) throw new Error('微调活动已不存在')
        validate(edit.date, edit.startMinute, edit.endMinute)
        if (event.title === edit.title && event.date === edit.date && event.startMinute === edit.startMinute && event.endMinute === edit.endMinute && event.note === edit.note && !event.needsTimeConfirmation) continue
        const evidence = line(edit.date, edit.title, edit.startMinute, edit.endMinute)
        draft.appointments[edit.index] = { ...event, date: edit.date, title: edit.title, startMinute: edit.startMinute ?? event.startMinute,
          endMinute: edit.endMinute ?? event.endMinute, note: edit.note, evidence, needsTimeConfirmation: edit.startMinute === null || edit.endMinute === null }
        if (edit.startMinute !== null && edit.endMinute !== null) {
          draft.appointments[edit.index]!.timeBasis = 'manual'
          draft.appointments[edit.index]!.timeAssumption = ''
        }
        lines.push(evidence); editedTitles.push(event.title)
      }
      if (lines.length === 0) return run
      draft.tasks = draft.tasks.filter((_, index) => !converted.has(index))
      draft.questions = draft.questions.filter((question) => !editedTitles.some((title) => question.startsWith(`「${title.slice(0, 100)}」的起止时间还不明确`)))
      const rawText = `${run.rawText}\n\n【用户手动微调，覆盖对应计划条目】\n${lines.join('\n')}`
      if (rawText.length > 30_000) throw new Error('原文与微调记录超过 30000 字，请减少描述后重试')
      const updated = WorkflowRunSchema.parse({ ...run, rawText, draft: normalizeAppointmentEvidence(draft), updatedAt: new Date().toISOString() })
      await this.table('workflow_runs').put(id, updated)
      return updated
    })
  }

  workflowApply(id: string, replaceConflicts?: boolean): Promise<{ run: WorkflowRunRecord; allocation: AdaptiveResult | null }> {
    return this.enqueueAllocation(async () => {
      let run = this.table('workflow_runs').get(id) as WorkflowRunRecord | undefined
      if (!run || !run.draft) throw new Error('没有可应用的计划建议')
      if (run.status === 'applied') return { run, allocation: null }
      if (run.status !== 'ready') throw new Error('这一轮尚未完成')
      if (run.date !== this.todayIso()) throw new Error('这份建议已跨天，请根据今天的情况重新整理')
      run = this.supportedWorkflow(run)
      const draft = run.intentApplied ? run.draft! : normalizeAppointmentEvidence(run.draft!)
      run = { ...run, draft, phase: 'applying', error: null, replaceConflicts: replaceConflicts ?? run.replaceConflicts ?? false }
      await this.table('workflow_runs').put(id, run)
      const replacements = new Map<string, { date: string; block: PlanBlockRecord }>()
      const handleConflict = (date: string, title: string, block: PlanBlockRecord): void => {
        const completingNow = draft.executions.some((entry) => entry.date === date && entry.blockId === block.id && entry.status === 'completed') ||
          draft.taskActions.some((action) => action.action === 'complete' && action.date === date && action.taskId === block.backlogId)
        if (!run!.replaceConflicts || block.locked || block.done || completingNow || ['course', 'routine'].includes(block.source) || block.executionStatus === 'completed') {
          throw new Error(`${date} 的「${title}」与「${block.title}」冲突；固定课表和已完成记录不会被覆盖${run!.replaceConflicts ? '' : '，可选择以本次描述为准移开旧安排'}`)
        }
        replacements.set(`${date}:${block.id}`, { date, block })
      }
      const rescheduleIds = run.intentApplied ? [] : draft.rescheduleBlockIds
      if (rescheduleIds.length > 0 && (!['replan', 'review'].includes(run.mode) || run.rawText.trim() === '')) throw new Error('只有明确的动态调整请求才能释放手动安排')
      const released = weekDates(run.weekKey).flatMap((date) => this.dayPlan(date).blocks.filter((block) => rescheduleIds.includes(block.id)).map((block) => ({ date, block })))
      for (const id of rescheduleIds) {
        const entry = released.find((entry) => entry.block.id === id)
        if (!entry || !activeBlock(entry.block) || !flexibleBlock(entry.block) || entry.block.done || entry.date < this.todayIso() ||
          (entry.date === this.todayIso() && entry.block.startMinute <= this.currentMinute())) throw new Error('不能重排已开始、已完成、固定或不存在的安排')
      }
      // Validate every reference and constraint before the first write.
      for (const task of run.intentApplied ? [] : [...draft.tasks, ...draft.appointments]) {
        if (task.learningRef && !(task.learningKind === 'reading' ? this.listReading() : this.listLearning()).some((item) => item.id === task.learningRef)) {
          throw new Error(`学习记录不存在：${task.title}`)
        }
      }
      if (!run.factsApplied) this.validateWorkflowFacts(run)
      const planStart = run.planStart ?? this.todayIso()
      const planEnd = run.planEnd ?? isoDate(addDays(parseIsoDate(this.todayIso()), 13))
      const appointments = (run.intentApplied ? [] : draft.appointments).map((event) => {
        const sourceText = event.sourceRunId ? this.table('workflow_runs').get(event.sourceRunId)?.rawText : run.rawText
        if (!event.evidence.trim() || !sourceText?.includes(event.evidence)) throw new Error('未来活动缺少可核验的原文依据，请重新整理')
        if (event.date < planStart || event.date > planEnd || event.date < this.todayIso() ||
          (event.date === this.todayIso() && event.startMinute < this.currentMinute())) throw new Error('未来活动超出展望范围，或开始时间已过去，请调整范围或重新整理')
        const periods = this.periods().filter((period) => period.index <= this.dayEndPeriod())
        if (event.startMinute < Math.min(...periods.map((p) => p.startMinute)) || event.endMinute > Math.max(...periods.map((p) => p.endMinute))) {
          throw new Error(`${event.date} 的活动超出当前日程显示时段，请先在设置中扩展作息时间`)
        }
        const covered = periods.filter((period) => period.startMinute < event.endMinute && period.endMinute > event.startMinute)
        // A commitment entirely inside a break still needs a visible calendar row.
        const nearest = periods.reduce((best, period) => Math.abs(period.startMinute - event.startMinute) < Math.abs(best.startMinute - event.startMinute) ? period : best)
        const block = PlanBlockSchema.parse({ ...event, id: `appointment_${stableHash(`${event.date}:${event.title.trim()}:${event.startMinute}:${event.endMinute}`)}`,
          title: event.title.trim(), weekday: weekdayOf(parseIsoDate(event.date)), source: 'manual', appointment: true, gymDate: event.category === 'gym' ? event.date : null,
          startPeriod: covered[0]?.index ?? nearest.index, endPeriod: covered.at(-1)?.index ?? nearest.index })
        const skeleton = generateDayBlocks({ courses: this.listCourses(), courseCalendar: this.settings().courseCalendar, routines: this.settings().routines,
          date: event.date, weekday: weekdayOf(parseIsoDate(event.date)), teachingWeek: teachingWeek(this.settings().termStart, parseIsoDate(event.date)),
          periods: this.periods(), dayEndPeriod: this.dayEndPeriod() })
        const conflicts = [...this.dayPlan(event.date).blocks, ...skeleton].filter((existing) => existing.id !== block.id && !rescheduleIds.includes(existing.id) && activeBlock(existing) &&
          (!existing.adaptive || existing.done || (event.date === this.todayIso() && existing.startMinute <= this.currentMinute())) &&
          existing.startMinute < event.endMinute && existing.endMinute > event.startMinute)
        for (const conflict of conflicts) handleConflict(event.date, event.title, conflict)
        return { date: event.date, block }
      })
      for (const [index, event] of appointments.entries()) {
        if (appointments.slice(0, index).some((other) => other.date === event.date && other.block.id !== event.block.id &&
          other.block.startMinute < event.block.endMinute && other.block.endMinute > event.block.startMinute) ||
          (!run.intentApplied && draft.unavailable.some((window) => { const range = periodRange(this.periods(), window.startPeriod, window.endPeriod); return window.date === event.date && range.startMinute < event.block.endMinute && range.endMinute > event.block.startMinute }))) {
          throw new Error(`${event.date} 的新活动互相重叠，请说明时间或取舍`)
        }
      }
      for (const [windowIndex, window] of (run.intentApplied ? [] : draft.unavailable).entries()) {
        if (window.date < planStart || window.date > planEnd ||
          !this.periods().some((period) => period.index === window.startPeriod) || !this.periods().some((period) => period.index === window.endPeriod)) {
          throw new Error('临时事件超出展望或作息节次范围')
        }
        const skeleton = generateDayBlocks({ courses: this.listCourses(), courseCalendar: this.settings().courseCalendar, routines: this.settings().routines, date: window.date,
          weekday: weekdayOf(parseIsoDate(window.date)), teachingWeek: teachingWeek(this.settings().termStart, parseIsoDate(window.date)),
          periods: this.periods(), dayEndPeriod: this.dayEndPeriod() })
        const conflicts = [...this.dayPlan(window.date).blocks, ...skeleton].filter((block) => !draft.rescheduleBlockIds.includes(block.id) && block.id !== `event:${run.id}:${windowIndex}` && activeBlock(block) &&
          (!block.adaptive || block.done || (window.date === this.todayIso() && block.startMinute <= this.currentMinute() && block.endMinute > this.currentMinute())) &&
          block.startPeriod <= window.endPeriod && block.endPeriod >= window.startPeriod)
        for (const conflict of conflicts) handleConflict(window.date, window.reason, conflict)
      }
      const feedback = run.factsApplied ? { changes: run.appliedChanges ?? [], warnings: run.applyWarnings ?? [] } : await this.applyWorkflowFacts(run)
      feedback.warnings = [...new Set([...(run.applyWarnings ?? []), ...feedback.warnings])]
      await this.table('workflow_runs').put(id, { ...run, factsApplied: true, appliedChanges: feedback.changes, applyWarnings: feedback.warnings })
      for (const { date, block } of replacements.values()) {
        const current = this.dayPlan(date).blocks.find((existing) => existing.id === block.id)
        if (!current || !activeBlock(current) || current.done) continue
        if (block.backlogId || (!block.appointment && block.category !== 'activity')) {
          const taskId = block.backlogId ?? `replace_${stableHash(`${date}:${block.id}`)}`
          const previous = this.allTasks().find((task) => task.id === taskId)
          if (previous?.done || previous?.state === 'completed' || previous?.state === 'cancelled') continue
          await this.upsertBacklog({ ...previous, id: taskId, title: block.title, category: block.category,
            estimatePeriods: block.endPeriod - block.startPeriod + 1, originDate: previous?.originDate ?? date,
            originBlockId: previous?.originBlockId ?? block.id, gymDate: block.gymDate, colorKey: block.colorKey,
            learningRef: block.learningRef ?? null, learningKind: block.learningKind ?? null,
            ...(block.lifeArea ? { lifeArea: block.lifeArea } : {}),
            notBefore: previous?.notBefore && previous.notBefore > date ? previous.notBefore : date, state: 'queued', done: false })
        }
        const day = this.dayPlan(date)
        await this.saveDay({ ...day, blocks: day.blocks.map((existing) => existing.id === block.id ? { ...existing, disposition: 'deferred' } : existing) })
        feedback.changes.push(`${date} 已撤下旧安排：${block.title}（以本次描述为准）`)
        // Checkpoint each replacement so retries do not recreate a released goal.
        await this.table('workflow_runs').put(id, { ...run, factsApplied: true, appliedChanges: feedback.changes, applyWarnings: feedback.warnings })
      }
      for (const { date, block } of released) {
        const taskId = block.backlogId ?? `release_${stableHash(`${date}:${block.id}`)}`
        await this.upsertBacklog({ id: taskId, title: block.title, category: block.category, estimatePeriods: block.endPeriod - block.startPeriod + 1,
          originDate: date, originBlockId: block.id, gymDate: block.gymDate, learningRef: block.learningRef ?? null, learningKind: block.learningKind ?? null,
          colorKey: block.colorKey, notBefore: this.todayIso(), preferredPeriod: block.startPeriod, done: false, state: 'queued' })
        const day = this.dayPlan(date)
        await this.saveDay({ ...day, blocks: day.blocks.map((item) => item.id === block.id ? { ...item, disposition: 'deferred' } : item) })
      }
      for (const [index, task] of (run.intentApplied ? [] : draft.tasks).entries()) {
        const duplicate = this.allTasks().find((item) => !item.done && item.title.trim() === task.title.trim() && item.category === task.category)
        if (duplicate) continue
        await this.upsertBacklog({ id: `intent_${stableHash(`${run.id}:${index}`)}`, title: task.title, category: task.category,
          ...(task.lifeArea ? { lifeArea: task.lifeArea } : {}),
          estimatePeriods: task.periods, priority: task.priority, dueDate: task.dueDate,
          notBefore: run.mode === 'plan' && (!task.notBefore || task.notBefore < planStart) ? planStart : task.notBefore,
          preferredPeriod: task.preferredPeriod, earliestPeriod: task.earliestPeriod, latestPeriod: task.latestPeriod,
          learningRef: task.learningRef, learningKind: task.learningKind, note: task.note, weekKey: run.weekKey })
        feedback.changes.push(`任务池新增：${task.title}`)
      }
      for (const [index, window] of (run.intentApplied ? [] : draft.unavailable).entries()) {
        const day = this.dayPlan(window.date)
        const range = periodRange(this.periods(), window.startPeriod, window.endPeriod)
        const block = PlanBlockSchema.parse({ id: `event:${run.id}:${index}`, title: window.reason, category: 'activity',
          weekday: weekdayOf(parseIsoDate(window.date)), ...window, ...range, source: 'manual' })
        await this.saveDay({ ...day, blocks: [...day.blocks.filter((item) => item.id !== block.id), block] })
        feedback.changes.push(`${window.date} 已保留临时占用：${window.reason}`)
      }
      for (const [index, { date, block }] of appointments.entries()) {
        draft.appointments[index]!.blockId = block.id
        const day = this.dayPlan(date)
        if (day.blocks.some((existing) => existing.id === block.id)) continue
        await this.saveDay({ ...day, blocks: [...day.blocks, block] })
        feedback.changes.push(`${date} 已安排活动：${block.title} · ${formatHm(block.startMinute)}–${formatHm(block.endMinute)}`)
      }
      for (const memory of run.intentApplied ? [] : draft.memories) {
        if (!run.rawText.includes(memory.evidence)) continue
        const memoryId = `memory_${stableHash(memory.text)}`
        if (this.table('personal_memory').get(memoryId)?.active === false) continue
        await this.table('personal_memory').put(memoryId, PersonalMemorySchema.parse({ id: memoryId, ...memory, sourceId: run.id, date: run.date }))
      }
      if (!run.intentApplied && draft.planningEvidence !== '' && run.rawText.includes(draft.planningEvidence)) {
        await this.updateSettings({ planning: draft.planningPatch })
        feedback.changes.push('已更新长期安排偏好，依据保存在本次原文。')
      }
      if (!run.intentApplied && draft.fitnessEvidence !== '' && run.rawText.includes(draft.fitnessEvidence)) {
        await this.updateSettings({ fitness: draft.fitnessPatch })
        feedback.changes.push('已更新训练目标、经验或约束。')
      }
      await this.table('workflow_runs').put(id, { ...run, factsApplied: true, intentApplied: true, appliedChanges: feedback.changes, applyWarnings: feedback.warnings })
      const first = weekDates(run.weekKey)[0] as string
      const start = run.mode === 'plan' ? planStart : first > this.todayIso() ? first : this.todayIso()
      const eventDates = [...draft.appointments, ...draft.unavailable].map((event) => event.date).filter((date) => date >= start)
      const through = run.mode === 'plan' ? planEnd : eventDates.length > 0 ? [...eventDates, isoDate(addDays(parseIsoDate(start), 6))].sort().at(-1) : undefined
      const allocation = await this.replanCore(start, draft.energy, through)
      const focusWeek = (weekDates(run.weekKey)[6] as string) < this.todayIso() ? isoWeekKey(parseIsoDate(start)) : run.weekKey
      for (const date of draft.focus.length > 0 ? weekDates(focusWeek) : []) {
        const day = this.dayPlan(date)
        if (date >= this.todayIso()) await this.saveDay({ ...day, focus: draft.focus.join('；') })
      }
      const next = WorkflowRunSchema.parse({ ...run, status: 'applied', phase: 'applied', factsApplied: true, intentApplied: true,
        appliedChanges: feedback.changes, applyWarnings: feedback.warnings, updatedAt: new Date().toISOString() })
      await this.table('workflow_runs').put(id, next)
      return { run: next, allocation }
    }).catch(async (error) => {
      const current = this.table('workflow_runs').get(id)
      if (current && current.status !== 'applied') await this.table('workflow_runs').put(id, { ...current, phase: 'ready', error: error instanceof Error ? error.message : String(error) })
      throw error
    })
  }

  // ── stats ─────────────────────────────────────────────────────────────────

  /* ── reading & learning ─────────────────────────────────────────────────── */

  listReading(): ReadingRecord[] {
    return [...(this.table('reading').entries() as IterableIterator<[string, ReadingRecord]>)]
      .map(([, item]) => item)
      .filter((item) => !item.archived)
      .sort(
        (left, right) =>
          statusRank(left.status) - statusRank(right.status) ||
          asText(right.updatedAt).localeCompare(asText(left.updatedAt)),
      )
  }

  listLearning(): LearningItemRecord[] {
    return [...(this.table('learning').entries() as IterableIterator<[string, LearningItemRecord]>)]
      .map(([, item]) => item)
      .filter((item) => !item.archived)
      .sort(
        (left, right) =>
          statusRank(left.status) - statusRank(right.status) ||
          asText(right.updatedAt).localeCompare(asText(left.updatedAt)),
      )
  }

  async upsertReading(input: Partial<ReadingRecord> & { title: string }): Promise<ReadingRecord> {
    const table = this.table('reading')
    const id = input.id ?? newId('r')
    const existing = (typeof table.get === 'function' ? table.get(id) : undefined) as
      | ReadingRecord
      | null
      | undefined
    const now = new Date().toISOString()
    const next = ReadingSchema.parse({
      ...(existing ?? {}),
      id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...input,
    })
    await table.put(id, next)
    return next
  }

  async removeReading(id: string): Promise<{ readonly ok: true }> {
    await this.table('reading').delete(id)
    return { ok: true } as const
  }

  /** Records "I'm here now" for one book. Later edits to the same day overwrite it. */
  async setReadingProgress(id: string, value: number, date?: string): Promise<ReadingRecord> {
    const table = this.table('reading')
    const existing = table.get(id) as ReadingRecord | undefined
    if (existing === undefined) throw new Error('没有这本书')
    const day = date ?? this.todayIso()
    const log = [...existing.log.filter((entry) => entry.date !== day), { date: day, value: Math.max(0, Math.round(value)) }]
      .sort((left, right) => left.date.localeCompare(right.date))
    const next = ReadingSchema.parse({
      ...existing,
      progress: log.at(-1)?.value ?? 0,
      status: existing.total > 0 && (log.at(-1)?.value ?? 0) >= existing.total ? 'done' : existing.status === 'paused' ? 'paused' : 'reading',
      log,
      updatedAt: new Date().toISOString(),
    })
    await table.put(id, next)
    return next
  }

  async upsertLearning(input: Partial<LearningItemRecord> & { title: string }): Promise<LearningItemRecord> {
    const table = this.table('learning')
    const id = input.id ?? newId('l')
    const existing = (typeof table.get === 'function' ? table.get(id) : undefined) as
      | LearningItemRecord
      | null
      | undefined
    const now = new Date().toISOString()
    const next = LearningItemSchema.parse({
      ...(existing ?? {}),
      id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...input,
    })
    await table.put(id, next)
    return next
  }

  async removeLearning(id: string): Promise<{ readonly ok: true }> {
    await this.table('learning').delete(id)
    return { ok: true } as const
  }

  /** Same shape as reading: `value` is where the counter stands at end of `date`. */
  async setLearningCount(id: string, value: number, date?: string): Promise<LearningItemRecord> {
    const table = this.table('learning')
    const existing = table.get(id) as LearningItemRecord | undefined
    if (existing === undefined) throw new Error('没有这条学习记录')
    const day = date ?? this.todayIso()
    const total = Math.max(0, Math.round(value))
    const log = [...existing.log.filter((entry) => entry.date !== day), { date: day, value: total }].sort(
      (left, right) => left.date.localeCompare(right.date),
    )
    const next = LearningItemSchema.parse({
      ...existing,
      done: log.at(-1)?.value ?? 0,
      status: existing.target > 0 && (log.at(-1)?.value ?? 0) >= existing.target ? 'done' : existing.status === 'paused' ? 'paused' : 'active',
      log,
      updatedAt: new Date().toISOString(),
    })
    await table.put(id, next)
    return next
  }

  /**
   * Everything the Learn page shows. The arithmetic lives in learn.ts (and is
   * unit-tested); this only hands it the records.
   */
  learnWeekStats(from: string, to: string) {
    return weekGains(this.listReading(), this.listLearning(), from, to)
  }

  learnStreak(): number {
    return activeStreak(this.listReading(), this.listLearning(), this.todayIso())
  }

  statsRange(from: string, to: string): DayStat[] {
    const settings = this.settings()
    const plans = new Map<string, DayPlanRecord>()
    for (const [key, value] of this.table('plans').entries() as IterableIterator<[string, DayPlanRecord]>) {
      plans.set(key, value)
    }
    const sessions = new Map<string, GymSessionRecord>()
    for (const [key, value] of this.table('gym_sessions').entries() as IterableIterator<[string, GymSessionRecord]>) {
      sessions.set(key, value)
    }
    const reviews = new Map<string, ReviewRecord>()
    for (const [key, value] of this.table('reviews').entries() as IterableIterator<[string, ReviewRecord]>) {
      reviews.set(key, value)
    }
    return buildRange(from, to, plans, sessions, reviews, {
      countCourseBlocks: settings.countCourseBlocks,
      now: this.now(),
    })
  }

  statsSummary(from: string, to: string): StatsSummary {
    return summarize(this.statsRange(from, to), {
      threshold: this.settings().streakThreshold,
      todayIso: this.todayIso(),
    })
  }

  statsDay(date: string) {
    const plan = this.plan(date) ?? this.emptyDay(date)
    const session = this.table('gym_sessions').get(date) as GymSessionRecord | undefined
    const review = this.review(date)
    const settings = this.settings()
    return {
      date,
      plan,
      session: session ?? null,
      sessionProgress: sessionProgress(session?.items ?? []),
      review,
      stat: computeDayStat(date, plan, session, review ?? undefined, {
        countCourseBlocks: settings.countCourseBlocks,
        todayIso: this.todayIso(),
      }),
    }
  }

  // ── snapshot / export ─────────────────────────────────────────────────────

  snapshot(date?: string, weekKey?: string): PlanSnapshot {
    const today = date ?? this.todayIso()
    const key = weekKey ?? isoWeekKey(parseIsoDate(today))
    return {
      today: this.dayPlan(today),
      week: weekDates(key).map((day) => this.dayPlan(day)),
      weekKey: key,
      courses: this.listCourses(),
      backlog: this.listBacklog(),
      gymSession: this.gymSession(today),
      // One row per day of the browsed week, so a gym block can say what is in
      // it without the client having to fetch seven sessions.
      gymWeek: weekDates(key).map((day) => {
        const stored = this.table('gym_sessions').get(day) as GymSessionRecord | undefined
        const items = stored?.items ?? []
        return {
          date: day,
          actions: items.length,
          sets: items.reduce((sum, item) => sum + item.sets, 0),
          parts: stored?.focus ?? [],
          planned: items.length > 0,
        }
      }),
      exercises: this.listExercises(),
      gymFocus:
        this.gymSession(today).focus.length > 0
          ? { focus: this.gymSession(today).focus, reason: 'set' }
          : this.suggestGymFocus(today),
      todayReview: this.review(today),
      settings: this.settings(),
      nowIso: new Date().toISOString(),
      todayIso: this.todayIso(),
      currentMinute: this.currentMinute(),
      workflow: this.workflowContext(key),
    }
  }

  currentMinute(): number {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: this.config.timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(this.now())
    return Number(parts.find((part) => part.type === 'hour')?.value ?? 0) * 60 + Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
  }

  /**
   * The next `days` days with whatever is already planned, fed to Agnes so its
   * suggestions slot around existing blocks instead of duplicating them.
   */
  upcomingContext(fromDate: string, days: number) {
    const start = parseIsoDate(fromDate)
    return Array.from({ length: days }, (_, offset) => {
      const date = isoDate(addDays(start, offset + 1))
      const plan = this.dayPlan(date)
      return {
        date,
        weekdayZh: weekdayZh(parseIsoDate(date)),
        blocks: plan.blocks
          .filter((block) => !block.done)
          .sort((left, right) => left.startPeriod - right.startPeriod)
          .map((block) => ({
            title: block.title,
            startPeriod: block.startPeriod,
            endPeriod: block.endPeriod,
          })),
      }
    })
  }

  /** Timing hint for the Today page's "up next" card. */
  upcoming(date: string): PlanBlockRecord | null {
    if (date !== this.todayIso()) return null
    const minute = this.currentMinute()
    return (
      this.dayPlan(date)
        .blocks.filter((block) => !block.done && block.endMinute > minute)
        .sort((left, right) => left.startMinute - right.startMinute)[0] ?? null
    )
  }

  exportAll(): Record<string, unknown> {
    const dump = (name: keyof Tables): Record<string, unknown> => {
      const out: Record<string, unknown> = {}
      for (const [key, value] of this.table(name).entries() as IterableIterator<[string, unknown]>) {
        out[key] = value
      }
      return out
    }
    return {
      exportedAt: new Date().toISOString(),
      version: 1,
      settings: this.settings(),
      courses: dump('courses'),
      plans: dump('plans'),
      backlog: dump('backlog'),
      exercises: dump('exercises'),
      gym_sessions: dump('gym_sessions'),
      reviews: dump('reviews'),
      reading: dump('reading'),
      learning: dump('learning'),
      workflow_runs: dump('workflow_runs'),
      personal_memory: dump('personal_memory'),
    }
  }

  async importAll(payload: Record<string, unknown>, mode: 'merge' | 'replace'): Promise<Record<string, number>> {
    const counts: Record<string, number> = {}
    const names: (keyof Tables)[] = [
      'courses',
      'plans',
      'backlog',
      'exercises',
      'gym_sessions',
      'reviews',
      'reading',
      'learning',
      'workflow_runs',
      'personal_memory',
    ]
    for (const name of names) {
      const table = this.table(name)
      if (mode === 'replace') {
        for (const key of [...(table.keys() as IterableIterator<string>)]) await table.delete(key)
      }
      const rows = (payload[name] ?? {}) as Record<string, unknown>
      let written = 0
      for (const [key, value] of Object.entries(rows)) {
        await table.put(key, value)
        written += 1
      }
      counts[name] = written
    }
    const settings = payload['settings']
    if (settings !== undefined && settings !== null) {
      const parsed = SettingsSchema.safeParse(settings)
      if (parsed.success) {
        await this.domain.global.set(parsed.data)
        this.settingsCache = parsed.data
      }
    }
    return counts
  }

  summaryLine(): string {
    const settings = this.settings()
    const dates = weekDates(isoWeekKey(parseIsoDate(this.todayIso())))
    const blocks = dates.flatMap((date) => this.dayPlan(date).blocks)
    const done = blocks.filter((block) => block.done).length
    return `今天 ${this.todayIso()} · 本周 ${String(done)}/${String(blocks.length)} 项完成 · 模型 ${settings.agnes.model}`
  }
}

export { freeGaps, coursesForDay, blockFromCourse, generatedBlockId, isoDate }
