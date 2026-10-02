/**
 * Wire shapes mirrored from the host. `import type` only — esbuild erases these,
 * so nothing from the host half (zod included) reaches the browser bundle.
 */
import type {
  BacklogItemRecord,
  BodyPartValue,
  CategoryValue,
  CourseRecord,
  DayPlanRecord,
  ExerciseRecord,
  GymSessionRecord,
  LearningItemRecord,
  PlanBlockRecord,
  ReadingRecord,
  ReviewRecord,
  SettingsRecord,
  StructuredReviewRecord,
} from '../domain.ts'
import type { DayStat, StatsSummary } from '../stats.ts'

export type {
  BacklogItemRecord,
  BodyPartValue,
  CategoryValue,
  CourseRecord,
  DayPlanRecord,
  DayStat,
  ExerciseRecord,
  GymSessionRecord,
  LearningItemRecord,
  PlanBlockRecord,
  ReadingRecord,
  ReviewRecord,
  SettingsRecord,
  StatsSummary,
  StructuredReviewRecord,
}

export interface PlanSnapshot {
  readonly today: DayPlanRecord
  readonly week: DayPlanRecord[]
  readonly weekKey: string
  readonly courses: CourseRecord[]
  readonly backlog: BacklogItemRecord[]
  readonly gymSession: GymSessionRecord
  readonly gymWeek: readonly GymDaySummary[]
  readonly exercises: ExerciseRecord[]
  readonly gymFocus: GymFocusSuggestion
  readonly todayReview: ReviewRecord | null
  readonly settings: SettingsRecord
  readonly nowIso: string
  readonly todayIso: string
  readonly currentMinute: number
  readonly workflow: import('../service.ts').PlanSnapshot['workflow']
}

export interface StatsDayPayload {
  readonly date: string
  readonly plan: DayPlanRecord
  readonly session: GymSessionRecord | null
  readonly sessionProgress: { readonly logged: number; readonly total: number }
  readonly review: ReviewRecord | null
  readonly stat: DayStat
}

export interface GymFocusSuggestion {
  readonly focus: BodyPartValue[]
  readonly reason: string
}

export interface CourseParsePayload {
  readonly rows: {
    readonly name: string
    readonly weekday: number
    readonly startPeriod: number
    readonly endPeriod: number
    readonly weeks: number[]
    readonly location: string
    readonly kind: 'course' | 'fixed'
  }[]
  readonly failed: { readonly line: string; readonly reason: string }[]
}

export interface AgnesCheckPayload {
  readonly provider: string
  readonly model: string
  readonly agentPreset: string
  readonly timeoutMinutes: number
  readonly rosterDiscoverable: boolean
  readonly note: string
}

/** Per-week movement numbers for the Learn page — see src/learn.ts for the maths. */
export interface WeekGains {
  readonly reading: { readonly id: string; readonly title: string; readonly gain: number }[]
  readonly learning: { readonly id: string; readonly title: string; readonly gain: number }[]
  readonly daily: { readonly date: string; readonly reading: number; readonly learning: number }[]
  readonly readingPages: number
  readonly learningUnits: number
}

/** A routine draft from Agnes, before the user has reviewed it. */
export interface RoutineDraft {
  readonly title: string
  readonly category: CategoryValue
  readonly weekdays: number[]
  readonly startPeriod: number
  readonly endPeriod: number
}

export interface RoutineDraftPayload {
  readonly ok: boolean
  readonly routines: RoutineDraft[]
  readonly error: { readonly code: string; readonly message: string } | null
}

/** Per-day training summary for the browsed week — see PlanSnapshot.gymWeek. */
export interface GymDaySummary {
  readonly date: string
  readonly actions: number
  readonly sets: number
  readonly parts: readonly string[]
  readonly planned: boolean
}
