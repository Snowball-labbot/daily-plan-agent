/** 2026 国办发明电〔2025〕7号。学校补课须以校历为准，不推断星期映射。 */
export const HOLIDAY_SOURCE = 'https://www.beijing.gov.cn/cs/gncs/zcwj/202603/t20260327_4568275.html'
const REST = [
  ['2026-01-01', '2026-01-03', '元旦'], ['2026-02-15', '2026-02-23', '春节'],
  ['2026-04-04', '2026-04-06', '清明'], ['2026-05-01', '2026-05-05', '劳动节'],
  ['2026-06-19', '2026-06-21', '端午'], ['2026-09-25', '2026-09-27', '中秋'],
  ['2026-10-01', '2026-10-07', '国庆'],
] as const
const WORK = ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10']
export interface CourseCalendar { respectHolidays: boolean; overrides: { date: string; weekday: number | null }[] }
export function holidayLabel(date: string): string | null {
  return REST.find(([start, end]) => date >= start && date <= end)?.[2] ?? null
}
export function calendarLabel(date: string, calendar?: CourseCalendar): string | null {
  const override = calendar?.overrides.find((item) => item.date === date)
  if (override) return override.weekday === null ? '停课' : `补周${'一二三四五六日'[override.weekday - 1]}`
  return holidayLabel(date) ? `${holidayLabel(date)}${calendar?.respectHolidays === false ? '·按课表' : '休'}` : WORK.includes(date) ? '调休·校历待定' : date.slice(0, 4) !== '2026' ? '假期未核对' : null
}
export function courseWeekday(date: string, weekday: number, calendar?: CourseCalendar): number | null {
  const override = calendar?.overrides.find((item) => item.date === date)
  if (override) return override.weekday
  return calendar?.respectHolidays !== false && holidayLabel(date) !== null ? null : weekday
}
