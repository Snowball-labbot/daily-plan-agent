import { z } from 'zod'
import { Category, StructuredReviewSchema, type StructuredReviewRecord } from './domain.ts'
import { END, START } from './prompt.ts'

/** Grab the marked block, or fall back to the widest {...} span in the text. */
export function extractJsonBlock(text: string): string {
  const startIndex = text.indexOf(START)
  const endIndex = text.indexOf(END)
  if (startIndex >= 0 && endIndex > startIndex) {
    return text.slice(startIndex + START.length, endIndex).trim()
  }
  const firstBrace = text.indexOf('{')
  const lastBrace = text.lastIndexOf('}')
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1).trim()
  }
  throw new Error('回复里没有找到 JSON')
}

/**
 * The JSON payload of a reply.
 *
 * Fences can sit around the whole reply *or* inside the markers (models do
 * both, and not consistently), so peel once outside and once inside.
 */
export function jsonPayload(text: string): string {
  return stripFences(extractJsonBlock(stripFences(text)))
}

export function stripFences(text: string): string {
  return text
    .replace(/^\s*```[a-zA-Z]*\s*/u, '')
    .replace(/\s*```\s*$/u, '')
    .trim()
}

/**
 * Models occasionally emit `"text with "inner" quotes"`. Walking the string and
 * escaping quotes that cannot legally close a value recovers most of them.
 */
export function repairUnescapedStringQuotes(input: string): string {
  let out = ''
  let inString = false
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index] ?? ''
    if (char === '\\') {
      out += char + (input[index + 1] ?? '')
      index += 1
      continue
    }
    if (char !== '"') {
      out += char
      continue
    }
    if (!inString) {
      inString = true
      out += char
      continue
    }
    // Closing quote, unless the next meaningful char continues the string.
    let lookahead = index + 1
    while (lookahead < input.length && /\s/u.test(input[lookahead] ?? '')) lookahead += 1
    const next = input[lookahead] ?? ''
    if (next === '' || next === ':' || next === ',' || next === '}' || next === ']') {
      inString = false
      out += char
    } else {
      out += '\\"'
    }
  }
  return out
}

export function stripTrailingCommas(input: string): string {
  return input.replace(/,\s*([}\]])/gu, '$1')
}

const CATEGORY_ALIASES: Record<string, string> = {
  study: 'study', 学习: 'study', 学业: 'study', 课程: 'study', 作业: 'study', 课业: 'study',
  intern: 'intern', 实习: 'intern', 工作: 'intern', work: 'intern', 求职: 'intern',
  activity: 'activity', 活动: 'activity', 社团: 'activity', 社交: 'activity', 生活: 'activity',
  gym: 'gym', 健身: 'gym', 训练: 'gym', 运动: 'gym', exercise: 'gym', workout: 'gym',
}

export function normalizeCategory(value: unknown): string {
  if (typeof value !== 'string') return 'study'
  const key = value.trim().toLowerCase()
  return CATEGORY_ALIASES[key] ?? CATEGORY_ALIASES[value.trim()] ?? 'study'
}

function normalizeScore(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const rounded = Math.round(value)
    return rounded >= 1 && rounded <= 5 ? rounded : null
  }
  if (typeof value === 'string') {
    const stars = (value.match(/[●★*]/gu) ?? []).length
    if (stars >= 1 && stars <= 5) return stars
    const parsed = Number(value)
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 5) return Math.round(parsed)
  }
  return null
}

function stringList(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => (typeof item === 'string' ? item.trim() : ''))
    .filter((item) => item !== '')
    .slice(0, max)
}

function dateOnly(value: unknown, fallback: string): string {
  if (typeof value === 'string') {
    const match = /(\d{4})-(\d{2})-(\d{2})/u.exec(value)
    if (match !== null) return `${match[1]}-${match[2]}-${match[3]}`
  }
  return fallback
}

export function normalizeStructuredPayload(raw: unknown, fallbackDate: string): unknown {
  if (typeof raw !== 'object' || raw === null) return raw
  const source = raw as Record<string, unknown>
  // Accept both the new `plan` key and the older `carryOver` one.
  const rawPlan = Array.isArray(source['plan'])
    ? source['plan']
    : Array.isArray(source['carryOver'])
      ? source['carryOver']
      : []
  const plan = rawPlan.slice(0, 12).map((item) => {
        const entry = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
        const blockId = typeof entry['blockId'] === 'string' && entry['blockId'].trim() !== '' ? entry['blockId'].trim() : null
        const periods = Number(entry['periods'])
        const rawKind = typeof entry['kind'] === 'string' ? entry['kind'].trim().toLowerCase() : ''
        // A blockId means it came from the user's own plan, so treat it as carry.
        const kind = rawKind === 'new' ? 'new' : rawKind === 'carry' ? 'carry' : blockId === null ? 'new' : 'carry'
        return {
          kind,
          blockId,
          title: typeof entry['title'] === 'string' ? entry['title'].trim() : '',
          category: normalizeCategory(entry['category']),
          suggestDate: dateOnly(entry['suggestDate'], fallbackDate),
          periods: Number.isFinite(periods) ? Math.max(1, Math.min(24, Math.round(periods))) : 2,
          reason: typeof entry['reason'] === 'string' ? entry['reason'].trim() : '',
        }
      })

  // Progress updates: "read about 100 pages", "did five more problems". The
  // model must say whether a number is a running total or today's addition —
  // both readings are natural in Chinese and they are not interchangeable.
  const learning = Array.isArray(source['learning'])
    ? source['learning']
        .slice(0, 8)
        .map((item) => {
          const entry = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>
          const value = Number(entry['value'])
          const rawKind = typeof entry['kind'] === 'string' ? entry['kind'].trim().toLowerCase() : ''
          const rawMode = typeof entry['mode'] === 'string' ? entry['mode'].trim().toLowerCase() : ''
          return {
            ref:
              typeof entry['ref'] === 'string' && entry['ref'].trim() !== ''
                ? entry['ref'].trim()
                : null,
            title: typeof entry['title'] === 'string' ? entry['title'].trim() : '',
            kind: rawKind === 'practice' ? 'practice' : 'reading',
            mode: rawMode === 'total' ? 'total' : 'delta',
            value: Number.isFinite(value) ? Math.max(0, Math.min(100_000, Math.round(value))) : 0,
          }
        })
        .filter((item) => item.title !== '' && item.value > 0)
    : []

  return {
    summary: typeof source['summary'] === 'string' ? source['summary'].trim() : '',
    achievements: stringList(source['achievements'], 8),
    blockers: stringList(source['blockers'], 8),
    adjustments: stringList(source['adjustments'], 8),
    plan: plan.filter((item) => item.title !== ''),
    learning,
    energy: normalizeScore(source['energy']),
    mood: normalizeScore(source['mood']),
    tags: stringList(source['tags'], 8).map((tag) => (tag.startsWith('#') ? tag.slice(1) : tag)),
    memories: Array.isArray(source['memories']) ? source['memories'].slice(0, 6).filter((item: any) =>
      typeof item?.text === 'string' && typeof item?.evidence === 'string' && item.text.trim() !== '' && item.evidence.trim() !== '')
      .map((item: any) => ({ text: item.text.slice(0, 300), evidence: item.evidence.slice(0, 300) })) : [],
  }
}

export interface ParseOutcome {
  readonly structured: StructuredReviewRecord
}

export function parseStructuredReview(text: string, fallbackDate: string): ParseOutcome {
  const block = jsonPayload(text)
  const attempts = [block, repairUnescapedStringQuotes(block), stripTrailingCommas(repairUnescapedStringQuotes(block))]
  let lastError: unknown
  for (const attempt of attempts) {
    try {
      const parsed = JSON.parse(attempt) as unknown
      const normalized = normalizeStructuredPayload(parsed, fallbackDate)
      const result = StructuredReviewSchema.safeParse(normalized)
      if (result.success) {
        if (result.data.summary === '') throw new Error('summary 不能为空')
        return { structured: result.data }
      }
      lastError = result.error
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('JSON 解析失败')
}

/** Rule-based fallback so the user's own words survive a total AI failure. */
/**
 * Break one run-on paragraph into sentences.
 *
 * The hand-written fallback used to split on newlines only, so a review written
 * as a single block came out as one enormous "achievement" and a summary that was
 * literally the first 60 characters of the original text — which is what made
 * the whole panel look like it had done nothing.
 */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？；!?;])/u)
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

export function fallbackStructured(rawText: string, date: string): StructuredReviewSchemaLike {
  const byLine = rawText
    .split(/\r?\n/u)
    .map((line) => line.replace(/^[-*·•\s]+/u, '').trim())
    .filter((line) => line !== '')
  // One block of prose is the common case; split it into sentences so the
  // result still reads as a list rather than a wall.
  const lines = byLine.length > 1 ? byLine : splitSentences(rawText)

  const did: string[] = []
  const missed: string[] = []
  const adjust: string[] = []
  let bucket: 'did' | 'missed' | 'adjust' = 'did'
  for (const line of lines) {
    if (/^#{0,3}\s*(今天做了什么|做了什么|完成)/u.test(line)) {
      bucket = 'did'
      continue
    }
    if (/^#{0,3}\s*(哪里没完成|没完成|卡点|未完成)/u.test(line)) {
      bucket = 'missed'
      continue
    }
    if (/^#{0,3}\s*(明天怎么调|怎么调|调整|明天)/u.test(line)) {
      bucket = 'adjust'
      continue
    }
    if (bucket === 'did') did.push(line)
    else if (bucket === 'missed') missed.push(line)
    else adjust.push(line)
  }

  return {
    // The first sentence, verbatim and capped — never a mid-word slice of the
    // whole paragraph, which reads as a truncation bug.
    summary: (lines[0] ?? '').slice(0, 80),
    // Drop the first point only when it is literally what the summary was built
    // from (no headings, so line 1 doubled as the opener). With headings, line 1
    // is a heading and every point belongs in the list.
    achievements: (did[0] !== undefined && did[0] === lines[0] ? did.slice(1) : did).slice(0, 8),
    blockers: missed.slice(0, 8),
    adjustments: adjust.slice(0, 8),
    plan: [],
    learning: [],
    energy: null,
    mood: null,
    tags: [],
  }
}

export interface StructuredReviewSchemaLike {
  summary: string
  achievements: string[]
  blockers: string[]
  adjustments: string[]
  plan: { kind: string; blockId: string | null; title: string; category: string; suggestDate: string; periods: number; reason: string }[]
  learning: { ref: string | null; title: string; kind: string; mode: string; value: number }[]
  energy: number | null
  mood: number | null
  tags: string[]
}


/* ── standing routines ────────────────────────────────────────────────────── */

export interface RoutineDraft {
  readonly title: string
  readonly category: RoutineDraftCategory
  readonly weekdays: number[]
  readonly startPeriod: number
  readonly endPeriod: number
}

type RoutineDraftCategory = z.infer<typeof Category>

const KNOWN_CATEGORIES = new Set(['study', 'intern', 'activity', 'gym'])

/**
 * `normalizeCategory` falls back to 'study', which is the wrong honest answer
 * for "例会" or "洗漱" — those are commitments, not study. Keep explicit
 * categories as-is and route anything unclassified to 'activity'.
 */
function routineCategory(value: unknown): RoutineDraftCategory {
  const normalized = normalizeCategory(value)
  if (typeof value === 'string' && KNOWN_CATEGORIES.has(value.trim().toLowerCase())) {
    return normalized as RoutineDraftCategory
  }
  return (normalized === 'study' ? 'activity' : normalized) as RoutineDraftCategory
}

/**
 * Deliberately loose: one malformed row must not fail the whole reply, because
 * the filter below drops it and the user reviews the draft anyway. The strict
 * shape is enforced after filtering, by the record schema when the draft is
 * saved.
 */
const RoutineDraftSchema = z.object({
  title: z.string().default(''),
  category: Category.default('activity'),
  weekdays: z.array(z.number().int().min(1).max(7)).default([]),
  startPeriod: z.number().int().min(0).max(48).default(0),
  endPeriod: z.number().int().min(0).max(48).default(0),
})

const RoutineDraftListSchema = z.object({
  routines: z.array(RoutineDraftSchema).max(24).default([]),
})

/**
 * Tolerant on the way in, strict on the way out. Entries that cannot be trusted
 * are dropped rather than coerced: a routine on the wrong row is worse than a
 * missing one, because the user will trust the calendar it produced.
 */
export function parseRoutinesDraft(text: string): RoutineDraft[] {
  const raw = JSON.parse(stripTrailingCommas(jsonPayload(text))) as unknown

  // Accept both `{routines: [...]}` and a bare array — models drift between them.
  const candidate =
    Array.isArray(raw) ? { routines: raw } : raw !== null && typeof raw === 'object' ? raw : null
  if (candidate === null) throw new Error('返回的不是 JSON 对象或数组')
  const list = (candidate as { routines?: unknown }).routines
  if (!Array.isArray(list)) throw new Error('routines 必须是数组')

  const normalized = list.map((item) => {
    const entry = (item ?? {}) as Record<string, unknown>
    const start = Number(entry['startPeriod'])
    const end = Number(entry['endPeriod'])
    return {
      title: typeof entry['title'] === 'string' ? entry['title'].trim() : '',
      category: routineCategory(entry['category']),
      weekdays: Array.isArray(entry['weekdays'])
        ? [...new Set(entry['weekdays'].map((day) => Math.round(Number(day))))]
            .filter((day) => Number.isFinite(day) && day >= 1 && day <= 7)
            .sort((left, right) => left - right)
        : [],
      startPeriod: Number.isFinite(start) ? Math.round(start) : Number.NaN,
      endPeriod: Number.isFinite(end) ? Math.round(end) : Number.NaN,
    }
  })

  const parsed = RoutineDraftListSchema.parse({ routines: normalized })
  return parsed.routines.filter(
    (item) =>
      item.title !== '' &&
      item.startPeriod >= 1 &&
      item.endPeriod >= item.startPeriod &&
      item.endPeriod <= 24,
  ) as RoutineDraft[]
}
