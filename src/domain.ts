import { z } from 'zod'

/**
 * ⚠️  DO NOT BUMP THE DOMAIN VERSION TO MIGRATE DATA.
 *
 * `dailyPlanDomainSpec.layout` is 'per-record', and the storage backend's
 * documented behaviour for that layout is: "a version bump discards stale
 * records instead of migrating them". Raising `version` below would therefore
 * silently delete the user's entire history.
 *
 * Schema evolution happens inside each record instead:
 *   record.schemaVersion  →  bumped by us, never enforced by the store
 *   zod .default()        →  new fields are optional on read
 * and `service.ts` normalises records on the way in.
 */

export const Category = z.enum(['study', 'intern', 'activity', 'gym'])
export const LifeArea = z.enum(['work', 'health', 'relationships', 'life'])
export const BodyPart = z.enum(['chest', 'back', 'legs', 'shoulders', 'core', 'cardio'])
export const BlockSource = z.enum(['course', 'backlog', 'manual', 'carry', 'routine'])

export const PeriodSchema = z.object({
  index: z.number().int().min(1).max(24),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
  label: z.string().default(''),
})

export const CourseSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  name: z.string().min(1),
  kind: z.enum(['course', 'fixed']).default('course'),
  weekday: z.number().int().min(1).max(7),
  startPeriod: z.number().int().min(1).max(24),
  endPeriod: z.number().int().min(1).max(24),
  /** Teaching weeks the class runs in. Empty = every week. */
  weeks: z.array(z.number().int().min(1).max(60)).default([]),
  location: z.string().default(''),
  teacher: z.string().default(''),
  category: Category.default('study'),
  colorKey: z.string().default(''),
  note: z.string().default(''),
  archived: z.boolean().default(false),
})

export const PlanBlockSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  title: z.string().min(1),
  category: Category,
  weekday: z.number().int().min(1).max(7),
  startPeriod: z.number().int().min(1).max(24),
  endPeriod: z.number().int().min(1).max(24),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
  courseId: z.string().nullable().default(null),
  gymDate: z.string().nullable().default(null),
  backlogId: z.string().nullable().default(null),
  /** Timetable blocks are locked: not draggable, not overridable. */
  locked: z.boolean().default(false),
  source: BlockSource,
  /** Empty = derive the colour from `category`. Otherwise one of the 8 presets. */
  colorKey: z.string().default(''),
  done: z.boolean().default(false),
  doneAt: z.string().nullable().default(null),
  carriedFrom: z.string().nullable().default(null),
  note: z.string().default(''),
  /** Only adaptive blocks may be reallocated. A manual drag pins the block. */
  adaptive: z.boolean().optional(),
  /** A dated commitment reserves capacity and must never become an automatic carry-over. */
  appointment: z.boolean().optional(),
  timeBasis: z.enum(['explicit', 'estimated', 'manual']).optional(),
  timeAssumption: z.string().max(500).optional(),
  disposition: z.enum(['active', 'deferred']).optional(),
  learningRef: z.string().nullable().optional(),
  learningKind: z.enum(['reading', 'practice']).nullable().optional(),
  lifeArea: LifeArea.optional(),
  executionStatus: z.enum(['unknown', 'missed', 'completed', 'partial']).optional(),
  completionEvidence: z.string().optional(),
  completionProgress: z.number().int().min(0).max(100).optional(),
  executionNote: z.string().max(2000).optional(),
})

export const DayPlanSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  date: z.string(),
  weekKey: z.string(),
  focus: z.string().default(''),
  blocks: z.array(PlanBlockSchema).default([]),
  observations: z.array(z.object({
    id: z.string(), title: z.string().min(1).max(200), lifeArea: LifeArea,
    evidence: z.string().min(1).max(500), sourceId: z.string(),
  })).max(100).optional(),
  updatedAt: z.string(),
})

export const BacklogItemSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  title: z.string().min(1),
  note: z.string().max(1000).default(''),
  category: Category,
  /** One of the 8 preset keys, or empty to follow the category colour. */
  colorKey: z.string().default(''),
  estimatePeriods: z.number().int().min(1).max(24).default(2),
  priority: z.number().int().min(0).max(3).default(1),
  dueDate: z.string().nullable().default(null),
  weekKey: z.string().nullable().default(null),
  courseRef: z.string().nullable().default(null),
  done: z.boolean().default(false),
  state: z.enum(['queued', 'scheduled', 'completed', 'cancelled']).optional(),
  cancelledBy: z.enum(['user', 'goal_met']).optional(),
  notBefore: z.string().nullable().optional(),
  learningRef: z.string().nullable().optional(),
  learningKind: z.enum(['reading', 'practice']).nullable().optional(),
  gymDate: z.string().nullable().optional(),
  originDate: z.string().nullable().optional(),
  originBlockId: z.string().nullable().optional(),
  preferredPeriod: z.number().int().min(1).max(24).nullable().optional(),
  earliestPeriod: z.number().int().min(1).max(24).nullable().optional(),
  latestPeriod: z.number().int().min(1).max(24).nullable().optional(),
  lifeArea: LifeArea.optional(),
  createdAt: z.string(),
})

export { PICK_COLORS, isPickColor } from './palette.ts'
export type { PickColor } from './palette.ts'

export const ExerciseSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  name: z.string().min(1),
  part: BodyPart,
  equipment: z.string().default(''),
  defaultSets: z.number().int().min(1).max(20).default(4),
  defaultReps: z.string().default('8-12'),
  defaultWeight: z.string().default(''),
  restSeconds: z.number().int().min(0).max(600).default(90),
  note: z.string().default(''),
  custom: z.boolean().default(false),
  archived: z.boolean().default(false),
})

export const GymSetSchema = z.object({
  id: z.string().min(1),
  reps: z.number().int().min(1).max(500),
  weight: z.number().min(0).max(1000).nullable().default(null),
  unit: z.enum(['kg', 'lb', 'bodyweight']).default('kg'),
  rir: z.number().min(0).max(10).nullable().default(null),
  source: z.enum(['manual', 'review']).default('manual'),
  evidence: z.string().max(500).default(''),
})

export const GymItemSchema = z.object({
  id: z.string().min(1),
  exerciseId: z.string().min(1),
  /** Snapshot, so renaming or deleting a library entry never rewrites history. */
  name: z.string().min(1),
  part: BodyPart,
  sets: z.number().int().min(1).max(30),
  reps: z.string(),
  weight: z.string().default(''),
  doneSets: z.number().int().min(0).max(30).default(0),
  note: z.string().default(''),
  actualSets: z.array(GymSetSchema).max(30).optional(),
})

export const GymSessionSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  date: z.string(),
  focus: z.array(BodyPart).default([]),
  items: z.array(GymItemSchema).default([]),
  finishedAt: z.string().nullable().default(null),
  feeling: z.number().int().min(1).max(5).nullable().default(null),
  completionEvidence: z.string().optional(),
})

/**
 * One thing Agnes proposes to put on the calendar. `carry` = unfinished today,
 * `new` = the user said they would do it soon. Both are placed by the same
 * idempotent rollforward, so re-confirming never duplicates a block.
 */
/**
 * Books being read outside class.
 *
 * `log` holds a cumulative snapshot per day ({date, value}), never a delta:
 * reading appends you skip some days, and "how much this week" has to survive
 * that. A snapshot makes week-over-week progress an arithmetic difference that
 * cannot drift, where a running list of deltas can double-count or lose entries.
 */
export const ReadingSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  title: z.string().min(1),
  author: z.string().default(''),
  /** What one unit means. `total` is read against this unit. */
  unit: z.enum(['page', 'chapter', 'percent']).default('page'),
  /** 0 = unknown length, so the bar shows effort instead of completion. */
  total: z.number().int().min(0).max(100_000).default(0),
  progress: z.number().int().min(0).max(100_000).default(0),
  /** Units per week. 0 = no target, which keeps the page free of guilt. */
  weeklyGoal: z.number().int().min(0).max(10_000).default(0),
  targetDate: z.string().nullable().default(null),
  status: z.enum(['reading', 'paused', 'done']).default('reading'),
  colorKey: z.string().default(''),
  note: z.string().default(''),
  log: z.array(z.object({ date: z.string(), value: z.number().int() })).default([]),
  archived: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/**
 * Anything learned outside class that accumulates by count: problems solved,
 * lectures watched, chapters worked through, days practised.
 *
 * Same snapshot-per-day convention as ReadingSchema — see the note there.
 */
export const LearningItemSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  title: z.string().min(1),
  kind: z.enum(['problem', 'course', 'skill', 'other']).default('problem'),
  /** Counted noun shown after the number: 题 / 课时 / 章 / 天. */
  unit: z.string().default('题'),
  /** 0 = open-ended, no finish line. */
  target: z.number().int().min(0).max(100_000).default(0),
  done: z.number().int().min(0).max(100_000).default(0),
  weeklyGoal: z.number().int().min(0).max(10_000).default(0),
  status: z.enum(['active', 'paused', 'done']).default('active'),
  colorKey: z.string().default(''),
  note: z.string().default(''),
  log: z.array(z.object({ date: z.string(), value: z.number().int() })).default([]),
  archived: z.boolean().default(false),
  createdAt: z.string(),
  updatedAt: z.string(),
})

/**
 * Something that happens at the same time every week and should not have to be
 * re-decided: breakfast, lunch, dinner, commute, laundry, a standing team call.
 *
 * `generate-week` places these alongside the timetable skeleton, so a generated
 * week is actually liveable rather than a wall of classes. Afterwards they are
 * ordinary movable blocks — this only decides where they start out.
 */
export const RoutineSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  id: z.string().min(1),
  title: z.string().min(1),
  category: Category.default('activity'),
  /** 1 = Monday … 7 = Sunday. Empty means every day. */
  weekdays: z.array(z.number().int().min(1).max(7)).default([]),
  startPeriod: z.number().int().min(1).max(24),
  endPeriod: z.number().int().min(1).max(24),
  colorKey: z.string().default(''),
  enabled: z.boolean().default(true),
})

export const SuggestionKind = z.enum(['carry', 'new'])

export const CarryOverSchema = z.object({
  kind: SuggestionKind.default('carry'),
  blockId: z.string().nullable().default(null),
  title: z.string(),
  category: Category,
  suggestDate: z.string(),
  periods: z.number().int().min(1).max(24).default(2),
  reason: z.string().default(''),
})

/**
 * A progress update read out of the review — "read about 100 pages today",
 * "did five more problems". Applied to the Learn page when the review is
 * confirmed, so saying it in prose is enough.
 */
export const LearningUpdateSchema = z.object({
  /** Learn-item id when Agnes was given the list and matched one; else null. */
  ref: z.string().nullable().default(null),
  title: z.string(),
  kind: z.enum(['reading', 'practice']).default('reading'),
  /**
   * `total` = "I'm on page 120 now"; `delta` = "I read 100 pages today".
   * Both are common in Chinese ("读到120页" vs "读了100页") and are not
   * interchangeable, so the model must say which it meant.
   */
  mode: z.enum(['total', 'delta']).default('delta'),
  value: z.number().int().min(0).max(100_000).default(0),
})

export const StructuredReviewSchema = z.object({
  summary: z.string(),
  achievements: z.array(z.string()).max(8).default([]),
  blockers: z.array(z.string()).max(8).default([]),
  adjustments: z.array(z.string()).max(8).default([]),
  /** What to put on the calendar: carry-overs plus things the user said they'd do. */
  plan: z.array(CarryOverSchema).max(12).default([]),
  /** Reading / practice progress mentioned in the text, applied on confirm. */
  learning: z.array(LearningUpdateSchema).max(8).default([]),
  energy: z.number().int().min(1).max(5).nullable().default(null),
  mood: z.number().int().min(1).max(5).nullable().default(null),
  tags: z.array(z.string()).max(8).default([]),
  memories: z.array(z.object({ text: z.string().min(1).max(300), evidence: z.string().min(1).max(300) })).max(6).optional(),
})

export const DaySnapshotSchema = z.object({
  planned: z.number().int().min(0).default(0),
  done: z.number().int().min(0).default(0),
  ratio: z.number().min(0).max(1).default(0),
  gymDone: z.boolean().default(false),
})

export const ReviewSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  date: z.string(),
  /** The user writes one free-form block of prose; the prompts are only hints. */
  raw: z.object({
    text: z.string().default(''),
    usedPrompts: z.array(z.enum(['did', 'missed', 'adjust'])).default([]),
  }),
  structured: StructuredReviewSchema.nullable().default(null),
  daySnapshot: DaySnapshotSchema.nullable().default(null),
  status: z.enum(['draft', 'structuring', 'structured', 'failed']).default('draft'),
  planApplied: z.array(z.string()).default([]),
  applyWarnings: z.array(z.string()).max(24).optional(),
  error: z.object({ code: z.string(), message: z.string() }).nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
  sourceRunId: z.string().optional(),
  rangeStart: z.string().optional(), rangeEnd: z.string().optional(),
})

export const SettingsSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  agnes: z
    .object({
      provider: z.string().default('agnes'),
      model: z.string().default('agnes-2.5-flash'),
      agentPreset: z.string().default('standard'),
      timeoutMinutes: z.number().int().min(1).max(30).default(6),
    })
    .prefault({}),
  termStart: z.string().default(''),
  /** Teaching weeks in the term. Drives "generate the whole term" and week labels. */
  termWeeks: z.number().int().min(1).max(60).default(16),
  periods: z.array(PeriodSchema).default([]),
  dayEndPeriod: z.number().int().min(1).max(24).default(17),
  courseCalendar: z.object({
    respectHolidays: z.boolean().default(true),
    overrides: z.array(z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => { const date = new Date(`${value}T00:00:00Z`); return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value }, '无效日期'),
      weekday: z.number().int().min(1).max(7).nullable(),
    })).max(366).default([]),
  }).prefault({}),
  /**
   * Standing weekly commitments. `generate-week` lays these down with the
   * timetable so the generated week is liveable, not just class blocks.
   */
  routines: z.array(RoutineSchema).default([]),
  /** Numerator of the completion ratio. On by default: attending class counts. */
  countCourseBlocks: z.boolean().default(true),
  streakThreshold: z.number().min(0.1).max(1).default(0.8),
  gymRotation: z.array(BodyPart).default(['chest', 'back', 'legs', 'shoulders']),
  gymRestDays: z.array(z.number().int().min(1).max(7)).default([]),
  reminder: z
    .object({
      enabled: z.boolean().default(true),
      reviewTime: z.string().default('21:30'),
      weeklyPlanTime: z.string().default('19:00'),
      weeklyPlanWeekday: z.number().int().min(1).max(7).default(7),
      autoStructure: z.boolean().default(false),
    })
    .prefault({}),
  record: z
    .object({
      defaultView: z.enum(['year', 'month']).default('year'),
    })
    .prefault({}),
  planning: z.object({
    bufferRatio: z.number().min(0.1).max(0.6).default(0.25),
    dailyFocusMinutes: z.number().int().min(30).max(600).default(180),
    maxDailyTasks: z.number().int().min(1).max(8).default(3),
    autoReplanAfterReview: z.boolean().default(true),
    autoPrepareToday: z.boolean().default(true),
    preferredStudyPeriod: z.number().int().min(1).max(24).default(2),
    preferredGymPeriod: z.number().int().min(1).max(24).default(12),
    gymWeeklyGoal: z.number().int().min(0).max(7).default(0),
  }).prefault({}),
  personalContext: z.string().max(12_000).default(''),
  fitness: z.object({
    goal: z.enum(['unspecified', 'hypertrophy', 'strength', 'health']).default('unspecified'),
    experience: z.enum(['unspecified', 'beginner', 'intermediate', 'advanced']).default('unspecified'),
    constraints: z.string().max(3000).default(''),
  }).prefault({}),
})

export const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}, '无效日期')

export const WorkflowDraftSchema = z.object({
  summary: z.string().min(1).max(2000),
  focus: z.array(z.string().min(1).max(200)).max(3).default([]),
  rescheduleBlockIds: z.array(z.string().min(1)).max(20).default([]),
  tasks: z.array(z.object({
    title: z.string().min(1).max(200), category: Category, lifeArea: LifeArea.optional(),
    periods: z.number().int().min(1).max(6).default(2),
    priority: z.number().int().min(0).max(3).default(1),
    dueDate: DateSchema.nullable().default(null),
    notBefore: DateSchema.nullable().default(null),
    learningRef: z.string().nullable().default(null),
    learningKind: z.enum(['reading', 'practice']).nullable().default(null),
    preferredPeriod: z.number().int().min(1).max(24).nullable().default(null),
    earliestPeriod: z.number().int().min(1).max(24).nullable().default(null),
    latestPeriod: z.number().int().min(1).max(24).nullable().default(null),
    note: z.string().max(1000).default(''),
  })).max(20).default([]),
  unavailable: z.array(z.object({
    date: DateSchema, startPeriod: z.number().int().min(1).max(24),
    endPeriod: z.number().int().min(1).max(24), reason: z.string().max(200),
  }).refine((item) => item.endPeriod >= item.startPeriod)).max(14).default([]),
  /** Future commitments are calendar intentions, never actual execution logs. */
  appointments: z.array(z.object({
    date: DateSchema, title: z.string().min(1).max(200), category: Category,
    lifeArea: LifeArea.optional(),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    note: z.string().max(1000).default(''),
    evidence: z.string().min(1).max(500),
    needsTimeConfirmation: z.boolean().optional(),
    /** Assigned by the service after applying, not trusted from model output. */
    blockId: z.string().optional(),
    timeBasis: z.enum(['explicit', 'estimated', 'manual']).optional(),
    timeAssumption: z.string().max(500).optional(),
    sourceRunId: z.string().optional(),
    learningRef: z.string().nullable().default(null),
    learningKind: z.enum(['reading', 'practice']).nullable().default(null),
  }).refine((item) => item.endMinute > item.startMinute)).max(30).default([]),
  memories: z.array(z.object({
    text: z.string().min(1).max(300), evidence: z.string().min(1).max(300),
  })).max(6).default([]),
  energy: z.number().int().min(1).max(5).nullable().default(null),
  planningPatch: z.object({
    preferredStudyPeriod: z.number().int().min(1).max(24).optional(),
    preferredGymPeriod: z.number().int().min(1).max(24).optional(),
    dailyFocusMinutes: z.number().int().min(30).max(600).optional(),
    bufferRatio: z.number().min(0.1).max(0.6).optional(),
    maxDailyTasks: z.number().int().min(1).max(8).optional(),
    gymWeeklyGoal: z.number().int().min(0).max(7).optional(),
  }).prefault({}),
  planningEvidence: z.string().max(300).default(''),
  taskActions: z.array(z.object({
    taskId: z.string().min(1), action: z.enum(['update', 'complete', 'cancel']),
    evidence: z.string().min(1).max(500), date: DateSchema.nullable().default(null),
    patch: z.object({
      title: z.string().min(1).max(200).optional(), priority: z.number().int().min(0).max(3).optional(),
      dueDate: DateSchema.nullable().optional(), notBefore: DateSchema.nullable().optional(),
      estimatePeriods: z.number().int().min(1).max(6).optional(), lifeArea: LifeArea.optional(),
    }).prefault({}),
  })).max(30).default([]),
  executions: z.array(z.object({
    date: DateSchema, blockId: z.string().min(1), status: z.enum(['completed', 'missed']),
    evidence: z.string().min(1).max(500),
    lifeArea: LifeArea.optional(),
  })).max(50).default([]),
  learningLogs: z.array(LearningUpdateSchema.extend({
    date: DateSchema, evidence: z.string().min(1).max(500),
  })).max(30).default([]),
  gymLogs: z.array(z.object({
    date: DateSchema, finished: z.boolean().default(false), evidence: z.string().min(1).max(500),
    exercises: z.array(z.object({
      exerciseId: z.string().nullable().default(null), name: z.string().min(1).max(100), part: BodyPart,
      evidence: z.string().min(1).max(500),
      sets: z.array(GymSetSchema.omit({ id: true, source: true, evidence: true })).max(30).default([]),
    })).max(20).default([]),
  })).max(14).default([]),
  questions: z.array(z.string().min(1).max(300)).max(6).default([]),
  activityLogs: z.array(z.object({
    date: DateSchema, title: z.string().min(1).max(200), lifeArea: LifeArea,
    evidence: z.string().min(1).max(500),
  })).max(30).default([]),
  gymAdvice: z.array(z.string().min(1).max(1000)).max(6).default([]),
  fitnessPatch: z.object({
    goal: z.enum(['hypertrophy', 'strength', 'health']).optional(),
    experience: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
    constraints: z.string().max(3000).optional(),
  }).prefault({}),
  fitnessEvidence: z.string().max(500).default(''),
})

export const WorkflowRunSchema = z.object({
  id: z.string(), date: DateSchema, weekKey: z.string(),
  mode: z.enum(['plan', 'replan', 'weekly', 'review']),
  rawText: z.string().max(30_000),
  status: z.enum(['draft', 'running', 'ready', 'failed', 'applied']).default('draft'),
  phase: z.enum(['generating', 'applying', 'ready', 'applied', 'failed', 'cancelled']).optional(),
  draft: WorkflowDraftSchema.nullable().default(null),
  error: z.string().nullable().default(null),
  createdAt: z.string(), updatedAt: z.string(),
  rangeStart: DateSchema.optional(), rangeEnd: DateSchema.optional(),
  planStart: DateSchema.optional(), planEnd: DateSchema.optional(),
  replaceConflicts: z.boolean().optional(),
  appliedChanges: z.array(z.string()).optional(),
  applyWarnings: z.array(z.string()).optional(),
  factsApplied: z.boolean().optional(),
  intentApplied: z.boolean().optional(),
})

export const WorkflowDraftEditsSchema = z.object({
  tasks: z.array(z.object({
    index: z.number().int().min(0).max(19), title: z.string().trim().min(1).max(200),
    dueDate: DateSchema.nullable(), date: DateSchema,
    startMinute: z.number().int().min(0).max(1439).nullable(), endMinute: z.number().int().min(1).max(1440).nullable(),
    note: z.string().max(1000).default(''),
  })).max(20).default([]),
  appointments: z.array(z.object({
    index: z.number().int().min(0).max(29), title: z.string().trim().min(1).max(200), date: DateSchema,
    startMinute: z.number().int().min(0).max(1439).nullable(), endMinute: z.number().int().min(1).max(1440).nullable(),
    note: z.string().max(1000).default(''),
  })).max(30).default([]),
})
export type WorkflowDraftEdits = z.infer<typeof WorkflowDraftEditsSchema>

export const PersonalMemorySchema = z.object({
  id: z.string(), text: z.string(), evidence: z.string(), sourceId: z.string(),
  date: DateSchema, active: z.boolean().default(true),
})

export const dailyPlanDomainSpec = {
  name: 'dsh_daily_plan',
  version: 1 as const,
  layout: 'per-record' as const,
  invalidRecords: 'backup-and-skip' as const,
  global: { schema: SettingsSchema },
  tables: {
    courses: { valueSchema: CourseSchema },
    plans: { valueSchema: DayPlanSchema },
    backlog: { valueSchema: BacklogItemSchema },
    exercises: { valueSchema: ExerciseSchema },
    gym_sessions: { valueSchema: GymSessionSchema },
    reviews: { valueSchema: ReviewSchema },
    reading: { valueSchema: ReadingSchema },
    learning: { valueSchema: LearningItemSchema },
    workflow_runs: { valueSchema: WorkflowRunSchema },
    personal_memory: { valueSchema: PersonalMemorySchema },
  },
} as const

export type CategoryValue = z.infer<typeof Category>
export type LifeAreaValue = z.infer<typeof LifeArea>
export type GymSetRecord = z.infer<typeof GymSetSchema>
export type BodyPartValue = z.infer<typeof BodyPart>
export type BlockSourceValue = z.infer<typeof BlockSource>
export type PeriodRecord = z.infer<typeof PeriodSchema>
export type CourseRecord = z.infer<typeof CourseSchema>
export type PlanBlockRecord = z.infer<typeof PlanBlockSchema>
export type DayPlanRecord = z.infer<typeof DayPlanSchema>
export type BacklogItemRecord = z.infer<typeof BacklogItemSchema>
export type ExerciseRecord = z.infer<typeof ExerciseSchema>
export type GymItemRecord = z.infer<typeof GymItemSchema>
export type GymSessionRecord = z.infer<typeof GymSessionSchema>
export type CarryOverRecord = z.infer<typeof CarryOverSchema>
export type LearningUpdateRecord = z.infer<typeof LearningUpdateSchema>
export type StructuredReviewRecord = z.infer<typeof StructuredReviewSchema>
export type DaySnapshotRecord = z.infer<typeof DaySnapshotSchema>
export type ReviewRecord = z.infer<typeof ReviewSchema>
export type SettingsRecord = z.infer<typeof SettingsSchema>
export type RoutineRecord = z.infer<typeof RoutineSchema>
export type ReadingRecord = z.infer<typeof ReadingSchema>
export type LearningItemRecord = z.infer<typeof LearningItemSchema>
export type WorkflowDraft = z.infer<typeof WorkflowDraftSchema>
export type WorkflowRunRecord = z.infer<typeof WorkflowRunSchema>
export type PersonalMemoryRecord = z.infer<typeof PersonalMemorySchema>
