import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addDays, dateRange, isoDate, isoWeekKey, parseIsoDate, todayIso, weekdayZh } from '../../clock.ts'
import { TrainingRecords } from '../ui/TrainingRecords.tsx'
import { buildWeekGrid, monthMarkers, type DayStat, type HeatLevel } from '../../stats.ts'
import { Icon } from '../icons.tsx'
import { Empty, PageShell, Stat, StatRow } from '../ui/kit.tsx'
import type { StatsDayPayload, StatsSummary } from '../wire.ts'
import type { PageProps } from './types.ts'

const WEEKDAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'] as const

function heatVar(level: HeatLevel): string {
  return level <= 0 ? 'var(--dp-heat-0)' : `var(--dp-heat-${String(level)})`
}

function heatShadow(level: HeatLevel): string | undefined {
  if (level === 0) return 'inset 0 0 0 1px var(--dp-heat-0-ring)'
  if (level === 4) return 'inset 0 0 0 1px var(--dp-heat-4-ring)'
  return undefined
}

function tooltipFor(t: PageProps['t'], stat: DayStat): string {
  const date = parseIsoDate(stat.date)
  const head = `${String(date.getMonth() + 1)}月${String(date.getDate())}日 周${weekdayZh(date)}`
  if (stat.planned === 0) return `${head} · ${t('record.legendNone')}`
  const parts = [head, t('record.doneOf', { done: stat.done, total: stat.planned })]
  if ((stat.unknown ?? 0) > 0) parts.push(`${stat.unknown} 项待确认`)
  if (stat.gymDone) parts.push(t('record.trained'))
  parts.push(stat.hasReview ? t('record.reviewed') : t('record.notReviewed'))
  return parts.join(' · ')
}

export function RecordPage({ t, state, runtime }: PageProps): JSX.Element {
  const category = state.recordView
  const setCategory = (value: 'daily' | 'training'): void => runtime.setRecordView(value)
  const [view, setView] = useState<'year' | 'month'>(
    state.snapshot?.settings.record.defaultView ?? 'year',
  )
  const today = state.snapshot?.todayIso ?? todayIso()
  useEffect(() => { if (state.inspectDate === null) runtime.setInspectDate(today) }, [state.inspectDate, runtime, today])
  const [cursor, setCursor] = useState<string>(today.slice(0, 7))
  const [stats, setStats] = useState<DayStat[] | null>(null)
  const [summary, setSummary] = useState<StatsSummary | null>(null)
  const [detail, setDetail] = useState<StatsDayPayload | null>(null)
  const [tip, setTip] = useState<{ left: number; top: number; text: string } | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const scrollRef = useRef<HTMLDivElement | null>(null)

  // The month view needs the whole calendar block, leading/trailing days included.
  const range = useMemo(() => {
    if (view === 'year') {
      const todayDate = parseIsoDate(today)
      const weekday = ((todayDate.getDay() + 6) % 7) + 1
      const monday = addDays(todayDate, -(weekday - 1))
      return { from: isoDate(addDays(monday, -52 * 7)), to: today }
    }
    const first = parseIsoDate(`${cursor}-01`)
    const firstWeekday = ((first.getDay() + 6) % 7) + 1
    const gridStart = addDays(first, -(firstWeekday - 1))
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0)
    const lastWeekday = ((last.getDay() + 6) % 7) + 1
    return { from: isoDate(gridStart), to: isoDate(addDays(last, 7 - lastWeekday)) }
  }, [today, view, cursor])

  useEffect(() => {
    let cancelled = false
    void Promise.all([
      runtime.statsRange(range.from, range.to) as Promise<DayStat[]>,
      runtime.statsSummary(range.from, range.to) as Promise<StatsSummary>,
    ])
      .then(([rangeResult, summaryResult]) => {
        if (cancelled) return
        setStats(rangeResult)
        setSummary(summaryResult)
      })
      .catch(() => {
        if (!cancelled) setStats(null)
      })
    return () => {
      cancelled = true
    }
  }, [runtime, range.from, range.to, state.snapshot?.nowIso])

  // GitHub parks the graph at the right edge; so do we.
  useEffect(() => {
    const node = scrollRef.current
    if (node === null || stats === null || view !== 'year') return
    node.scrollLeft = node.scrollWidth
  }, [stats, view])

  const select = useCallback(
    (date: string) => {
      runtime.setInspectDate(date)
    },
    [runtime],
  )

  // One load trigger: the selection lives in the runtime.
  useEffect(() => {
    const date = state.inspectDate
    if (date === null) return
    let cancelled = false
    void (runtime.statsDay(date) as Promise<StatsDayPayload>)
      .then((payload) => {
        if (!cancelled) setDetail(payload)
      })
      .catch(() => {
        if (!cancelled) setDetail(null)
      })
    return () => {
      cancelled = true
    }
  }, [state.inspectDate, runtime, state.snapshot?.nowIso])

  const yearGrid = useMemo(() => (stats === null ? [] : buildWeekGrid(stats, 53)), [stats])
  const markers = useMemo(() => monthMarkers(yearGrid), [yearGrid])
  const monthWeeks = useMemo(() => {
    if (stats === null || view !== 'month') return []
    const byDate = new Map(stats.map((stat) => [stat.date, stat]))
    const days = dateRange(range.from, range.to)
    const weeks: DayStat[][] = []
    for (let index = 0; index < days.length; index += 7) {
      const row = days
        .slice(index, index + 7)
        .map((date) => byDate.get(date))
        .filter((stat): stat is DayStat => stat !== undefined)
      if (row.length === 7) weeks.push(row)
    }
    return weeks
  }, [stats, view, range.from, range.to])

  /**
   * The month view is the same grid as the year view, just five or six columns
   * instead of fifty-three — same cell size, same gap, same shading. Rendering
   * it as a calendar with day numbers made a month look sparse and gave it a
   * completely different visual language from the year.
   */
  const grid = view === 'year' ? yearGrid : monthWeeks
  /**
   * No month label in the month view. The first column is usually the tail of
   * the previous month, so labelling it announced "8月" above a grid titled
   * "2026 年 9 月" — and the navigation right above already says which month it is.
   */
  const gridMarkers = useMemo(() => (view === 'year' ? markers : []), [view, markers])

  const hasAnyPlan = stats?.some((stat) => stat.planned > 0) ?? false
  const cursorDate = parseIsoDate(`${cursor}-01`)

  const showTip = (stat: DayStat, element: HTMLElement): void => {
    const wrapper = wrapRef.current
    if (wrapper === null) return
    const cell = element.getBoundingClientRect()
    const box = wrapper.getBoundingClientRect()
    setTip({
      left: cell.left - box.left + cell.width / 2,
      top: cell.top - box.top - 8,
      text: tooltipFor(t, stat),
    })
  }

  const cellHandlers = (
    stat: DayStat,
  ): {
    onClick: () => void
    onMouseEnter: (event: React.MouseEvent<HTMLButtonElement>) => void
    onFocus: (event: React.FocusEvent<HTMLButtonElement>) => void
    onMouseLeave: () => void
    onBlur: () => void
  } => ({
    onClick: () => {
      select(stat.date)
    },
    onMouseEnter: (event) => {
      showTip(stat, event.currentTarget)
    },
    onFocus: (event) => {
      showTip(stat, event.currentTarget)
    },
    onMouseLeave: () => {
      setTip(null)
    },
    onBlur: () => {
      setTip(null)
    },
  })

  const shiftMonth = (delta: number): void => {
    const next = new Date(cursorDate.getFullYear(), cursorDate.getMonth() + delta, 1)
    setCursor(`${String(next.getFullYear())}-${String(next.getMonth() + 1).padStart(2, '0')}`)
  }

  return (
    <PageShell
      title="记录"
      sub={category === 'training' ? '训练进步与历史组数' : '点选日期，查看计划、学习与复盘'}
      actions={
        <>
          <button
            type="button"
            className={category === 'daily' && view === 'year' ? 'dp-btn dp-btn--sm dp-btn--primary' : 'dp-btn dp-btn--sm'}
            onClick={() => {
              setView('year'); setCategory('daily')
            }}
          >
            {t('record.year')}
          </button>
          <button
            type="button"
            className={category === 'daily' && view === 'month' ? 'dp-btn dp-btn--sm dp-btn--primary' : 'dp-btn dp-btn--sm'}
            onClick={() => {
              setView('month'); setCategory('daily')
            }}
          >
            {t('record.month')}
          </button>
          <button type="button" className={category === 'training' ? 'dp-btn dp-btn--sm dp-btn--primary' : 'dp-btn dp-btn--sm'} onClick={() => setCategory('training')}>训练记录</button>
        </>
      }
    >

      {category === 'training' ? <TrainingRecords state={state} runtime={runtime} /> : stats === null ? (
        <Empty title={t('common.loading')} />
      ) : (
        <>
          <p className="dp-record-summary">
            {t('record.summary', {
              done: summary?.totalDone ?? 0,
              perfect: summary?.perfectDays ?? 0,
            })}
          </p>

          <StatRow>
            <Stat
              label={t('record.rate')}
              value={`${String(Math.round((summary?.monthRate ?? 0) * 100))}%`}
            />
            <Stat
              label={t('record.streak')}
              value={t('record.days', { count: summary?.currentStreak ?? 0 })}
              accent
            />
            <Stat label={t('record.longest')} value={t('record.days', { count: summary?.longestStreak ?? 0 })} />
            <Stat label={t('record.gymCount')} value={t('record.times', { count: summary?.gymSessions ?? 0 })} />
            <Stat label={t('record.reviewDays')} value={t('record.days', { count: summary?.reviewDays ?? 0 })} />
          </StatRow>

          {view === 'month' && (
            <div className="dp-month-nav">
              <button
                type="button"
                className="dp-btn dp-btn--sm dp-btn--icon"
                aria-label={t('record.prevMonth')}
                onClick={() => {
                  shiftMonth(-1)
                }}
              >
                <Icon name="chevronLeft" size={14} />
              </button>
              <b>
                {String(cursorDate.getFullYear())} 年 {String(cursorDate.getMonth() + 1)} 月
              </b>
              <button
                type="button"
                className="dp-btn dp-btn--sm dp-btn--icon"
                aria-label={t('record.nextMonth')}
                onClick={() => {
                  shiftMonth(1)
                }}
              >
                <Icon name="chevronRight" size={14} />
              </button>
              {cursor !== today.slice(0, 7) && (
                <button
                  type="button"
                  className="dp-btn dp-btn--sm dp-btn--ghost"
                  onClick={() => {
                    setCursor(today.slice(0, 7))
                  }}
                >
                  {t('record.thisMonth')}
                </button>
              )}
            </div>
          )}

          <div className="dp-heat-wrap" data-view={view} ref={wrapRef}>
            <div className={view === 'year' ? 'dp-heat-scroll dp-scroll' : 'dp-heat-plain'} ref={scrollRef}>
              <div className="dp-heat-inner">
                <div
                  className="dp-heat-months"
                  style={{
                    gridTemplateColumns: `repeat(${String(grid.length)}, var(--dp-heat-size))`,
                  }}
                >
                  {gridMarkers.map((marker) => (
                    <span
                      key={`${marker.label}-${String(marker.column)}`}
                      style={{ gridColumn: marker.column + 1 }}
                    >
                      {marker.label}
                    </span>
                  ))}
                </div>
                <div className="dp-heat-body">
                  <div className="dp-heat-days">
                    {[0, 2, 4].map((row) => (
                      <span key={row} style={{ gridRow: row + 1 }}>
                        {WEEKDAY_SHORT[row]}
                      </span>
                    ))}
                  </div>
                  <div
                    className="dp-heat-grid"
                    role="grid"
                    aria-label={view === 'year' ? t('record.year') : t('record.month')}
                  >
                    {grid.flatMap((column, columnIndex) =>
                      column.map((stat, row) => (
                        <button
                          key={stat.date}
                          type="button"
                          className="dp-heat-cell"
                          data-outside={
                            view === 'month' && stat.date.slice(0, 7) !== cursor ? 'true' : undefined
                          }
                          data-today={stat.date === today ? 'true' : undefined}
                          data-selected={stat.date === state.inspectDate ? 'true' : undefined}
                          style={{
                            gridColumn: columnIndex + 1,
                            gridRow: row + 1,
                            background: heatVar(stat.level),
                            boxShadow: heatShadow(stat.level),
                          }}
                          aria-label={tooltipFor(t, stat)}
                          {...cellHandlers(stat)}
                        />
                      )),
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="dp-heat-legend">
              <span>{t('record.less')}</span>
              {([0, 1, 2, 3, 4] as HeatLevel[]).map((level) => (
                <span
                  key={level}
                  className="dp-heat-swatch"
                  style={{ background: heatVar(level), boxShadow: heatShadow(level) }}
                />
              ))}
              <span>{t('record.more')}</span>
            </div>
            {tip !== null && (
              <div className="dp-heat-tip" style={{ left: tip.left, top: tip.top }} role="tooltip">
                {tip.text}
              </div>
            )}
          </div>

          <div className="dp-legend">
            {(
              [
                ['legendPerfect', 4],
                ['legendMost', 3],
                ['legendHalf', 2],
                ['legendFew', 1],
                ['legendZero', 0],
              ] as const
            ).map(([key, level]) => (
              <span key={key} className="dp-legend-item">
                <span
                  className="dp-heat-swatch"
                  style={{
                    background: heatVar(level as HeatLevel),
                    boxShadow: heatShadow(level as HeatLevel),
                  }}
                />
                {t(`record.${key}`)}
              </span>
            ))}
          </div>

          {!hasAnyPlan && (
            <div className="dp-alert" style={{ marginTop: 14 }}>
              {t('record.noDataYet')}
            </div>
          )}

          <section className="dp-record-inspector dp-card"><div className="dp-section-head"><div><span className="dp-eyebrow">DAILY JOURNAL / 每日记录</span><h3>{state.inspectDate ?? today}</h3></div><button className="dp-btn dp-btn--sm" type="button" onClick={() => { runtime.setReviewDate(state.inspectDate ?? today); runtime.setPage('review') }}>查看复盘原文<Icon name="chevronRight" size={13} /></button></div>
          <div className="dp-subhead">
            <span>{state.inspectDate ?? today}</span>
            <span className="dp-faint">{t('record.clickHint')}</span>
          </div>
          {detail === null ? (
            <div className="dp-faint">{t('record.clickCell')}</div>
          ) : (
            <div className="dp-split">
              <div className="dp-tl">
                {detail.plan.blocks.length === 0 && <div className="dp-faint">{t('record.noPlan')}</div>}
                {[...detail.plan.blocks]
                  .sort((left, right) => left.startPeriod - right.startPeriod)
                  .map((block) => (
                    <div key={block.id} className="dp-row">
                      <span className="dp-row-time">{`${String(block.startPeriod)}-${String(block.endPeriod)}`}</span>
                      <div
                        className={`dp-block${block.done ? ' is-done' : ''}${block.locked ? ' is-locked' : ''}`}
                        data-cat={block.category}
                        data-color={block.colorKey === '' ? undefined : block.colorKey}
                      >
                        <span className="dp-block-title">{block.title}</span>
                        <span className="dp-spacer" />
                        <span className="dp-block-meta">{t(`common.category.${block.category}`)}</span>
                      </div>
                    </div>
                  ))}
              </div>
              <div className="dp-side">
                <div className="dp-card">
                  <span className="dp-label">{t('review.todayCard')}</span>
                  <div className="dp-muted" style={{ lineHeight: 1.9 }}>
                    {t('review.planLine', { done: detail.stat.done, total: detail.stat.planned })}
                    <br />
                    {t('review.gymLine', {
                      logged: detail.sessionProgress.logged,
                      total: detail.sessionProgress.total,
                    })}
                  </div>
                </div>
                {detail.review?.structured != null ? (
                  <div className="dp-card">
                    <span className="dp-label">{t('review.result')}</span>
                    <div style={{ lineHeight: 1.7 }}>{detail.review.structured.summary}</div>
                    {detail.review.structured.energy !== null && (
                      <div className="dp-muted" style={{ marginTop: 6 }}>
                        {t('review.energy')} {String(detail.review.structured.energy)}/5
                        {detail.review.structured.mood === null
                          ? ''
                          : ` · ${t('review.mood')} ${String(detail.review.structured.mood)}/5`}
                      </div>
                    )}
                    <button
                      type="button"
                      className="dp-btn dp-btn--sm"
                      style={{ marginTop: 8 }}
                      onClick={() => {
                        runtime.setReviewDate(detail.date)
                        runtime.setPage('review')
                      }}
                    >
                      {t('record.openInReview')}
                      <Icon name="chevronRight" size={13} />
                    </button>
                  </div>
                ) : (
                  <div className="dp-card">
                    <div className="dp-faint">{t('record.noReview')}</div>
                  </div>
                )}
              </div>
            </div>
          )}
          </section>
        </>
      )}
    </PageShell>
  )
}
