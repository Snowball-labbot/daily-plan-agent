import type { Period } from './clock.ts'
import { stableHash } from './identity.ts'

/**
 * Default period grid, 17 periods from 07:00 to 22:30.
 *
 * Two deliberate choices:
 *
 *  - **Period 1 is a full hour (07:00-08:00) and is breakfast / slack.** Waking
 *    at 7:00 or a bit after still leaves a slot to put something in, instead of
 *    the day starting with a class you are already late for.
 *  - **From 18:35 the slots get shorter** (45 → 45 → 30 → 30 → 15). The evening
 *    is when self-directed work actually happens, and a 45-minute slot is too
 *    coarse to plan "one problem set" against. Periods 13-14 stay 45 minutes so
 *    a two-period evening class still runs 19:20-21:00.
 *
 * Periods 2-12 are the school's real class times, unchanged — they just shifted
 * up one index because of the new first period. See `courseShift` in the notes
 * in README if you re-import a timetable.
 *
 * Users edit this in Settings; it is only a starting point and is never written
 * to storage unless saved.
 */
export const DEFAULT_PERIODS: readonly Period[] = [
  { index: 1, startMinute: 7 * 60 + 0, endMinute: 8 * 60 + 0, label: '早餐 / 机动' },
  { index: 2, startMinute: 8 * 60 + 0, endMinute: 8 * 60 + 45, label: '' },
  { index: 3, startMinute: 8 * 60 + 55, endMinute: 9 * 60 + 40, label: '' },
  { index: 4, startMinute: 10 * 60 + 0, endMinute: 10 * 60 + 45, label: '' },
  { index: 5, startMinute: 10 * 60 + 55, endMinute: 11 * 60 + 40, label: '' },
  { index: 6, startMinute: 11 * 60 + 50, endMinute: 12 * 60 + 35, label: '' },
  { index: 7, startMinute: 12 * 60 + 45, endMinute: 13 * 60 + 30, label: '' },
  { index: 8, startMinute: 14 * 60 + 0, endMinute: 14 * 60 + 45, label: '' },
  { index: 9, startMinute: 14 * 60 + 55, endMinute: 15 * 60 + 40, label: '' },
  { index: 10, startMinute: 16 * 60 + 0, endMinute: 16 * 60 + 45, label: '' },
  { index: 11, startMinute: 16 * 60 + 55, endMinute: 17 * 60 + 40, label: '' },
  { index: 12, startMinute: 17 * 60 + 50, endMinute: 18 * 60 + 35, label: '' },
  { index: 13, startMinute: 19 * 60 + 20, endMinute: 20 * 60 + 5, label: '' },
  { index: 14, startMinute: 20 * 60 + 15, endMinute: 21 * 60 + 0, label: '' },
  { index: 15, startMinute: 21 * 60 + 5, endMinute: 21 * 60 + 35, label: '' },
  { index: 16, startMinute: 21 * 60 + 40, endMinute: 22 * 60 + 10, label: '' },
  { index: 17, startMinute: 22 * 60 + 15, endMinute: 22 * 60 + 30, label: '收尾' },
]

export type BodyPartKey = 'chest' | 'back' | 'legs' | 'shoulders' | 'core' | 'cardio'

/** Short labels for the calendar. The client has its own, but the host titles
 *  the gym block it creates, and the title is data, not presentation. */
export const BODY_PART_ZH: Record<BodyPartKey, string> = {
  chest: '胸',
  back: '背',
  legs: '腿',
  shoulders: '肩',
  core: '核心',
  cardio: '有氧',
}

export interface SeedExercise {
  readonly id: string
  readonly name: string
  readonly part: BodyPartKey
  readonly equipment: string
  readonly defaultSets: number
  readonly defaultReps: string
  readonly restSeconds: number
}

type Row = readonly [name: string, equipment: string, sets: number, reps: string, rest: number]

const CHEST: readonly Row[] = [
  ['杠铃卧推', '杠铃', 4, '8-12', 120],
  ['哑铃卧推', '哑铃', 4, '10-12', 100],
  ['上斜杠铃卧推', '杠铃', 3, '8-12', 120],
  ['上斜哑铃卧推', '哑铃', 3, '10-12', 100],
  ['双杠臂屈伸', '自重', 3, 'AMAP', 90],
  ['蝴蝶机夹胸', '器械', 3, '12-15', 75],
  ['绳索夹胸', '绳索', 3, '15', 60],
  ['俯卧撑', '自重', 3, 'AMAP', 60],
]

const BACK: readonly Row[] = [
  ['引体向上', '自重', 4, 'AMAP', 120],
  ['高位下拉', '器械', 4, '10-12', 90],
  ['杠铃划船', '杠铃', 4, '8-12', 110],
  ['哑铃单臂划船', '哑铃', 3, '10-12', 80],
  ['坐姿绳索划船', '绳索', 3, '12', 80],
  ['T杠划船', '杠铃', 3, '10-12', 100],
  ['直臂下压', '绳索', 3, '15', 60],
  ['硬拉', '杠铃', 3, '5-8', 180],
  ['面拉', '绳索', 3, '15', 60],
]

const LEGS: readonly Row[] = [
  ['杠铃深蹲', '杠铃', 4, '6-10', 180],
  ['腿举', '器械', 4, '10-12', 120],
  ['保加利亚分腿蹲', '哑铃', 3, '10/侧', 100],
  ['罗马尼亚硬拉', '杠铃', 3, '8-12', 120],
  ['腿屈伸', '器械', 3, '12-15', 75],
  ['腿弯举', '器械', 3, '12-15', 75],
  ['臀桥', '杠铃', 3, '12', 90],
  ['站姿提踵', '器械', 4, '15', 60],
  ['坐姿提踵', '器械', 4, '15', 60],
]

const SHOULDERS: readonly Row[] = [
  ['杠铃推举', '杠铃', 4, '6-10', 120],
  ['哑铃推举', '哑铃', 4, '10-12', 100],
  ['侧平举', '哑铃', 4, '12-15', 60],
  ['前平举', '哑铃', 3, '12', 60],
  ['俯身飞鸟', '哑铃', 3, '12-15', 60],
  ['阿诺德推举', '哑铃', 3, '10-12', 90],
  ['耸肩', '哑铃', 3, '12-15', 60],
]

const CORE: readonly Row[] = [
  ['平板支撑', '自重', 3, '60秒', 60],
  ['卷腹', '自重', 3, '15-20', 45],
  ['悬垂举腿', '自重', 3, '10-12', 60],
  ['俄罗斯转体', '自重', 3, '20', 45],
  ['死虫式', '自重', 3, '12/侧', 45],
  ['健腹轮', '器械', 3, '10-12', 60],
]

const CARDIO: readonly Row[] = [
  ['跑步机慢跑', '器械', 1, '30分钟', 0],
  ['椭圆机', '器械', 1, '30分钟', 0],
  ['划船机', '器械', 1, '20分钟', 0],
  ['动感单车', '器械', 1, '30分钟', 0],
  ['跳绳', '自重', 5, '2分钟', 60],
]

/**
 * Built-in ids must be pure ASCII: `ctx.storageDomain` rejects any table key
 * that does not match /^[a-zA-Z0-9_-]+$/, so a Chinese id like `x_chest_杠铃卧推`
 * makes the whole write throw and the library lands empty with no data.
 *
 * Names stay Chinese (they are record *values*, never keys); the id is derived
 * from the name with the project's stable hash, which keeps it deterministic —
 * re-seeding never duplicates an entry.
 */
function exerciseId(part: BodyPartKey, name: string): string {
  return `x_${part}_${stableHash(name)}`
}

function toRows(part: BodyPartKey, rows: readonly Row[]): SeedExercise[] {
  return rows.map(([name, equipment, sets, reps, rest]) => ({
    id: exerciseId(part, name),
    name,
    part,
    equipment,
    defaultSets: sets,
    defaultReps: reps,
    restSeconds: rest,
  }))
}

/** 44 built-in exercises, loaded on demand from Settings or an empty Gym page. */
export const SEED_EXERCISES: readonly SeedExercise[] = [
  ...toRows('chest', CHEST),
  ...toRows('back', BACK),
  ...toRows('legs', LEGS),
  ...toRows('shoulders', SHOULDERS),
  ...toRows('core', CORE),
  ...toRows('cardio', CARDIO),
]

export const SEED_BACKLOG_EXAMPLE = '高数作业'
