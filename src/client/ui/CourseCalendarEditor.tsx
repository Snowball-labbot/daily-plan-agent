import { useState } from 'react'
import { HOLIDAY_SOURCE } from '../../calendar.ts'
import { isoWeekKey, parseIsoDate } from '../../clock.ts'
import type { PageProps } from '../pages/types.ts'

export function CourseCalendarEditor({ state, runtime }: Pick<PageProps, 'state' | 'runtime'>): JSX.Element | null {
  const [date, setDate] = useState('')
  const [weekday, setWeekday] = useState('none')
  const [busy, setBusy] = useState(false)
  const snapshot = state.snapshot
  if (!snapshot) return null
  const calendar = snapshot.settings.courseCalendar ?? { respectHolidays: true, overrides: [] }
  const save = async (overrides: typeof calendar.overrides, target = snapshot.todayIso): Promise<void> => {
    setBusy(true)
    try {
      await runtime.updateSettings({ courseCalendar: { overrides } })
      await runtime.generateWeek(isoWeekKey(parseIsoDate(target)))
    } catch (failure) { runtime.notify(String(failure)) }
    finally { setBusy(false) }
  }
  return <div className="dp-settings-body">
    <div className="dp-holiday-settings"><label><input type="checkbox" checked={calendar.respectHolidays} disabled={busy} onChange={(event) => { const checked = event.target.checked; setBusy(true); void runtime.updateSettings({ courseCalendar: { respectHolidays: checked } }).then(() => runtime.generateWeek(snapshot.weekKey)).catch((failure) => runtime.notify(String(failure))).finally(() => setBusy(false)) }} />普通课程避开中国法定假期</label><a href={HOLIDAY_SOURCE} target="_blank" rel="noreferrer">2026 官方日期</a></div>
    <p className="dp-faint">调休上班不等于学校补课。按校历填写“该日上周几的课”；固定约定、手动任务和已完成记录会保留。其他年份需另行核对。</p>
    <div className="dp-holiday-settings"><input type="date" aria-label="校历例外日期" value={date} disabled={busy} onChange={(event) => setDate(event.target.value)} /><select aria-label="校历例外安排" value={weekday} disabled={busy} onChange={(event) => setWeekday(event.target.value)}><option value="none">该日停课</option>{[1, 2, 3, 4, 5, 6, 7].map((value) => <option key={value} value={value}>上周{'一二三四五六日'[value - 1]}的课</option>)}</select><button type="button" className="dp-btn dp-btn--sm" disabled={busy || !date} onClick={() => { void save([...calendar.overrides.filter((item) => item.date !== date), { date, weekday: weekday === 'none' ? null : Number(weekday) }], date) }}>保存并同步该周</button></div>
    {calendar.overrides.map((item) => <div className="dp-holiday-settings" key={item.date}><span>{item.date} · {item.weekday === null ? '停课' : `上周${'一二三四五六日'[item.weekday - 1]}的课`}</span><button type="button" className="dp-btn dp-btn--sm dp-btn--ghost" disabled={busy} onClick={() => { void save(calendar.overrides.filter((entry) => entry.date !== item.date), item.date) }}>移除</button></div>)}
  </div>
}
