import { useSyncExternalStore } from 'react'
import type { ClientRpc } from './contracts.ts'
import { unwrap } from './protocol.ts'
import type {
  CourseParsePayload,
  ExerciseRecord,
  GymFocusSuggestion,
  GymSessionRecord,
  LearningItemRecord,
  PlanSnapshot,
  ReadingRecord,
  ReviewRecord,
  RoutineDraftPayload,
  WeekGains,
} from './wire.ts'

export const CHANNEL = '/dsh-daily-plan'

export type PageKey = 'today' | 'week' | 'gym' | 'learn' | 'review' | 'record' | 'setting'

export const PAGE_ORDER: readonly PageKey[] = ['today', 'week', 'gym', 'learn', 'review', 'record', 'setting']

/**
 * The element that opened the overlay, so we can hand focus back on close.
 * Kept outside React because the trigger lives in a different slot tree.
 */
export const focusMemory: { current: HTMLElement | null } = { current: null }

export interface PlanState {
  readonly phase: 'idle' | 'loading' | 'ready' | 'error'
  readonly open: boolean
  readonly page: PageKey
  readonly snapshot: PlanSnapshot | null
  /** ISO week the Week page is browsing; null means "whatever the host says". */
  readonly weekKey: string | null
  /** Day the Record page is inspecting. */
  readonly inspectDate: string | null
  readonly recordView: 'daily' | 'training'
  /**
   * Day the Review page is showing. null = today.
   *
   * A review is a record, so it has to be readable after the fact — the page
   * used to be nailed to today, which made "what did I write last Tuesday"
   * unanswerable.
   */
  readonly reviewDate: string | null
  /**
   * Day the Gym page is editing. null = today.
   *
   * Training is planned ahead of the week, not only on the day, so the page has
   * to be able to look at (and edit) any date.
   */
  readonly gymDate: string | null
  readonly error: string | null
  readonly busy: string | null
  readonly toast: string | null
}

export type StateSource = {
  getSnapshot(): PlanState
  subscribe(listener: () => void): () => void
}

export interface PlanRuntime extends StateSource {
  readonly rpc: ClientRpc
  open(): void
  close(): void
  setPage(page: PageKey): void
  setWeek(weekKey: string): Promise<void>
  setInspectDate(date: string | null): void
  setRecordView(view: 'daily' | 'training'): void
  setGymDate(date: string | null): void
  setReviewDate(date: string | null): void
  reviewGet(date: string): Promise<ReviewRecord | null>
  refresh(): Promise<void>
  toggleBlock(date: string, blockId: string, done: boolean): Promise<void>
  upsertBlock(date: string, input: Record<string, unknown>): Promise<void>
  removeBlock(date: string, blockId: string): Promise<void>
  moveBlock(
    date: string,
    blockId: string,
    toDate: string,
    startPeriod: number,
    endPeriod: number,
  ): Promise<void>
  generateWeek(weekKey: string): Promise<void>
  generateTerm(): Promise<void>
  draftRoutines(description: string): Promise<RoutineDraftPayload>
  clearWeek(weekKey: string): Promise<void>
  saveBacklog(input: Record<string, unknown>): Promise<void>
  removeBacklog(id: string): Promise<void>
  parseCourses(text: string): Promise<CourseParsePayload>
  importCourses(rows: unknown[], replace: boolean): Promise<void>
  upsertCourse(input: Record<string, unknown>): Promise<void>
  removeCourse(id: string): Promise<void>
  gymSession(date: string): Promise<GymSessionRecord>
  gymExercises(): Promise<ExerciseRecord[]>
  seedExercises(): Promise<void>
  upsertExercise(input: Record<string, unknown>): Promise<void>
  removeExercise(id: string): Promise<void>
  addGymItem(date: string, exerciseId: string, atIndex?: number): Promise<void>
  updateGymItem(date: string, itemId: string, patch: Record<string, unknown>): Promise<void>
  removeGymItem(date: string, itemId: string): Promise<void>
  reorderGymItems(date: string, orderedIds: string[]): Promise<void>
  setGymFocus(date: string, focus: string[], rotate?: boolean): Promise<void>
  applyLastGym(date: string, part: string | null): Promise<void>
  finishGym(date: string, feeling: number | null): Promise<void>
  /** Adds a pool item; the user drags it onto the week themselves. */
  queueGymSession(date: string): Promise<void>
  suggestGymFocus(date: string): Promise<GymFocusSuggestion>
  readingList(): Promise<ReadingRecord[]>
  upsertReading(input: Record<string, unknown>): Promise<ReadingRecord>
  removeReading(id: string): Promise<void>
  setReadingProgress(id: string, value: number, date?: string): Promise<ReadingRecord>
  learningList(): Promise<LearningItemRecord[]>
  upsertLearning(input: Record<string, unknown>): Promise<LearningItemRecord>
  removeLearning(id: string): Promise<void>
  setLearningCount(id: string, value: number, date?: string): Promise<LearningItemRecord>
  bumpLearning(id: string, delta: number, date?: string): Promise<LearningItemRecord>
  learnWeekStats(from: string, to: string): Promise<WeekGains>
  saveDraft(date: string, raw: { text: string; usedPrompts: string[] }): Promise<unknown>
  structureReview(date: string, force?: boolean): Promise<unknown>
  commitReview(date: string, structured: unknown, carryOver: unknown[]): Promise<unknown>
  statsRange(from: string, to: string): Promise<unknown>
  statsSummary(from: string, to: string): Promise<unknown>
  statsDay(date: string): Promise<unknown>
  updateSettings(patch: Record<string, unknown>): Promise<void>
  agnesProbe(): Promise<{ ok: boolean; message: string; ms: number }>
  exportAll(): Promise<Record<string, unknown>>
  importAll(payload: Record<string, unknown>, mode: 'merge' | 'replace'): Promise<void>
  call<T>(endpoint: string, payload?: unknown): Promise<T>
  notify(message: string): void
  dispose(): void
}

const INITIAL: PlanState = {
  phase: 'idle',
  open: false,
  page: 'today',
  snapshot: null,
  weekKey: null,
  inspectDate: null,
  recordView: 'daily',
  gymDate: null,
  reviewDate: null,
  error: null,
  busy: null,
  toast: null,
}

export function createRuntime(rpc: ClientRpc): PlanRuntime {
  let state: PlanState = INITIAL
  const listeners = new Set<() => void>()
  let pending: Promise<void> | undefined
  let toastTimer: ReturnType<typeof setTimeout> | undefined

  // `state` is always replaced, never mutated, so getSnapshot stays referentially
  // stable between real changes — that is what keeps useSyncExternalStore from
  // re-rendering forever.
  const publish = (next: Partial<PlanState>): void => {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
  }

  const call = async <T>(endpoint: string, payload: unknown = {}): Promise<T> => {
    const controller = new AbortController()
    const limit = /workflow.run|review.structure|routine.parse|agnes.probe/.test(endpoint) ? 400_000 : 30_000
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const response = await Promise.race([rpc.call(CHANNEL, endpoint, payload, controller.signal), new Promise<never>((_, reject) => {
        timer = setTimeout(() => { controller.abort(); reject(new Error('连接等待超时。原文与微调已保留，请恢复安排查看保存状态。')) }, limit)
      })])
      return unwrap<T>(response)
    } finally { if (timer) clearTimeout(timer) }
  }

  /** Wraps every mutation so failures surface instead of vanishing. */
  const run = async (label: string, task: () => Promise<void>): Promise<void> => {
    publish({ busy: label })
    try {
      await task()
      publish({ error: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      publish({ error: message })
      runtime.notify(message)
    } finally {
      publish({ busy: null })
    }
  }

  const loadSnapshot = async (): Promise<void> => {
    const snapshot = await call<PlanSnapshot>(
      'snapshot',
      state.weekKey === null ? {} : { weekKey: state.weekKey },
    )
    publish({ phase: 'ready', snapshot, error: null })
  }

  const refresh = async (): Promise<void> => {
    if (pending !== undefined) return pending
    publish({ phase: state.snapshot === null ? 'loading' : state.phase })
    pending = (async () => {
      try {
        await loadSnapshot()
      } catch (error) {
        publish({
          phase: 'error',
          error: error instanceof Error ? error.message : String(error),
        })
      } finally {
        pending = undefined
      }
    })()
    return pending
  }

  /** Mutation + reload, the shape almost every action needs. */
  const mutate = (label: string, endpoint: string, payload: unknown): (() => Promise<void>) => () =>
    run(label, async () => {
      await call(endpoint, payload)
      await loadSnapshot()
    })

  const runtime: PlanRuntime = {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    rpc,
    open() {
      publish({ open: true })
      void refresh()
    },
    close() {
      publish({ open: false })
    },
    setPage(page) {
      publish({ page })
    },
    async setWeek(weekKey) {
      publish({ weekKey })
      // Straight to the wire: the shared `refresh` de-dupes in-flight loads and
      // would hand back the previous week's promise.
      try {
        await loadSnapshot()
      } catch (error) {
        publish({ error: error instanceof Error ? error.message : String(error) })
      }
    },
    setRecordView(view) { publish({ recordView: view }) },
    setInspectDate(date) {
      publish({ inspectDate: date })
    },
    setGymDate(date) {
      publish({ gymDate: date })
    },
    setReviewDate(date) {
      publish({ reviewDate: date })
    },
    reviewGet: (date) => call<ReviewRecord | null>('review.get', { date }),
    refresh,
    toggleBlock: (date, blockId, done) => mutate('切换', 'plan.block.toggle', { date, blockId, done })(),
    upsertBlock: (date, input) => mutate('保存', 'plan.block.upsert', { date, block: input })(),
    removeBlock: (date, blockId) => mutate('删除', 'plan.block.remove', { date, blockId })(),
    moveBlock: (date, blockId, toDate, startPeriod, endPeriod) =>
      mutate('移动', 'plan.block.move', { date, blockId, toDate, startPeriod, endPeriod })(),
    generateWeek: (weekKey) => mutate('生成', 'plan.generate-week', { weekKey })(),
    generateTerm: () => mutate('生成本学期', 'plan.generate-term', {})(),
    draftRoutines: (description) => call<RoutineDraftPayload>('routines.draft', { description }),
    clearWeek: (weekKey) => mutate('清空', 'plan.clear-week', { weekKey })(),
    saveBacklog: (input) => mutate('保存待办', 'backlog.upsert', { item: input })(),
    removeBacklog: (id) => mutate('删除待办', 'backlog.remove', { id })(),
    parseCourses: (text) => call<CourseParsePayload>('courses.parse-paste', { text }),
    importCourses: (rows, replace) => mutate('导入课表', 'courses.import', { rows, replace })(),
    upsertCourse: (input) => mutate('保存课程', 'courses.upsert', { course: input })(),
    removeCourse: (id) => mutate('删除课程', 'courses.remove', { id })(),
    gymSession: (date) => call<GymSessionRecord>('gym.session', { date }),
    gymExercises: () => call<ExerciseRecord[]>('gym.exercises'),
    seedExercises: () => mutate('载入动作库', 'gym.exercise.reset-seed', {})(),
    upsertExercise: (input) => mutate('保存动作', 'gym.exercise.upsert', { exercise: input })(),
    removeExercise: (id) => mutate('删除动作', 'gym.exercise.remove', { id })(),
    addGymItem: (date, exerciseId, atIndex) =>
      mutate('加入动作', 'gym.item.add', { date, exerciseId, ...(atIndex === undefined ? {} : { atIndex }) })(),
    updateGymItem: (date, itemId, patch) => mutate('更新动作', 'gym.item.update', { date, itemId, patch })(),
    removeGymItem: (date, itemId) => mutate('删除动作', 'gym.item.remove', { date, itemId })(),
    reorderGymItems: (date, orderedIds) => mutate('排序', 'gym.item.reorder', { date, orderedIds })(),
    setGymFocus: (date, focus, rotate = false) => mutate('设置部位', 'gym.focus.set', { date, focus, rotate })(),
    applyLastGym: (date, part) => mutate('套用上次', 'gym.apply-last', { date, part })(),
    finishGym: (date, feeling) => mutate('完成训练', 'gym.session.finish', { date, feeling })(),
    queueGymSession: (date) => mutate('加入待安排', 'gym.session.plan', { date })(),
    suggestGymFocus: (date) => call<GymFocusSuggestion>('gym.focus.suggest', { date }),
    readingList: () => call<ReadingRecord[]>('reading.list'),
    upsertReading: (input) => call<ReadingRecord>('reading.upsert', { item: input }),
    removeReading: (id) => mutate('删书', 'reading.remove', { id })(),
    setReadingProgress: (id, value, date) =>
      call<ReadingRecord>('reading.progress', { id, value, ...(date === undefined ? {} : { date }) }),
    learningList: () => call<LearningItemRecord[]>('learning.list'),
    upsertLearning: (input) => call<LearningItemRecord>('learning.upsert', { item: input }),
    removeLearning: (id) => mutate('删记录', 'learning.remove', { id })(),
    setLearningCount: (id, value, date) =>
      call<LearningItemRecord>('learning.count', { id, value, ...(date === undefined ? {} : { date }) }),
    bumpLearning: (id, delta, date) =>
      call<LearningItemRecord>('learning.bump', { id, delta, ...(date === undefined ? {} : { date }) }),
    learnWeekStats: (from, to) => call<WeekGains>('learn.week-stats', { from, to }),
    saveDraft: (date, raw) => call('review.draft.save', { date, raw }),
    structureReview: (date, force = false) => call('review.structure', { date, force }),
    commitReview: (date, structured, carryOver) => call('review.commit', { date, structured, carryOver }),
    statsRange: (from, to) => call('stats.range', { from, to }),
    statsSummary: (from, to) => call('stats.summary', { from, to }),
    statsDay: (date) => call('stats.day', { date }),
    updateSettings: (patch) => mutate('保存设置', 'settings.update', { patch })(),
    agnesProbe: () => call<{ ok: boolean; message: string; ms: number }>('settings.agnes.probe'),
    exportAll: () => call<Record<string, unknown>>('export.json'),
    importAll: (payload, mode) => mutate('导入数据', 'import.json', { payload, mode })(),
    call,
    notify(message) {
      if (toastTimer !== undefined) clearTimeout(toastTimer)
      publish({ toast: message })
      toastTimer = setTimeout(() => {
        publish({ toast: null })
      }, 2600)
    },
    dispose() {
      if (toastTimer !== undefined) clearTimeout(toastTimer)
      listeners.clear()
    },
  }
  return runtime
}

/** Whole-state subscription. Cheaper to reason about than per-field selectors. */
export function usePlanState(runtime: PlanRuntime): PlanState {
  return useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getSnapshot)
}
