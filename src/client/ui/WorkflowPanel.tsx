import { useEffect, useRef, useState } from 'react'
import type { WorkflowDraftEdits, WorkflowRunRecord } from '../../domain.ts'
import { activeBlock, flexibleBlock, type AdaptiveResult } from '../../adaptive.ts'
import { addDays, formatHm, isoDate, isoWeekKey, parseIsoDate, weekDates } from '../../clock.ts'
import { Icon } from '../icons.tsx'
import type { PageProps } from '../pages/types.ts'
import type { PlanSnapshot } from '../wire.ts'
import { Card } from './kit.tsx'
import { WorkflowDraftEditor } from './WorkflowDraftEditor.tsx'
import { AgentPlanPanel } from './AgentPlanPanel.tsx'

type Mode = WorkflowRunRecord['mode']
type RunResult = { run: WorkflowRunRecord; allocation: AdaptiveResult | null }

export function WorkflowPanel({ state, runtime, mode: initialMode = 'review', weekKey, reportEnd, compact = false, journal = false, topic = 'general', unified = false, mobile = false, onReportEndChange, onNavigate, onBusyChange, onPlanningChange, composeRequest }: Pick<PageProps, 'state' | 'runtime'> & {
  mode?: Mode; weekKey?: string; reportEnd?: string; compact?: boolean; journal?: boolean; topic?: 'general' | 'training'; unified?: boolean; onBusyChange?: (busy: boolean) => void;
  composeRequest?: { id: string; text: string; date?: string } | undefined;
  mobile?: boolean; onReportEndChange?: ((date: string) => void) | undefined;
  onNavigate?: (() => void) | undefined;
  onPlanningChange?: (planning: boolean) => void;
}): JSX.Element | null {
  const snapshot = state.snapshot
  const key = weekKey ?? snapshot?.weekKey
  const endDate = reportEnd ?? snapshot?.todayIso ?? ''
  const [mode, setMode] = useState<Mode>(initialMode)
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const [span, setSpan] = useState('2')
  const [scope, setScope] = useState('recent')
  const [futureSpan, setFutureSpan] = useState('auto')
  const [futureStart, setFutureStart] = useState(snapshot?.todayIso ?? '')
  const [futureEnd, setFutureEnd] = useState(snapshot?.todayIso ?? '')
  const [replaceConflicts, setReplaceConflicts] = useState(true)
  const [manualEdits, setManualEdits] = useState<WorkflowDraftEdits | null>(null)
  const [customStart, setCustomStart] = useState(endDate)
  const [busy, setBusy] = useState(false)
  const [operation, setOperation] = useState<'generating' | 'applying'>('generating')
  const activeJob = useRef<string | null>(null)
  const [composerOpen, setComposerOpen] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [allocation, setAllocation] = useState<AdaptiveResult | null>(null)
  const [otherContext, setOtherContext] = useState<PlanSnapshot['workflow'] | null>(null)
  const hydrated = useRef<string | null>(null)
  const handledRequest = useRef<string | null>(null)
  const submitIncoming = useRef<((text: string) => void) | null>(null)
  const resumeActive = useRef<((id: string) => void) | null>(null)
  const resumed = useRef<string | null>(null)
  const context = key === snapshot?.weekKey ? snapshot?.workflow : otherContext
  const draftKey = `daily-plan-feedback:${key}:${endDate}`
  useEffect(() => {
    if (!context || !key || !resumeActive.current || busy) return
    let pending: string | null = null
    try { pending = localStorage.getItem(`daily-plan-job:${key}:${endDate}`) } catch { /* Optional. */ }
    pending ??= context.latestConversation?.status === 'running' ? context.latestConversation.id : null
    if (pending && resumed.current !== pending) { resumed.current = pending; resumeActive.current(pending) }
  }, [context, key, endDate, busy])
  useEffect(() => { onPlanningChange?.(mode === 'plan') }, [mode, onPlanningChange])
  useEffect(() => {
    setResult(null); setAllocation(null); setError(null); setOtherContext(null)
  }, [key, endDate])
  useEffect(() => {
    if (!key || key === snapshot?.weekKey) return
    let cancelled = false
    void runtime.call<PlanSnapshot['workflow']>('workflow.context', { weekKey: key }).then((value) => {
      if (!cancelled) setOtherContext(value)
    }).catch((failure) => { if (!cancelled) setError(String(failure)) })
    return () => { cancelled = true }
  }, [key, runtime, snapshot?.weekKey, snapshot?.nowIso])
  useEffect(() => {
    if (!context || !key || hydrated.current === draftKey) return
    hydrated.current = draftKey
    const last = unified ? context.latestConversation : context.latestRun
    let saved: string | null = null
    try { saved = localStorage.getItem(draftKey) } catch { /* Optional draft storage. */ }
    setText(saved ?? (last && last.status !== 'applied' ? last.rawText : ''))
    if (last && ['ready', 'applied'].includes(last.status) && (saved === null || saved === last.rawText)) {
      setMode(last.mode); setScope(last.mode === 'plan' ? 'future' : last.mode === 'weekly' ? 'week' : 'recent'); setComposerOpen(last.status === 'applied')
      if (last.mode === 'plan' && last.planStart && last.planEnd) { setFutureSpan('custom'); setFutureStart(last.planStart); setFutureEnd(last.planEnd) }
    }
    if (last?.status === 'failed') setError(last.error)
  }, [context, key, draftKey, unified])
  useEffect(() => {
    if (!composeRequest || handledRequest.current === composeRequest.id || !context || context.weekKey !== key || !submitIncoming.current || (composeRequest.date && composeRequest.date !== endDate)) return
    handledRequest.current = composeRequest.id
    setMode('review'); setScope('recent'); setSpan('2'); setText(composeRequest.text); setComposerOpen(true)
    try { localStorage.setItem(draftKey, composeRequest.text) } catch { /* Optional draft storage. */ }
    submitIncoming.current(composeRequest.text)
  }, [composeRequest, context, key, draftKey, endDate])
  if (!snapshot || !context || context.weekKey !== key) return <Card className="dp-workflow"><p className={error ? 'dp-error' : 'dp-muted'} role={error ? 'alert' : 'status'}>{error ?? '正在读取日程与记录…'}</p>{error && <button type="button" className="dp-btn dp-btn--sm" onClick={() => { void runtime.refresh() }}>重新读取</button>}</Card>
  const latest = result?.run ?? (unified ? context.latestConversation : context.latestRun)
  const reviewMode = mode === 'review'
  const tomorrow = isoDate(addDays(parseIsoDate(snapshot.todayIso), 1))
  const nextWeek = weekDates(isoWeekKey(addDays(parseIsoDate(weekDates(isoWeekKey(parseIsoDate(snapshot.todayIso)))[0]!), 7)))
  const planStart = futureSpan === 'tomorrow' ? tomorrow : futureSpan === 'nextWeek' ? nextWeek[0]! : futureSpan === 'custom' ? futureStart : snapshot.todayIso
  const planEnd = futureSpan === 'tomorrow' ? tomorrow : futureSpan === 'nextWeek' ? nextWeek[6]! : futureSpan === 'custom' ? futureEnd : isoDate(addDays(parseIsoDate(snapshot.todayIso), 13))
  const rangeEnd = mode === 'weekly' ? (weekDates(context.weekKey)[6]! < snapshot.todayIso ? weekDates(context.weekKey)[6]! : snapshot.todayIso) : endDate
  const rangeStart = mode === 'weekly' ? weekDates(context.weekKey)[0]! : span === 'custom' ? customStart : isoDate(addDays(parseIsoDate(rangeEnd), -(Number(span) - 1)))
  const runAction = async (action: () => Promise<void>, stage: 'generating' | 'applying' = 'applying'): Promise<void> => {
    setOperation(stage); setBusy(true); onBusyChange?.(true); setError(null)
    try { await action() }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false); onBusyChange?.(false); void runtime.refresh() }
  }
  const jobKey = `daily-plan-job:${key}:${endDate}`
  const recover = async (id: string): Promise<void> => {
    activeJob.current = id
    const deadline = Date.now() + 400_000
    while (Date.now() < deadline) {
      const status = await runtime.call<RunResult & { phase: string }>('workflow.status', { id })
      setResult(status); setAllocation(status.allocation)
      if (status.run.status === 'failed') throw new Error(status.run.error ?? 'AI 未完成，原文已保留。')
      if (status.run.status === 'applied' || (status.run.status === 'ready' && status.phase !== 'applying')) {
        if (status.run.error) setError(status.run.error)
        if (status.run.status === 'applied' && !unified) { setText(''); try { localStorage.removeItem(draftKey) } catch { /* Optional. */ } }
        activeJob.current = null
        try { localStorage.removeItem(jobKey) } catch { /* Optional. */ }
        return
      }
      setOperation(status.phase === 'applying' ? 'applying' : 'generating')
      await new Promise((resolve) => setTimeout(resolve, 1000))
    }
    throw new Error('处理时间较长，原文已保留。可以恢复安排查看结果。')
  }
  resumeActive.current = (id) => { void runAction(() => recover(id), 'generating') }
  const ask = (apply: boolean, incoming?: string): void => {
    const input = incoming ?? text
    const requestMode = incoming !== undefined ? 'review' : mode
    const requestScope = incoming !== undefined ? 'recent' : scope
    if (requestMode === 'plan' && (!planStart || !planEnd || planStart > planEnd)) { setError('请选好未来安排的起止日期。'); return }
    if (requestMode !== 'weekly' && input.trim() === '') { setError('说说做了什么、哪里有变化，或接下来想做什么。'); return }
    void runAction(async () => {
      const job = await runtime.call<{ id: string }>('workflow.start', { clientRequestId: crypto.randomUUID(), text: requestScope === 'training' ? `请重点分析训练表现、进步和恢复，并联动后续安排。用户原文：\n${input}` : requestScope === 'learning' ? `请重点分析学习进度和下一步，并联动后续安排。用户原文：\n${input}` : input, mode: requestMode, weekKey: requestMode === 'plan' ? isoWeekKey(parseIsoDate(planStart)) : key, apply, replaceConflicts,
        ...(requestMode === 'plan' ? { planStart, planEnd } : {}),
        ...(['review', 'weekly'].includes(requestMode) ? { rangeStart: incoming !== undefined ? isoDate(addDays(parseIsoDate(endDate), -1)) : rangeStart, rangeEnd: incoming !== undefined ? endDate : rangeEnd } : {}) })
      try { localStorage.setItem(jobKey, job.id) } catch { /* Optional. */ }
      await recover(job.id)
      setComposerOpen(true)
    }, 'generating')
  }
  submitIncoming.current = (input) => ask(true, input)
  const waiting = context.tasks.filter((task) => task.state !== 'scheduled')
  const unknown = context.recentDays.flatMap((day) => day.date < snapshot.todayIso ? day.blocks.filter((block) => flexibleBlock(block) && !block.done && block.executionStatus !== 'missed') : [])
  const savePlan = (): void => { if (!latest) return; void runAction(async () => {
    if (latest.status === 'applied') {
      if (!manualEdits) return
      const updated = await runtime.call<WorkflowRunRecord>('workflow.schedule.update', { id: latest.id, edits: manualEdits, expectedUpdatedAt: latest.updatedAt })
      setResult({ run: updated, allocation }); setManualEdits(null)
    } else {
      if (manualEdits) { const updated = await runtime.call<WorkflowRunRecord>('workflow.draft.update', { id: latest.id, edits: manualEdits, expectedUpdatedAt: latest.updatedAt }); setResult({ run: updated, allocation: null }); setManualEdits(null) }
      const next = await runtime.call<RunResult>('workflow.apply', { id: latest.id, replaceConflicts }); setResult(next); setAllocation(next.allocation)
      setComposerOpen(true)
      if (!unified) { setText(''); try { localStorage.removeItem(draftKey) } catch { /* Optional. */ } }
    }
  }) }
  return <Card className={`dp-workflow${journal ? ' dp-workflow--journal' : ''}${unified ? ' dp-workflow--workspace' : ''}${mobile ? ' dp-workflow--phone' : ''}`}>
    {!unified && !composerOpen && <div className="dp-review-source"><span>{text}</span><div><button type="button" onClick={() => { setComposerOpen(true); requestAnimationFrame(() => inputRef.current?.focus()) }}>{mode === 'plan' ? '补充安排' : '补充复盘'}</button><button type="button" onClick={() => { setText(''); setComposerOpen(true); requestAnimationFrame(() => inputRef.current?.focus()) }}>{mode === 'plan' ? '新安排' : '新复盘'}<Icon name="plus" size={12} /></button></div></div>}
    <div className="dp-coach-compose" hidden={!unified && !composerOpen}>
      <div className="dp-workflow-head"><span className="dp-agent-orb"><Icon name="sparkle" size={21} /></span><div><b>{journal ? '写下近况，其余交给 Agnes' : topic === 'training' ? 'Agnes · 训练教练' : 'Agnes · 帮你接着安排'}</b><span className="dp-coach-sub">{topic === 'training' ? '补记训练表现，回顾进步与恢复' : reviewMode ? '补记进展、更新任务池、记住偏好、调整日程' : '从目标到安排，留出生活的余地'}</span></div></div>
      {mobile ? <div className="phone-coach-controls"><div className="phone-coach-tabs" role="group" aria-label="复盘或安排"><button aria-pressed={mode!=='plan'} disabled={busy} onClick={()=>{setScope('recent');setMode('review');setSpan('2')}}>复盘近况</button><button aria-pressed={mode==='plan'} disabled={busy} onClick={()=>{setScope('future');setMode('plan')}}>安排接下来</button></div>{mode!=='plan'&&<div className="phone-coach-scope"><select aria-label="复盘类型" disabled={busy} value={scope==='future' ? 'recent' : scope} onChange={event=>{const value=event.target.value;setScope(value);setMode(value==='week'?'weekly':'review');setSpan(value==='daily'?'1':'2')}}><option value="daily">当天</option><option value="recent">近几天</option><option value="week">整周</option><option value="training">训练</option><option value="learning">学习</option></select><label>截至<input type="date" aria-label="复盘截止日期" value={endDate} max={snapshot.todayIso} disabled={busy} onChange={event=>{if(event.target.value)onReportEndChange?.(event.target.value)}} /></label></div>}</div> : unified ? <div className="dp-coach-modes" role="group" aria-label="复盘与展望">{([['daily', '当天'], ['recent', '近几天'], ['week', '整周'], ['training', '训练'], ['learning', '学习'], ['future', '展望']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={scope === value} disabled={busy} onClick={() => { setScope(value); setMode(value === 'future' ? 'plan' : value === 'week' ? 'weekly' : 'review'); setSpan(value === 'daily' ? '1' : '2') }}>{label}</button>)}</div> : <div className="dp-coach-modes" role="group" aria-label="教练模式">{([['review', '复盘近况'], ['plan', '安排目标'], ['replan', '临时变化'], ['weekly', '周回顾']] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={mode === value} disabled={busy} onClick={() => setMode(value)}>{label}</button>)}</div>}

      {context.focus && <div className="dp-workflow-focus"><Icon name="target" size={15} /><span>本周重点：{context.focus}</span></div>}
      {reviewMode && !mobile && <details className="dp-range-options"><summary>{rangeStart.slice(5)} — {rangeEnd.slice(5)}<span>更改范围<Icon name="chevronDown" size={12} /></span></summary><div className="dp-review-range"><select aria-label="复盘区间" disabled={busy} value={span} onChange={(event) => { setSpan(event.target.value); if (unified && ['daily', 'recent'].includes(scope)) setScope(event.target.value === '1' ? 'daily' : 'recent') }}>
        <option value="1">当天</option><option value="2">近两天</option><option value="7">近一周</option><option value="custom">自选日期</option>
      </select>{span === 'custom' && <input type="date" aria-label="复盘起始日期" value={customStart} min={isoDate(addDays(parseIsoDate(rangeEnd), -30))} max={rangeEnd} disabled={busy} onChange={(event) => setCustomStart(event.target.value)} />}</div></details>}
      {mode === 'weekly' && <div className="dp-review-range">{rangeStart.slice(5)} — {rangeEnd.slice(5)} · 已确认完成 {context.completion.done} 项 · 待补记 {context.completion.unknown} 项</div>}
      {mode === 'plan' && <div className="dp-future-range">
        <select aria-label="展望范围" value={futureSpan} disabled={busy} onChange={(event) => setFutureSpan(event.target.value)}><option value="auto">接下来两周</option><option value="tomorrow">明天</option><option value="nextWeek">下周</option><option value="custom">指定日期</option></select>
        {futureSpan === 'custom' ? <><input type="date" aria-label="展望起始日期" value={futureStart} min={snapshot.todayIso} max={isoDate(addDays(parseIsoDate(snapshot.todayIso), 30))} disabled={busy} onChange={(event) => { setFutureStart(event.target.value); if (event.target.value > futureEnd) setFutureEnd(event.target.value) }} /><span>至</span><input type="date" aria-label="展望结束日期" value={futureEnd} min={futureStart || snapshot.todayIso} max={isoDate(addDays(parseIsoDate(snapshot.todayIso), 30))} disabled={busy} onChange={(event) => setFutureEnd(event.target.value)} /></> : <span>{planStart.slice(5)} — {planEnd.slice(5)}</span>}
      </div>}
      <div className="dp-composer">
        {mobile&&<label className="phone-composer-label" htmlFor="phone-agnes-input">{mode==='plan'?'接下来想做什么？':'说说这段时间的近况'}</label>}
        <textarea id={mobile?'phone-agnes-input':undefined} ref={inputRef} aria-label="描述目标、偏好或临时变化" rows={unified ? 5 : compact ? 4 : 5} maxLength={30000} disabled={busy} value={text} onChange={(event) => {
          setText(event.target.value); try { localStorage.setItem(draftKey, event.target.value) } catch { /* Optional. */ }
        }} placeholder={mode === 'plan' ? '接下来有什么安排？自然地说就好。\n比如：明天六点左右和朋友吃饭，晚上可能喝点酒；下周完成论文修改。' : (topic === 'training' || scope === 'training') && reviewMode ? '训练怎么样？哪些组忘了记录？\n\n比如：昨天卧推40kg，3组，每组10次，还能做2次。今天肩部有些疲劳，帮我回顾进步、调整下一次训练。' : scope === 'learning' ? '读到了哪里？做了多少题？说说成果、卡点与下一步。' : reviewMode ? '做了什么？接下来有什么变化或目标？\n\n比如：论文初稿写完了，昨天卧推40kg，3组，每组10次。今天聚餐，英语没做；以后上午学英语更合适。' : mode === 'weekly' ? '这一周哪些安排适合你？哪些需要改变？\n也可以直接回顾已有记录。' : '想做什么？什么时候截止？\n说说目标、时间和偏好，Agnes 帮你维护任务池。'} />
        <div className="dp-composer-foot"><span><Icon name="review" size={13} />{mode === 'plan' ? '活动进日程，目标进任务池' : '不需要逐项打勾'}</span><small>{text.length > 0 ? `${text.length} 字` : '自然地说就好'}</small></div>
      </div>
      {!unified && <div className="dp-coach-actions"><button type="button" className="dp-btn dp-btn--primary" disabled={busy} onClick={() => ask(true)}><Icon name={busy ? 'refresh' : 'sparkle'} size={16} />{busy ? 'Agnes 正在整理…' : mode === 'plan' ? '让 Agnes 安排接下来' : reviewMode ? '复盘并安排' : mode === 'weekly' ? '回顾并调整' : '理解并安排'}</button><button type="button" className="dp-btn" disabled={busy} onClick={() => ask(false)}>{mode === 'plan' ? '先看安排' : '先看调整'}</button></div>}
      <label className="dp-coach-note dp-replace-option"><input type="checkbox" checked={replaceConflicts} disabled={busy} onChange={(event) => setReplaceConflicts(event.target.checked)} />以这次描述为准，移开冲突的旧安排</label>
      {!unified && <p className="dp-coach-note">自然地说，Agnes 帮你安排；时间和描述都能直接修改。</p>}
      {!unified && context.memories.length > 0 && <details className="dp-coach-context dp-known-memory"><summary>Agnes 已记住 {context.memories.length} 条习惯</summary>{context.memories.slice(0, 4).map((memory) => <p key={memory.id}>{memory.text}</p>)}<small>习惯变了也可以直接说，完整记忆可在设置中编辑。</small></details>}
      {!unified && error && <div className="dp-error" role="alert">{error}</div>}
    </div>
    {unified ? <>
      <AgentPlanPanel run={latest ?? null} mobile={mobile} busy={busy} operation={operation} dirty={!!manualEdits} allocation={allocation} context={context} runtime={runtime} onChange={setManualEdits} onNavigate={onNavigate} />
      <footer className="dp-agent-workspace-footer">
        <div className="dp-agent-workspace-status" role={error ? 'alert' : 'status'} title={error ?? ''}>{error ?? (manualEdits ? '改好后保存即可，不需要再问 AI。' : '直接说，或在上方改时间和描述。')}
          {busy && operation === 'generating' && <button type="button" onClick={() => { if (activeJob.current) void runtime.call('workflow.cancel', { id: activeJob.current }) }}>停止整理</button>}
          {!busy && <button type="button" onClick={() => { let id = activeJob.current ?? latest?.id; try { id = localStorage.getItem(jobKey) ?? id } catch { /* Optional. */ } if (id) void runAction(() => recover(id!), 'generating') }}>恢复安排</button>}
        </div>
        {mobile ? <div className="phone-coach-actions"><button className="phone-coach-secondary" disabled={busy||!text.trim()} onClick={()=>ask(false)}>{latest?.status==='ready'?'重新理解':'先看安排'}</button><button className="dp-btn dp-btn--primary" disabled={busy||(!text.trim()&&mode!=='weekly'&&!(latest?.status==='applied'&&manualEdits))} onClick={()=>latest?.status==='ready'||(latest?.status==='applied'&&manualEdits)?savePlan():ask(true)}><Icon name={busy?'refresh':latest?.status==='ready'?'check':'sparkle'} size={18}/>{busy?operation==='applying'?'正在应用…':'正在整理…':latest?.status==='ready'?'应用安排':latest?.status==='applied'&&manualEdits?'保存修改':'整理并安排'}</button></div> : <div className="dp-agent-workspace-actions">
          <button type="button" className="dp-btn dp-btn--primary" disabled={busy || (!text.trim() && mode !== 'weekly')} onClick={() => ask(true)}><Icon name={busy ? 'refresh' : 'sparkle'} size={15} />整理并安排</button>
          <button type="button" className="dp-btn" disabled={busy || (!text.trim() && mode !== 'weekly')} onClick={() => ask(false)}>先看安排</button>
          <button type="button" className="dp-btn" disabled={busy || !(latest?.status === 'ready' || (latest?.status === 'applied' && manualEdits))} onClick={savePlan}><Icon name="check" size={14} />{latest?.status === 'applied' ? '保存修改' : '应用安排'}</button>
        </div>}
      </footer>
    </> : <div className="dp-coach-output" aria-live="polite" aria-busy={busy} hidden={busy || (composerOpen)}>
      {!composerOpen && error && <div className="dp-error" role="alert">{error}</div>}
      <>
      <div className="dp-section-head"><div><span className="dp-eyebrow">AGNES / 联动反馈</span><h3>{busy ? '正在理解你的近况' : latest?.draft ? latest.status === 'applied' ? '你的计划已更新' : '这次准备这样调整' : '每一次复盘，都让安排更懂你'}</h3></div>{latest?.draft && <span className="dp-tag">{latest.status === 'applied' ? '已应用' : '待应用'}</span>}</div>
      {latest?.draft ? <div className="dp-workflow-result">
        <div className="dp-feedback-stamp">{latest.mode === 'plan' && latest.planStart && latest.planEnd ? `${latest.planStart} — ${latest.planEnd}` : latest.rangeStart && latest.rangeEnd ? `${latest.rangeStart} — ${latest.rangeEnd}` : latest.date} · {latest.status === 'applied' ? '上次联动结果' : '建议预览'}</div>
        <p className="dp-agent-summary">{latest.draft.summary}</p>
        <div className="dp-agent-receipt"><span>{latest.status === 'applied' ? `已落实 ${latest.appliedChanges?.length ?? 0} 项变更` : '预览 · 等待应用'}</span>{allocation && <><span>安排 {allocation.scheduled.length} 项</span><span>待安排 {allocation.waiting.length} 项</span></>}</div>
        {unified && latest.status === 'applied' && <div className="dp-change-list dp-change-preview">{(latest.appliedChanges ?? []).slice(0, 3).map((change, index) => <div key={index}><Icon name="check" size={13} /><span>{change}</span></div>)}</div>}
        {(latest.appliedChanges ?? []).length > 0 && <details className="dp-result-section" open={journal}><summary><Icon name="list" size={15} />全部 {latest.appliedChanges!.length} 项更新</summary><div className="dp-change-list">{latest.appliedChanges!.map((change, index) => <div key={index}><Icon name="check" size={13} /><span>{change}</span></div>)}</div></details>}
        {(latest.applyWarnings ?? []).map((warning, index) => <div className="dp-error" key={index}>{warning}</div>)}
        {latest.draft.gymAdvice.length > 0 && <details className="dp-result-section" open={journal}><summary><Icon name="gym" size={16} />训练分析与下次建议</summary>{latest.draft.gymAdvice.map((advice, index) => <p className="dp-muted" key={index}>{advice}</p>)}</details>}
        {latest.draft.memories.length > 0 && <details className="dp-result-section" open={journal}><summary><Icon name="database" size={16} />这次记住的偏好 · {latest.draft.memories.length}</summary>{latest.draft.memories.map((item, index) => <div className="dp-memory-item" key={index}><b>{item.text}</b><small>来自：{item.evidence}</small></div>)}</details>}
        {latest.draft.questions.length > 0 && <div className="dp-feedback-questions"><b><Icon name="warn" size={15} />还需要你补充</b>{latest.draft.questions.map((question, index) => <p key={index}>{question}</p>)}<small>在左侧或上方补充即可，其余明确的信息已照常处理。</small></div>}
        {latest.status === 'ready' && <div className="dp-draft-changes">
          <WorkflowDraftEditor run={latest} busy={busy || !!latest.factsApplied || !!latest.intentApplied} onChange={setManualEdits} />
          {latest.draft.taskActions.map((action, index) => <div key={index}>任务{action.action === 'cancel' ? '取消' : action.action === 'complete' ? '完成' : '更新'}：{context.tasks.find((task) => task.id === action.taskId)?.title} · {action.evidence}</div>)}
          {latest.draft.executions.length > 0 && <div>补记 {latest.draft.executions.length} 项执行结果</div>}
          {latest.draft.learningLogs.length > 0 && <div>同步 {latest.draft.learningLogs.length} 条学习记录</div>}
          {latest.draft.activityLogs.map((entry, index) => <div key={index}>{entry.date} · {entry.title}</div>)}
          {latest.draft.gymLogs.map((log) => <div key={log.date}>{log.date} 训练 · {log.exercises.reduce((sum, item) => sum + item.sets.length, 0)} 组实际数据</div>)}
          {latest.draft.unavailable.map((item, index) => <div key={index}>{item.date} 第 {item.startPeriod}–{item.endPeriod} 节：{item.reason}</div>)}
          <label className="dp-coach-note dp-replace-option"><input type="checkbox" checked={replaceConflicts} disabled={busy} onChange={(event) => setReplaceConflicts(event.target.checked)} />以这次描述为准，移开冲突的旧安排</label>
          <button type="button" className="dp-btn dp-btn--primary" disabled={busy} onClick={() => { void runAction(async () => {
            if (manualEdits) { const updated = await runtime.call<WorkflowRunRecord>('workflow.draft.update', { id: latest.id, edits: manualEdits, expectedUpdatedAt: latest.updatedAt }); setResult({ run: updated, allocation: null }); setManualEdits(null) }
            const next = await runtime.call<RunResult>('workflow.apply', { id: latest.id, replaceConflicts }); setResult(next); setAllocation(next.allocation)
            setText(''); setComposerOpen(true)
            try { localStorage.removeItem(draftKey) } catch { /* Optional. */ }
          }) }}>{manualEdits ? '应用微调后的安排' : '应用这份建议'}<Icon name="check" size={16} /></button>
        </div>}
        <div className="dp-result-links">{([['week', '后续安排', 'week'], ['learn', '学习进度', 'list'], ['record', '训练记录', 'gym'], ['setting', '个人记忆', 'database']] as const).map(([page, label, icon]) => <button type="button" key={page} onClick={() => { if (page === 'record') runtime.setRecordView('training'); runtime.setPage(page) }}><Icon name={icon} size={16} />{label}<Icon name="chevronRight" size={13} /></button>)}</div>
      </div> : <div className="dp-coach-steps">
        <div><span>01</span><div><b>补记真实进展</b><p>学习、训练、聚餐，一段文字一起记录。</p></div></div>
        <div><span>02</span><div><b>记住你的习惯</b><p>从明确反馈中保留偏好，下次接着用。</p></div></div>
        <div><span>03</span><div><b>重新安排余下的时间</b><p>调整任务池和日程，为变化留出空档。</p></div></div>
      </div>}
      {allocation && allocation.waiting.length > 0 && <div className="dp-allocation" role="status"><Icon name="week" size={16} /><div>{allocation.waiting.map((task) => <p key={task.taskId}>{task.title}：{task.reason}</p>)}</div></div>}
      <details className="dp-coach-context"><summary>待安排 {waiting.length} 项 <span>· 待补记 {unknown.length} 项</span></summary>{waiting.map((task) => <p key={task.id}>{task.title}{task.dueDate ? ` · 截止 ${task.dueDate}` : ''}</p>)}<p>没打勾的事项不会直接算作失败，复盘时说明即可。</p><p>{context.signals.explanation}</p></details>
      <div className="dp-coach-footer"><span>机动空间 {Math.round(snapshot.settings.planning.bufferRatio * 100)}%</span><button type="button" disabled={busy} onClick={() => { void runAction(async () => { setAllocation(await runtime.call<AdaptiveResult>('workflow.replan', {})); setResult(null) }) }}><Icon name="reorder" size={13} />重排任务</button></div>
      </>
    </div>}
  </Card>
}
