import { useEffect, useMemo, useState } from 'react'
import { createRuntime, usePlanState, type PageKey } from './runtime.ts'
import { createHttpRpc } from './http.ts'
import { installStyles } from './styles.ts'
import { zh } from './locales.ts'
import { TodayPage } from './pages/Today.tsx'
import { WeekPage } from './pages/Week.tsx'
import { GymPage } from './pages/Gym.tsx'
import { MobileGym } from './pages/MobileGym.tsx'
import { MobileLearn } from './pages/MobileLearn.tsx'
import { LearnPage } from './pages/Learn.tsx'
import { RecordPage } from './pages/Record.tsx'
import { SettingsPage } from './pages/Settings.tsx'
import { CoachDrawer } from './ui/CoachDrawer.tsx'
import { TaskFeedback } from './ui/TaskFeedback.tsx'
import { MobileAgenda } from './ui/MobileAgenda.tsx'
import { PhoneSheet } from './ui/PhoneSheet.tsx'
import type { PlanBlockRecord } from '../domain.ts'
import { DragLayer } from './drag/DragLayer.tsx'
import { activeBlock } from '../adaptive.ts'
import { formatHm, isoWeekKey, parseIsoDate, shiftWeekKey, weekdayZh, weekDates } from '../clock.ts'
import { calendarLabel } from '../calendar.ts'
import { Icon, type IconName } from './icons.tsx'
import type { PageProps } from './pages/types.ts'

const t = (key: string, params?: Record<string, unknown>) => Object.entries(params ?? {}).reduce((value, [name, replacement]) => value.replaceAll(`{${name}}`, String(replacement)), zh[key] ?? key)
const pages: Partial<Record<PageKey, (props: PageProps) => JSX.Element>> = { today: TodayPage, week: WeekPage, gym: GymPage, learn: LearnPage, record: RecordPage, setting: SettingsPage }
const nav = [['today','今天'],['week','本周'],['gym','训练'],['learn','学习'],['record','记录'],['setting','设置']] as const
const navIcons: Partial<Record<PageKey, IconName>> = { today:'today', week:'week', gym:'gym', learn:'list' }

/** Phone layout has its own hierarchy instead of shrinking the desktop dashboard. */
function MobileToday({ state, runtime, onTellAgnes }: PageProps): JSX.Element {
  const [feedback,setFeedback]=useState<PlanBlockRecord|null>(null)
  const snapshot = state.snapshot
  if (!snapshot) return <p className="mobile-loading">正在读取今天的安排…</p>
  const { today, todayIso, backlog } = snapshot
  const blocks = today.blocks.filter(activeBlock).slice().sort((a,b) => a.startMinute-b.startMinute)
  const done = blocks.filter(block => block.done).length
  const next = blocks.find(block => !block.done && block.endMinute > snapshot.currentMinute)
  const due = backlog.filter(item => item.dueDate === todayIso)
  const date = parseIsoDate(todayIso)
  return <section className="mobile-today" aria-label="今日安排">
    <div className="mobile-today-heading">
      <div><h1>今天</h1><span>{done}/{blocks.length} 已打卡</span></div>
      <button type="button" onClick={() => { void runtime.setWeek(isoWeekKey(date)); runtime.setPage('week') }}>本周安排<Icon name="chevronRight" size={14} /></button>
    </div>
    {due.length > 0 && <p className="mobile-due"><Icon name="bell" size={14} />今天截止：{due.map(item=>item.title).join('、')}</p>}
    {blocks.length === 0 && <div className="mobile-empty"><Icon name="today" size={28} /><p>今天还没有安排</p><button onClick={() => onTellAgnes?.()}>告诉 Agnes，安排一件想做的事</button></div>}
    <MobileAgenda blocks={blocks} date={todayIso} today={todayIso} nextId={next?.id} runtime={runtime} onSelect={setFeedback} />
    <button className="mobile-add-task" onClick={() => onTellAgnes?.()}><Icon name="plus" size={16} />添加或调整安排</button>
    <div className="mobile-legend" aria-label="任务分类"><span data-category="study">工作与学习</span><span data-category="gym">健康</span><span data-category="life">生活与人际</span></div>
    {feedback&&<TaskFeedback date={todayIso} block={feedback} runtime={runtime} onClose={()=>setFeedback(null)}/>}
  </section>
}

function MobileWeek({ state, runtime, onTellAgnes }: PageProps): JSX.Element {
  const snapshot = state.snapshot
  const [selected, setSelected] = useState(snapshot?.todayIso ?? '')
  const [detail, setDetail] = useState<PlanBlockRecord | null>(null)
  if (!snapshot) return <p>正在读取本周安排…</p>
  const dates = weekDates(snapshot.weekKey)
  const date = dates.includes(selected) ? selected : dates[0]!
  const day = snapshot.week.find((item) => item.date === date)
  const blocks = day?.blocks.filter(activeBlock).sort((a,b) => a.startMinute-b.startMinute) ?? []
  return <section className="mobile-week">
    <div className="mobile-week-head"><h1>本周</h1><button onClick={() => { setSelected(snapshot.todayIso); void runtime.setWeek(isoWeekKey(parseIsoDate(snapshot.todayIso))) }}>今天</button></div>
    <div className="phone-week-range"><button onClick={() => void runtime.setWeek(shiftWeekKey(snapshot.weekKey, -1))} aria-label="上一周"><Icon name="chevronLeft" size={18}/></button><span>{dates[0]?.slice(5)} — {dates[6]?.slice(5)}</span><button onClick={() => void runtime.setWeek(shiftWeekKey(snapshot.weekKey, 1))} aria-label="下一周"><Icon name="chevronRight" size={18}/></button></div>
    <div className="mobile-dates" role="group" aria-label="选择日期">{dates.map((item, index) => <button key={item} aria-label={`${item} 周${['一','二','三','四','五','六','日'][index]}`} aria-pressed={date === item} data-today={item === snapshot.todayIso || undefined} onClick={() => { setSelected(item); setDetail(null) }}><small>{['一','二','三','四','五','六','日'][index]}</small><b>{item.slice(8)}</b><i>{snapshot.week.find(entry => entry.date === item)?.blocks.filter(activeBlock).length ?? 0}项</i></button>)}</div>
    <div className="phone-week-day"><span>{calendarLabel(date) || `${parseIsoDate(date).getMonth()+1}月${parseIsoDate(date).getDate()}日`}</span><span>{blocks.length} 项安排</span></div>
    <MobileAgenda blocks={blocks} date={date} today={snapshot.todayIso} runtime={runtime} onSelect={setDetail}/>
    {!blocks.length && <p className="phone-section-empty">这天还没有安排。</p>}
    <button className="mobile-add-task" onClick={() => onTellAgnes?.()}><Icon name="plus" size={16}/>添加或调整安排</button>
    {detail && (date <= snapshot.todayIso ? <TaskFeedback date={date} block={detail} runtime={runtime} onClose={() => setDetail(null)}/> : <PhoneSheet title={detail.title} onClose={() => setDetail(null)} footer={<button className="phone-primary" onClick={() => { setDetail(null); onTellAgnes?.(`调整 ${date} ${formatHm(detail.startMinute)}–${formatHm(detail.endMinute)} 的「${detail.title}」：`) }}>告诉 Agnes 调整</button>}><p>{date} · {formatHm(detail.startMinute)}–{formatHm(detail.endMinute)}</p>{detail.note && <p>{detail.note}</p>}</PhoneSheet>)}
  </section>
}
export function PlannerWeb({ owner, email, onLogout }: { owner: string; email: string; onLogout: () => Promise<void> }): JSX.Element {
  const [status, setStatus] = useState('连接中…')
  const rpc = useMemo(() => createHttpRpc(owner, setStatus), [owner])
  const runtime = useMemo(() => createRuntime(rpc), [rpc])
  const state = usePlanState(runtime)
  const [coachOpen, setCoachOpen] = useState(false)
  const [composeRequest, setComposeRequest] = useState<{ id: string; text: string; date?: string }>()
  const [phone, setPhone] = useState(false)
  const [backup, setBackup] = useState<unknown>(null)
  const [report, setReport] = useState<any>(null)
  const [migrationBusy, setMigrationBusy] = useState(false)
  useEffect(() => {
    const uninstall = installStyles()
    const mobileStyles=document.createElement('link');mobileStyles.rel='stylesheet';mobileStyles.href='/mobile.css';document.head.append(mobileStyles)
    runtime.open()
    const media = matchMedia('(max-width: 700px)')
    const resize = () => setPhone(media.matches)
    resize(); media.addEventListener('change', resize)
    const synchronize = () => void rpc.sync().then(() => runtime.refresh()).catch(() => undefined)
    window.addEventListener('online', synchronize)
    synchronize()
    return () => { uninstall();mobileStyles.remove(); media.removeEventListener('change', resize); window.removeEventListener('online', synchronize) }
  }, [runtime, rpc])
  const tell = (text?: string) => { if (text?.trim()) setComposeRequest({ id: crypto.randomUUID(), text, ...(state.snapshot ? { date: state.snapshot.todayIso } : {}) }); setCoachOpen(true) }
  const Current = phone && state.page === 'today' ? MobileToday : phone && state.page === 'week' ? MobileWeek : phone && state.page === 'gym' ? MobileGym : phone && state.page === 'learn' ? MobileLearn : pages[state.page] ?? TodayPage
  const headerDate = state.snapshot ? parseIsoDate(state.snapshot.todayIso) : null
  const migrate = async (preview: boolean, file = backup) => {
    setMigrationBusy(true)
    try {
      const result = await fetch('/api/migration', { method: 'POST', headers: { 'Content-Type':'application/json' }, body: JSON.stringify({ backup: file, preview }) }).then((response) => response.json())
      if (!result.ok) throw new Error(result.error?.message ?? '迁移失败，原数据没有被覆盖')
      setReport({ preview: preview && !result.value.alreadyImported, report: result.value, alreadyImported: result.value.alreadyImported }); if (!preview) await runtime.refresh()
    } catch (error) { setReport({ error: error instanceof Error ? error.message : String(error) }) }
    finally { setMigrationBusy(false) }
  }
  return <div className="dp-root dp-web" data-page={state.page}>
    <header className="web-header"><b>{phone && headerDate ? <>{headerDate.getMonth()+1}月{headerDate.getDate()}日<span className="mobile-header-weekday">周{weekdayZh(headerDate)}</span></> : '每日计划'}</b><nav aria-label="主导航">{nav.map(([page,label]) => <button key={page} aria-current={state.page === page ? 'page' : undefined} onClick={() => runtime.setPage(page)}>{label}</button>)}</nav><span className="web-sync" role="status">{status}</span>{!phone&&<button className="dp-btn dp-agent-trigger" onClick={() => tell()}>✧ 告诉 Agnes</button>}{phone&&<details className="web-more"><summary aria-label="更多页面">⋯</summary><div>{nav.slice(4).map(([page,label])=><button key={page} onClick={event=>{runtime.setPage(page);event.currentTarget.closest('details')?.removeAttribute('open')}}>{label}</button>)}</div></details>}</header>
    <main className="dp-body dp-scroll"><div role="tabpanel">{state.error && <p className="dp-error">{state.error}</p>}<Current t={t} state={state} runtime={runtime} onTellAgnes={tell} />
      {state.page === 'setting' && <section className="web-migration"><h3>个人数据与账号</h3><p>{email}</p><p>先预览本地备份，再导入此账号；有冲突会停止，历史 AI 建议不会重做。</p><input aria-label="选择插件备份" type="file" accept=".json" disabled={migrationBusy} onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { const data = JSON.parse(await file.text()); setBackup(data); await migrate(true, data) } catch { setReport({ error:'无法读取备份文件' }) } }} />{report && <div role="status">{report.error ? <p className="dp-error">{report.error}</p> : <><p>{report.alreadyImported ? '这份备份已导入，无需重复导入。' : report.preview ? '预览完成，尚未写入。' : '导入完成。'} 共 {report.report?.total ?? 0} 条记录。</p>{report.report?.counts && <p>{Object.entries(report.report.counts).map(([name,count]) => `${name}: ${count}`).join(' · ')}</p>}{report.report?.warnings?.map((warning: string) => <p key={warning}>{warning}</p>)}</>}</div>}{backup && report?.preview && <button className="dp-btn" disabled={migrationBusy || !!report.error} onClick={() => void migrate(false)}>导入这份备份</button>}<p><a href="/api/migration" download>下载云端独立备份</a></p><button className="dp-btn" onClick={() => { void onLogout().then(() => rpc.clear()) }}>退出此账号</button></section>}
    </div></main>
    <CoachDrawer state={state} runtime={runtime} mobile={phone} composeRequest={composeRequest} open={coachOpen} onClose={() => setCoachOpen(false)} />
    {phone && <nav className="mobile-nav" aria-label="手机导航">{nav.slice(0,4).map(([page,label]) => <button key={page} aria-current={state.page === page ? 'page' : undefined} onClick={() => runtime.setPage(page)}><Icon name={navIcons[page]!} size={20} /><span>{label}</span></button>)}<button className="mobile-agent-nav" onClick={() => tell()}><Icon name="sparkle" size={20} /><span>告诉 Agnes</span></button></nav>}
    {state.toast && <div className="dp-toast">{state.toast}</div>}<DragLayer />
  </div>
}
