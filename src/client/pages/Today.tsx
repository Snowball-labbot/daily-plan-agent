import { useState } from 'react'
import { formatHm, isoWeekKey, parseIsoDate, weekdayZh } from '../../clock.ts'
import { activeBlock } from '../../adaptive.ts'
import { Icon } from '../icons.tsx'
import { Empty, PageShell } from '../ui/kit.tsx'
import type { PageProps } from './types.ts'
import { AgentActivity } from '../ui/AgentActivity.tsx'

export function TodayPage({ t, state, runtime, onTellAgnes }: PageProps): JSX.Element {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [feedback, setFeedback] = useState('')
  const snapshot = state.snapshot
  if (!snapshot) return <PageShell title={t('nav.today')}><Empty title={t('common.loading')} /></PageShell>
  const { today, todayIso, backlog } = snapshot
  const blocks = today.blocks.filter(activeBlock).slice().sort((a, b) => a.startMinute - b.startMinute)
  const done = blocks.filter((block) => block.done).length
  const next = blocks.find((block) => !block.done && block.endMinute > snapshot.currentMinute)
  const due = backlog.filter((item) => item.dueDate === todayIso)
  const date = parseIsoDate(todayIso)
  const currentWeek = isoWeekKey(date)
  const submit = (): void => {
    if (draft.trim()) void runtime.saveBacklog({ title: draft.trim(), category: 'study', estimatePeriods: 1, notBefore: todayIso })
    setDraft(''); setAdding(false)
  }
  return <PageShell title={`${date.getMonth() + 1}月${date.getDate()}日`} sub={`星期${weekdayZh(date)} · ${done}/${blocks.length} 已完成`} actions={<button className="dp-btn dp-btn--ghost" type="button" onClick={() => { void runtime.setWeek(currentWeek); runtime.setPage('week') }}>本周安排<Icon name="chevronRight" size={14} /></button>}>
    <div className="dp-dashboard">
      <section className="dp-agenda dp-card">
        {due.length > 0 && <div className="dp-due-notice"><Icon name="bell" size={16} /><span>今天截止：{due.map((item) => item.title).join('、')}</span></div>}
        {blocks.length === 0 && <Empty title={t('today.empty')} hint="先定一件重点，其余留有余地。" action={<button className="dp-btn" type="button" onClick={() => runtime.setPage('week')}>{t('today.gotoWeek')}</button>} />}
        <div className="dp-tl">{blocks.map((block) => <div className={`dp-block dp-agenda-row${next?.id === block.id ? ' is-next' : ''}${block.done ? ' is-done' : ''}`} key={block.id} data-cat={block.category} data-color={block.colorKey || undefined}>
          <div className="dp-agenda-time"><b>{formatHm(block.startMinute)}</b><small>{formatHm(block.endMinute)}</small></div>
          <button type="button" className={`dp-check${block.done ? ' is-on' : ''}`} aria-label={`${block.done ? t('today.done') : t('today.pending')}：${block.title}`} aria-pressed={block.done} onClick={() => { void runtime.toggleBlock(todayIso, block.id, !block.done) }}>{block.done && <Icon name="check" size={13} />}</button>
          <div className="dp-agenda-copy"><b>{block.title}</b>{block.note && <p>{block.note}</p>}</div>
          {block.adaptive && <span className="dp-agent-source" title="这项任务由 Agnes 分配到可用时段"><Icon name="sparkle" size={12} />Agnes</span>}
          {block.category === 'gym' ? <button className="dp-btn dp-btn--ghost dp-btn--sm" type="button" onClick={() => { runtime.setGymDate(block.gymDate ?? todayIso); runtime.setPage('gym') }}>训练<Icon name="chevronRight" size={14} /></button> : <span className="dp-category" data-cat={block.category}>{t(`common.category.${block.category}`)}</span>}
        </div>)}</div>
        {adding ? <input className="dp-agenda-add" autoFocus aria-label="新增今日任务" value={draft} placeholder="想做什么？先放进任务池" onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit(); if (event.key === 'Escape') setAdding(false) }} onBlur={submit} /> : <button type="button" className="dp-addrow dp-agenda-add" onClick={() => setAdding(true)}><Icon name="plus" size={16} />加入一件事</button>}
      </section>
      <form className="dp-agent-inline" onSubmit={(event) => { event.preventDefault(); if (feedback.trim()) { onTellAgnes?.(feedback); setFeedback('') } }}>
        <Icon name="sparkle" size={18} />
        <textarea aria-label="告诉 Agnes 近况或调整" rows={2} value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder={'完成了什么，或接下来有什么变化？\n直接告诉 Agnes，补记并调整安排。'} onKeyDown={(event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} />
        <button type="submit" className="dp-btn dp-btn--primary" disabled={!feedback.trim()}>整理并安排<Icon name="chevronRight" size={14} /></button>
      </form>
      <AgentActivity state={state} onTellAgnes={onTellAgnes} />
    </div>
  </PageShell>
}
