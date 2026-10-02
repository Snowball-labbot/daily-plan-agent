/**
 * Tolerant parser for timetable text pasted out of a university portal.
 *
 * Real input is messy — `周一 1-2 高等数学 教三-201 1-16周`, `一 1-2 高数`,
 * `高等数学 周一 第1-2节 教三201`, `Wed 3-4 Calculus`. We extract weekday,
 * week list and period range first (longest anchors first, so `1-16周` is never
 * mistaken for a period range), then treat what is left as name + location.
 * Unparseable lines are reported back rather than silently dropped.
 */

export interface ParsedCourseRow {
  readonly name: string
  readonly weekday: number
  readonly startPeriod: number
  readonly endPeriod: number
  readonly weeks: number[]
  readonly location: string
  readonly kind: 'course' | 'fixed'
}

export interface CourseParseResult {
  readonly rows: ParsedCourseRow[]
  readonly failed: { readonly line: string; readonly reason: string }[]
}

const WEEKDAY_NAMES: Record<string, number> = {
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7,
  '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7,
}

const WEEKDAY_EN: Record<string, number> = {
  mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6,
  sun: 7, sunday: 7,
}

const FIXED_KEYWORDS = ['例会', '班会', '社团', '讲座', '组会', '党团', '大会', '晨会', '周会', '值班']
const LOCATION_HINT = /(楼|教|室|馆|场|中心|校区|号|座|栋|阶|阶|机房|实验室)/

const WEEKDAY_RE = /(?:周|週|星期|礼拜)\s*([一二三四五六日天1-7])/u
const WEEKDAY_BARE_RE = /^\s*([一二三四五六日天])\s/u
const WEEKDAY_EN_RE = /\b(mon|monday|tue|tues|tuesday|wed|weds|wednesday|thu|thur|thurs|thursday|fri|friday|sat|saturday|sun|sunday)\b/iu
const WEEK_TOKEN_RE = /(?:第)?\s*([0-9]{1,2}(?:\s*[-~－—～至到]\s*[0-9]{1,2})?(?:\s*[,，、]\s*[0-9]{1,2})*)\s*周(?:次)?\s*(?:[(（]?\s*(单|双)\s*周?\s*[)）]?)?/u
const PERIOD_RANGE_RE = /(?:第)?\s*([0-9]{1,2})\s*[-~－—～至到]\s*([0-9]{1,2})\s*节?/u
const PERIOD_LIST_RE = /(?:第)?\s*([0-9]{1,2})\s*[,，、]\s*([0-9]{1,2})\s*节?/u
const PERIOD_SINGLE_RE = /(?:第)?\s*([0-9]{1,2})\s*节/u

function splitTokens(line: string): string[] {
  const byStrong = line.split(/[\t|｜]+/u).map((part) => part.trim()).filter((part) => part !== '')
  if (byStrong.length >= 2) return byStrong
  const byGap = line.split(/\s{2,}/u).map((part) => part.trim()).filter((part) => part !== '')
  if (byGap.length >= 2) return byGap
  return line.split(/\s+/u).map((part) => part.trim()).filter((part) => part !== '')
}

function expandWeeks(spec: string, parity: string | undefined): number[] {
  const out = new Set<number>()
  const chunks = spec.split(/[,，、]/u)
  for (const chunk of chunks) {
    const range = /^([0-9]{1,2})\s*[-~－—～至到]\s*([0-9]{1,2})$/u.exec(chunk.trim())
    if (range !== null) {
      const from = Number(range[1])
      const to = Number(range[2])
      for (let week = Math.min(from, to); week <= Math.max(from, to); week += 1) {
        if (week >= 1 && week <= 60) out.add(week)
      }
      continue
    }
    const single = /^([0-9]{1,2})$/u.exec(chunk.trim())
    if (single !== null) {
      const week = Number(single[1])
      if (week >= 1 && week <= 60) out.add(week)
    }
  }
  const weeks = [...out].sort((left, right) => left - right)
  if (parity === '单') return weeks.filter((week) => week % 2 === 1)
  if (parity === '双') return weeks.filter((week) => week % 2 === 0)
  return weeks
}

export function parseCourseLine(rawLine: string): ParsedCourseRow | string {
  let line = rawLine.trim().replace(/^[-*·•\s]+/u, '')
  if (line === '') return '空行'

  // 1. weeks — must go first, otherwise `1-16周` reads as a period range.
  let weeks: number[] = []
  const weekMatch = WEEK_TOKEN_RE.exec(line)
  if (weekMatch !== null) {
    weeks = expandWeeks(weekMatch[1] ?? '', weekMatch[2])
    line = line.slice(0, weekMatch.index) + ' ' + line.slice(weekMatch.index + weekMatch[0].length)
  }

  // 2. weekday
  let weekday: number | null = null
  const weekdayMatch = WEEKDAY_RE.exec(line)
  if (weekdayMatch !== null) {
    weekday = WEEKDAY_NAMES[weekdayMatch[1] ?? ''] ?? null
    line = line.slice(0, weekdayMatch.index) + ' ' + line.slice(weekdayMatch.index + weekdayMatch[0].length)
  } else {
    const english = WEEKDAY_EN_RE.exec(line)
    if (english !== null) {
      weekday = WEEKDAY_EN[english[1]?.toLowerCase() ?? ''] ?? null
      line = line.slice(0, english.index) + ' ' + line.slice(english.index + english[0].length)
    } else {
      const bare = WEEKDAY_BARE_RE.exec(line)
      if (bare !== null) {
        weekday = WEEKDAY_NAMES[bare[1] ?? ''] ?? null
        line = line.slice(0, bare.index) + ' ' + line.slice(bare.index + bare[0].length)
      }
    }
  }
  if (weekday === null) return '没找到星期（周一到周日）'

  // 3. periods
  let startPeriod: number | null = null
  let endPeriod: number | null = null
  const rangeMatch = PERIOD_RANGE_RE.exec(line)
  if (rangeMatch !== null) {
    startPeriod = Number(rangeMatch[1])
    endPeriod = Number(rangeMatch[2])
    line = line.slice(0, rangeMatch.index) + ' ' + line.slice(rangeMatch.index + rangeMatch[0].length)
  } else {
    const listMatch = PERIOD_LIST_RE.exec(line)
    if (listMatch !== null) {
      startPeriod = Number(listMatch[1])
      endPeriod = Number(listMatch[2])
      line = line.slice(0, listMatch.index) + ' ' + line.slice(listMatch.index + listMatch[0].length)
    } else {
      const singleMatch = PERIOD_SINGLE_RE.exec(line)
      if (singleMatch !== null) {
        startPeriod = Number(singleMatch[1])
        endPeriod = Number(singleMatch[1])
        line = line.slice(0, singleMatch.index) + ' ' + line.slice(singleMatch.index + singleMatch[0].length)
      }
    }
  }
  if (startPeriod === null || endPeriod === null) return '没找到节次（如 1-2 或 第3节）'
  if (startPeriod < 1 || endPeriod > 24) return '节次超出 1-24 范围'
  if (endPeriod < startPeriod) {
    const swap = startPeriod
    startPeriod = endPeriod
    endPeriod = swap
  }

  // 4. what is left: name first, location = the best remaining candidate
  const leftovers = splitTokens(line.replace(/\s+/gu, ' ').trim())
  if (leftovers.length === 0) return '没找到课程名'

  let name = leftovers[0] ?? ''
  let location = ''
  if (leftovers.length >= 2) {
    const candidates = leftovers.slice(1)
    const hinted = candidates.find((token) => LOCATION_HINT.test(token))
    location = hinted ?? candidates[0] ?? ''
  }
  if (name === '' || /^[0-9]+$/u.test(name)) {
    const fallback = leftovers.find((token) => !/^[0-9]+$/u.test(token))
    if (fallback === undefined) return '没找到课程名'
    name = fallback
    if (location === fallback) location = ''
  }

  const kind = FIXED_KEYWORDS.some((keyword) => name.includes(keyword)) ? 'fixed' : 'course'
  return {
    name,
    weekday,
    startPeriod,
    endPeriod,
    weeks,
    location,
    kind,
  }
}

export function parseCourseText(text: string): CourseParseResult {
  const rows: ParsedCourseRow[] = []
  const failed: { line: string; reason: string }[] = []
  const lines = text.split(/\r?\n/u)
  for (const rawLine of lines) {
    const trimmed = rawLine.trim()
    if (trimmed === '' || /^[#/]{1,2}/u.test(trimmed)) continue
    const parsed = parseCourseLine(trimmed)
    if (typeof parsed === 'string') failed.push({ line: trimmed, reason: parsed })
    else rows.push(parsed)
  }
  return { rows, failed }
}

/** One-line summary used by the import preview. */
export function describeRow(row: ParsedCourseRow): string {
  const weeks = row.weeks.length === 0 ? '每周' : `${String(row.weeks.length)} 周`
  const where = row.location === '' ? '' : ` · ${row.location}`
  return `周${'一二三四五六日'[row.weekday - 1] ?? '?'} 第 ${String(row.startPeriod)}-${String(row.endPeriod)} 节 · ${weeks}${where}`
}
