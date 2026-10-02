import type { WorkflowRunRecord } from '../../domain.ts'
import { activeBlock, type AdaptiveResult } from '../../adaptive.ts'
import { formatHm, isoWeekKey, parseIsoDate } from '../../clock.ts'
import type { PageKey, PlanRuntime } from '../runtime.ts'
import type { PlanSnapshot } from '../wire.ts'
import { Icon } from '../icons.tsx'

type Fact = { title: string; detail: string; page: PageKey; date?: string }

/** Only summarize receipts of actual writes; a draft alone is not evidence. */
function savedFacts(changes: readonly string[]): Fact[] {
  return changes.flatMap((change): Fact[] => {
    const done = /^已补记完成：(.+)$/u.exec(change)
    if (done) return [{ title: done[1]!, detail: '已补记完成', page: 'week' }]
    const learning = /^(\d{4}-\d{2}-\d{2}) 已同步学习进度：(.+)$/u.exec(change)
    if (learning) return [{ title: learning[2]!, detail: `${learning[1]!.slice(5).replace('-', '/')} · 进度已同步`, page: 'learn' }]
    const gym = /^(\d{4}-\d{2}-\d{2}) (.+)：补记 (\d+) 组实际表现。$/u.exec(change)
    if (gym) return [{ title: gym[2]!, detail: `${gym[1]!.slice(5).replace('-', '/')} · 已记录 ${gym[3]} 组`, page: 'record' }]
    const task = /^任务池新增：(.+)$/u.exec(change)
    if (task) return [{ title: task[1]!, detail: '已加入任务池', page: 'week' }]
    const event = /^(\d{4}-\d{2}-\d{2}) 已安排活动：(.+) · (.+)$/u.exec(change)
    if (event) return [{ title: event[2]!, detail: `${event[1]!.slice(5).replace('-', '/')} · ${event[3]}`, page: 'week', date: event[1]! }]
    return []
  }).slice(0, 3)
}

export function AgentResult({ run, allocation, snapshot, context, runtime, onContinue }: {
  run: WorkflowRunRecord; allocation: AdaptiveResult | null; snapshot: PlanSnapshot;
  context: PlanSnapshot['workflow']; runtime: PlanRuntime; onContinue: () => void;
}): JSX.Element {
  const changes = run.appliedChanges ?? []
  const facts = savedFacts(changes)
  // Read current persisted schedules, including across weeks, rather than a stale
  // allocation response. Reopening the composer must keep future events visible.
  const days = context.upcomingDays ?? allocation?.days ?? context.days
  const isAppointment = (date: string, block: { title: string; startMinute: number; endMinute: number }): boolean => (run.draft?.appointments ?? []).some((event) =>
    event.date === date && event.title.trim() === block.title && event.startMinute === block.startMinute && event.endMinute === block.endMinute)
  const requestedTask = (block: { title: string; backlogId: string | null }): boolean => run.mode !== 'plan' ||
    !(run.draft?.tasks.length || run.draft?.taskActions.length) || !!run.draft?.tasks.some((task) => task.title.trim() === block.title) ||
    !!run.draft?.taskActions.some((action) => action.taskId === block.backlogId)
  const upcoming = days.flatMap((day) => day.blocks.filter((block) => ((block.adaptive && requestedTask(block)) || isAppointment(day.date, block)) && activeBlock(block) && !block.done &&
    (day.date > snapshot.todayIso || (day.date === snapshot.todayIso && block.endMinute > snapshot.currentMinute)))
    .map((block) => ({ ...block, date: day.date })))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMinute - b.startMinute).slice(0, 4)
  const memories = context.memories.filter((memory) => memory.sourceId === run.id)
  const openPage = (page: PageKey): void => { if (page === 'record') runtime.setRecordView('training'); runtime.setPage(page) }
  const openWeek = (date?: string): void => {
    // A review can be opened while browsing a different week.
    void runtime.setWeek(date ? isoWeekKey(parseIsoDate(date)) : context.weekKey); runtime.setPage('week')
  }
  return <div className="dp-agent-brief">
    <div className="dp-brief-title"><h3>{run.mode === 'plan' ? run.draft?.questions.length ? '展望已整理' : '已安排好接下来' : '已更新你的计划'}</h3><span><i />已保存</span></div>
    <div className="dp-brief-columns">
      <section><h4>{run.mode === 'plan' ? '已整理' : '已记录'}</h4><div className="dp-brief-items">
        {facts.map((fact, index) => <button type="button" key={index} onClick={() => fact.page === 'week' ? openWeek(fact.date) : openPage(fact.page)}><div><b>{fact.title}</b><small>{fact.detail}</small></div><Icon name="chevronRight" size={12} /></button>)}
        {facts.length === 0 && <p className="dp-muted">{changes.length > 0 ? '这次更新已保存，明细在下方。' : run.mode === 'plan' ? '展望已保存，待补充的信息见下方。' : '复盘已保存，没有新增执行记录。'}</p>}
      </div></section>
      <section><h4>接下来</h4><div className="dp-brief-items">
        {upcoming.map((block) => <button type="button" key={`${block.date}:${block.id}`} onClick={() => openWeek(block.date)}><div><b>{block.title}</b><small>{block.date === snapshot.todayIso ? '今天' : block.date.slice(5).replace('-', '/')} · {formatHm(block.startMinute)}–{formatHm(block.endMinute)}</small></div><Icon name="chevronRight" size={12} /></button>)}
        {upcoming.length === 0 && <p className="dp-muted">暂时没有新的弹性安排，空档留给你。</p>}
      </div></section>
    </div>
    {memories.length > 0 && <div className="dp-brief-memory"><span>记住了</span><button type="button" onClick={() => openPage('setting')}>{memories.map((memory) => memory.text).join('；')}<Icon name="chevronRight" size={12} /></button></div>}
    {(run.applyWarnings ?? []).map((warning, index) => <p className="dp-brief-warning" key={index} role="alert">{warning}</p>)}
    {run.draft?.questions.length ? <div className="dp-brief-questions"><b>还想确认一下</b>{run.draft.questions.map((question, index) => <p key={index}>{question}</p>)}</div> : null}
    {(allocation?.waiting ?? []).length > 0 && <div className="dp-brief-questions"><b>这些还需要留出时间</b>{allocation!.waiting.map((task) => <p key={task.taskId}>{task.title}：{task.reason}</p>)}</div>}
    <div className="dp-brief-actions"><button type="button" className="dp-btn dp-btn--primary" onClick={() => openWeek(upcoming[0]?.date)}>看后续安排<Icon name="chevronRight" size={14} /></button><button type="button" className="dp-btn dp-btn--ghost" onClick={onContinue}>{run.mode === 'plan' ? run.draft?.questions.length ? '补充安排' : '继续安排' : run.draft?.questions.length ? '补充复盘' : '继续复盘'}</button></div>
    <details className="dp-brief-audit"><summary>{run.mode === 'plan' ? '查看原文与安排明细' : '查看复盘与更新明细'}<Icon name="chevronDown" size={12} /></summary>
      <small>{(run.mode === 'plan' ? run.planStart : run.rangeStart) ?? run.date} — {(run.mode === 'plan' ? run.planEnd : run.rangeEnd) ?? run.date}</small>
      <p className="dp-brief-original">{run.rawText}</p>
      {run.draft?.summary && <p>{run.draft.summary}</p>}
      {changes.map((change, index) => <p key={index}>{change}</p>)}
      {run.draft?.gymAdvice.map((advice, index) => <p key={`gym:${index}`}>{advice}</p>)}
      {memories.map((memory) => <p key={memory.id}>{memory.text} · 来自：{memory.evidence}</p>)}
    </details>
  </div>
}
