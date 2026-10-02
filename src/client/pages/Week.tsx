import { calendarLabel } from '../../calendar.ts'
import { useCallback, useEffect, useState } from 'react'
import { formatHm, parseIsoDate, isoWeekKey, shiftWeekKey, todayIso, weekDates } from '../../clock.ts'
import type { PlanBlockRecord } from '../../domain.ts'
import { PICK_COLORS } from '../../palette.ts'
import { snapToGap } from '../../plan.ts'
import { DEFAULT_PERIODS } from '../../seed.ts'
import {
  GripIcon,
  draggedRecently,
  startDrag,
  useDragState,
  useDropHandler,
  type DragPayload,
} from '../drag/DragLayer.tsx'
import { Icon } from '../icons.tsx'
import { Empty, PageShell } from '../ui/kit.tsx'
import type { GymDaySummary, PlanSnapshot } from '../wire.ts'
import type { PageProps } from './types.ts'
import { activeBlock } from '../../adaptive.ts'

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'] as const
const PERIOD_OPTIONS = [1, 2, 3, 4, 5, 6] as const

interface ZoneMeta {
  readonly weekday: number
  readonly period: number
}

function zoneMeta(value: unknown): ZoneMeta | null {
  if (typeof value !== 'object' || value === null) return null
  const source = value as Record<string, unknown>
  const weekday = Number(source['weekday'])
  const period = Number(source['period'])
  if (!Number.isFinite(weekday) || !Number.isFinite(period)) return null
  return { weekday, period }
}

export function WeekPage({ t, state, runtime }: PageProps): JSX.Element {
  const drag = useDragState()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [estimating, setEstimating] = useState<number>(2)
  const [colorKey, setColorKey] = useState<string>('')
  /** Click/keyboard placement mode: the payload is armed, waiting for a cell. */
  const [pending, setPending] = useState<DragPayload | null>(null)
  const [pendingZone, setPendingZone] = useState<ZoneMeta | null>(null)
  const snapshot: PlanSnapshot | null = state.snapshot

  const place = useCallback(
    (payload: DragPayload, weekday: number, period: number) => {
      if (snapshot === null) return
      const dates = weekDates(snapshot.weekKey)
      const date = dates[weekday - 1]
      if (date === undefined) return
      const rawDay = snapshot.week.find((item) => item.date === date)
      const day = rawDay ? { ...rawDay, blocks: rawDay.blocks.filter(activeBlock) } : undefined
      const dayEnd = snapshot.settings.dayEndPeriod

      if (payload.kind === 'backlog') {
        const gap = snapToGap(day?.blocks ?? [], period, payload.estimatePeriods, dayEnd)
        if (gap === null) {
          runtime.notify(t('week.noRoom'))
          return
        }
        void runtime.upsertBlock(date, {
          title: payload.title,
          category: payload.category,
          startPeriod: gap.startPeriod,
          endPeriod: gap.endPeriod,
          source: 'backlog',
          backlogId: payload.id,
        })
        const compressed = gap.endPeriod - gap.startPeriod + 1 < payload.estimatePeriods
        runtime.notify(
          `${WEEKDAY_LABELS[weekday - 1] ?? ''} 第 ${String(gap.startPeriod)}-${String(gap.endPeriod)} 节` +
            (compressed ? ` · ${t('week.compressed')}` : ''),
        )
        return
      }

      if (payload.kind === 'block') {
        const others = (day?.blocks ?? []).filter((block) => block.id !== payload.blockId)
        const gap = snapToGap(others, period, payload.length, dayEnd)
        if (gap === null) {
          runtime.notify(t('week.noRoom'))
          return
        }
        void runtime.moveBlock(payload.date, payload.blockId, date, gap.startPeriod, gap.endPeriod)
        runtime.notify(
          `${WEEKDAY_LABELS[weekday - 1] ?? ''} 第 ${String(gap.startPeriod)}-${String(gap.endPeriod)} 节`,
        )
      }
    },
    [snapshot, runtime, t],
  )

  useDropHandler(
    useCallback(
      (payload: DragPayload, meta: unknown) => {
        const zone = zoneMeta(meta)
        if (zone === null) return
        place(payload, zone.weekday, zone.period)
      },
      [place],
    ),
  )

  // Esc leaves placement mode, same as it cancels a drag.
  useEffect(() => {
    if (pending === null) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setPending(null)
      setPendingZone(null)
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [pending])

  if (snapshot === null) {
    return (
      <PageShell title={t('nav.week')}>
        <Empty title={t('common.loading')} />
      </PageShell>
    )
  }

  const dates = weekDates(snapshot.weekKey)
  const dayEnd = Math.max(1, snapshot.settings.dayEndPeriod)
  /** So a gym block can say what is in it without seven extra fetches. */
  const gymByDate = new Map((snapshot.gymWeek ?? []).map((entry) => [entry.date, entry]))

  const periods = Array.from({ length: dayEnd }, (_, index) => index + 1)
  const periodTable = snapshot.settings.periods.length > 0 ? snapshot.settings.periods : DEFAULT_PERIODS
  const today = snapshot.todayIso

  // One preview pipeline for both input paths.
  const activePayload = pending ?? drag.payload
  const activeZone = pending !== null ? pendingZone : zoneMeta(drag.zoneMeta)
  let preview: { weekday: number; startPeriod: number; endPeriod: number } | null = null
  if (activePayload !== null && activeZone !== null) {
    const date = dates[activeZone.weekday - 1]
    const day = snapshot.week.find((item) => item.date === date)
    const draggedId = activePayload.kind === 'block' ? activePayload.blockId : null
    const want =
      activePayload.kind === 'backlog'
        ? activePayload.estimatePeriods
        : activePayload.kind === 'block'
          ? activePayload.length
          : 1
    const gap = snapToGap((day?.blocks ?? []).filter((block) => activeBlock(block) && block.id !== draggedId), activeZone.period, want, dayEnd)
    if (gap !== null) preview = { weekday: activeZone.weekday, ...gap }
  }

  const isPreview = (weekday: number, period: number): boolean =>
    preview !== null && preview.weekday === weekday && period >= preview.startPeriod && period <= preview.endPeriod

  const addBacklog = (): void => {
    const title = draft.trim()
    if (title === '') {
      setAdding(false)
      return
    }
    void runtime.saveBacklog({ title, category: 'study', estimatePeriods: estimating, colorKey })
    setDraft('')
    setColorKey('')
    setAdding(false)
  }

  const armPayload = (payload: DragPayload): void => {
    if (draggedRecently()) return
    setPending(payload)
    setPendingZone(null)
    runtime.notify(t('week.pickCell'))
  }

  return (
    <PageShell
      title={`${t('nav.week')} · ${snapshot.weekKey.replace('-W', ' 第 ')} 周`}
      sub={`${dates[0] ?? ''} — ${dates[6] ?? ''}`}
      actions={
        <>
          
          <button
            type="button"
            className="dp-btn dp-btn--sm"
            aria-label={t('week.prev')}
            onClick={() => {
              void runtime.setWeek(shiftWeekKey(snapshot.weekKey, -1))
            }}
          >
            <Icon name="chevronLeft" size={14} />
          </button>
          <button
            type="button"
            className="dp-btn dp-btn--sm"
            onClick={() => {
              void runtime.setWeek(isoWeekKey(parseIsoDate(snapshot.todayIso)))
            }}
          >
            {t('shell.today')}
          </button>
          <button
            type="button"
            className="dp-btn dp-btn--sm"
            aria-label={t('week.next')}
            onClick={() => {
              void runtime.setWeek(shiftWeekKey(snapshot.weekKey, 1))
            }}
          >
            <Icon name="chevronRight" size={14} />
          </button>
          <details className="dp-page-menu"><summary>课表<Icon name="chevronDown" size={12} /></summary><div><button
            type="button"
            className="dp-btn dp-btn--sm"
            title={t('week.generateTip')}
            onClick={(event) => {
              event.currentTarget.closest('details')?.removeAttribute('open')
              void runtime.generateWeek(snapshot.weekKey)
            }}
          >
            <Icon name="sparkle" size={14} />
            {t('week.generate')}
          </button>
          <button
            type="button"
            className="dp-btn dp-btn--sm"
            title={t('week.generateTermTip')}
            onClick={(event) => {
              event.currentTarget.closest('details')?.removeAttribute('open')
              void runtime.generateTerm()
            }}
          >
            <Icon name="sparkle" size={14} />
            {t('week.generateTerm')}
          </button></div></details>
        </>
      }
    >
      
      {pending !== null && (
        <div className="dp-armed" role="status">
          <GripIcon />
          <span>
            {pending.kind === 'backlog' || pending.kind === 'block' ? pending.title : ''}
            {' · '}
            {t('week.pickCell')}
          </span>
          <span className="dp-spacer" />
          <button
            type="button"
            className="dp-btn dp-btn--sm"
            onClick={() => {
              setPending(null)
              setPendingZone(null)
            }}
          >
            {t('common.cancel')}
          </button>
        </div>
      )}

      <div className="dp-week">
        <aside className="dp-pool dp-scroll" data-drag-scroll>
          <div className="dp-pool-head">
            {t('week.pool')}
            <span className="dp-muted">{String(snapshot.backlog.length)}</span>
          </div>
          {snapshot.backlog.length === 0 && <div className="dp-faint">{t('week.poolEmpty')}</div>}
          {snapshot.backlog.map((item) => {
            const payload: DragPayload = {
              kind: 'backlog',
              id: item.id,
              title: item.title,
              category: item.category,
              estimatePeriods: item.estimatePeriods,
            }
            return (
              <button
                key={item.id}
                type="button"
                className="dp-pool-card"
                data-cat={item.category}
                data-color={item.colorKey === '' ? undefined : item.colorKey}
                onPointerDown={(event) => {
                  startDrag(event, payload)
                }}
                onClick={() => {
                  armPayload(payload)
                }}
              >
                <span className="dp-pool-grip">
                  <GripIcon />
                </span>
                <span className="dp-pool-body">
                  <span className="dp-pool-title">{item.title}</span>
                  <span className="dp-pool-meta">
                    {t(`common.category.${item.category}`)} · {String(item.estimatePeriods)} 节
                    {item.dueDate === null || item.dueDate === '' ? '' : ` · ${item.dueDate.slice(5)}`}
                  </span>
                </span>
                <span
                  className="dp-pool-del"
                  role="button"
                  tabIndex={0}
                  aria-label={t('common.delete')}
                  onPointerDown={(event) => {
                    event.stopPropagation()
                  }}
                  onClick={(event) => {
                    event.stopPropagation()
                    void runtime.removeBacklog(item.id)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      event.stopPropagation()
                      void runtime.removeBacklog(item.id)
                    }
                  }}
                >
                  <Icon name="close" size={12} />
                </span>
              </button>
            )
          })}
          {adding ? (
            <div className="dp-pool-new">
              <input
                autoFocus
                value={draft}
                placeholder={t('week.newBacklogTitle')}
                onChange={(event) => {
                  setDraft(event.target.value)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addBacklog()
                  if (event.key === 'Escape') setAdding(false)
                }}
              />
              <div className="dp-pool-row">
                <span className="dp-faint">{t('week.color')}</span>
                <span className="dp-swatches">
                  {PICK_COLORS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      className="dp-swatch"
                      data-color={key}
                      data-on={colorKey === key ? 'true' : undefined}
                      aria-label={t(`color.${key}`)}
                      aria-pressed={colorKey === key}
                      onClick={() => {
                        setColorKey(colorKey === key ? '' : key)
                      }}
                    />
                  ))}
                </span>
              </div>
              <div className="dp-pool-row">
                <span className="dp-faint">{t('week.estimate')}</span>
                <select
                  value={String(estimating)}
                  onChange={(event) => {
                    setEstimating(Number(event.target.value))
                  }}
                >
                  {PERIOD_OPTIONS.map((value) => (
                    <option key={value} value={String(value)}>
                      {String(value)} 节
                    </option>
                  ))}
                </select>
                <button type="button" className="dp-btn dp-btn--sm dp-btn--primary" onClick={addBacklog}>
                  {t('common.save')}
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="dp-addrow" onClick={() => setAdding(true)}>
              {t('week.newBacklog')}
            </button>
          )}

        </aside>

        <div className="dp-grid-scroll dp-scroll" data-drag-scroll>
          <div className="dp-grid-head">
            <span className="dp-grid-corner" />
            {WEEKDAY_LABELS.map((label, index) => {
              const date = dates[index] ?? ''
              return (
                <span key={label} className={date === today ? 'dp-grid-day is-today' : 'dp-grid-day'}>
                  {label}
                  <small>{date.slice(5)}{calendarLabel(date, snapshot.settings.courseCalendar) && <em className="dp-holiday">{calendarLabel(date, snapshot.settings.courseCalendar)}</em>}</small>
                </span>
              )
            })}
          </div>
          <div className="dp-grid" style={{ gridTemplateRows: `repeat(${periods.length}, minmax(0, 1fr))` }} role="grid" aria-label={t('nav.week')}>
            {periods.map((period) => (
              (() => {
                const slot = periodTable.find((item) => item.index === period)
                const minutes = slot === undefined ? 0 : slot.endMinute - slot.startMinute
                return (
                  <span
                    key={`p${String(period)}`}
                    className="dp-grid-period"
                    style={{ gridColumn: 1, gridRow: period }}
                    title={
                      slot === undefined
                        ? undefined
                        : `第 ${String(period)} 节 ${formatHm(slot.startMinute)}–${formatHm(slot.endMinute)}（${String(minutes)} 分钟）`
                    }
                  >
                    <b>{period}</b>
                    {slot !== undefined && (
                      <em>
                        {formatHm(slot.startMinute)}–{formatHm(slot.endMinute)}
                      </em>
                    )}
                    {slot !== undefined && minutes !== 45 && <small>{String(minutes)}'</small>}
                  </span>
                )
              })()
            ))}
            {periods.map((period) =>
              WEEKDAY_LABELS.map((_, index) => {
                const weekday = index + 1
                const date = dates[index] ?? ''
                return (
                  <button
                    key={`c${String(weekday)}-${String(period)}`}
                    type="button"
                    className="dp-cell"
                    data-cell={`${String(weekday)}-${String(period)}`}
                    data-drop={`c:${String(weekday)}:${String(period)}`}
                    data-drop-accept="backlog,block"
                    data-drop-meta={JSON.stringify({ weekday, period })}
                    data-drop-hint={drag.hint ?? ''}
                    data-preview={isPreview(weekday, period) ? 'true' : undefined}
                    data-weekend={weekday >= 6 ? 'true' : undefined}
                    data-armed={pending !== null ? 'true' : undefined}
                    /* Only reachable by keyboard while a payload is armed. */
                    tabIndex={pending === null ? -1 : 0}
                    aria-label={`${WEEKDAY_LABELS[index] ?? ''} 第 ${String(period)} 节`}
                    style={{ gridColumn: weekday + 1, gridRow: period }}
                    onMouseEnter={() => {
                      if (pending !== null) setPendingZone({ weekday, period })
                    }}
                    onClick={() => {
                      if (pending === null) return
                      place(pending, weekday, period)
                      setPending(null)
                      setPendingZone(null)
                    }}
                    onKeyDown={(event) => {
                      if (pending === null) return
                      const step: Record<string, [number, number]> = {
                        ArrowLeft: [-1, 0],
                        ArrowRight: [1, 0],
                        ArrowUp: [0, -1],
                        ArrowDown: [0, 1],
                      }
                      const delta = step[event.key]
                      if (delta === undefined) return
                      event.preventDefault()
                      const nextWeekday = Math.min(7, Math.max(1, weekday + delta[0]))
                      const nextPeriod = Math.min(dayEnd, Math.max(1, period + delta[1]))
                      setPendingZone({ weekday: nextWeekday, period: nextPeriod })
                      document
                        .querySelector<HTMLElement>(`[data-cell="${String(nextWeekday)}-${String(nextPeriod)}"]`)
                        ?.focus()
                    }}
                  />
                )
              }),
            )}
            {snapshot.week.flatMap((day) => {
              const weekday = dates.indexOf(day.date) + 1
              if (weekday === 0) return []
              return day.blocks.filter(activeBlock).map((block) => (
                <GridBlock
                  key={block.id}
                  t={t}
                  block={block}
                  weekday={weekday}
                  gym={gymByDate.get(day.date)}
                  onOpenGym={
                    block.category === 'gym'
                      ? () => {
                          runtime.setGymDate(block.gymDate ?? day.date)
                          runtime.setPage('gym')
                        }
                      : null
                  }
                  onToggle={() => {
                    void runtime.toggleBlock(day.date, block.id, !block.done)
                  }}
                  onDelete={() => {
                    void runtime.removeBlock(day.date, block.id)
                  }}
                  onDragStart={(event) => {
                    startDrag(event, {
                      kind: 'block',
                      date: day.date,
                      blockId: block.id,
                      title: block.title,
                      category: block.category,
                      length: block.endPeriod - block.startPeriod + 1,
                    })
                  }}
                />
              ))
            })}
          </div>
          <p className="dp-faint" style={{ marginTop: 8 }}>
            {t('week.hint')}
          </p>
        </div>
      </div>
    </PageShell>
  )
}

function GridBlock({
  t,
  block,
  weekday,
  gym,
  onToggle,
  onDelete,
  onOpenGym,
  onDragStart,
}: {
  readonly t: PageProps['t']
  readonly block: PlanBlockRecord
  readonly weekday: number
  /** What is in this day's training, when the block is a gym one. */
  readonly gym: GymDaySummary | undefined
  readonly onToggle: () => void
  readonly onDelete: () => void
  readonly onOpenGym: (() => void) | null
  readonly onDragStart: (event: React.PointerEvent) => void
}): JSX.Element {
  const span = block.endPeriod - block.startPeriod + 1
  const classes = ['dp-gblock']
  if (block.locked) classes.push('is-locked')
  if (block.done) classes.push('is-done')
  if (block.source === 'carry') classes.push('is-carry')
  return (
    <div
      className={classes.join(' ')}
      data-cat={block.category}
      data-adaptive={block.adaptive ? 'true' : undefined}
      data-color={block.colorKey === '' ? undefined : block.colorKey}
      data-drop={`b:${String(weekday)}:${String(block.startPeriod)}`}
      data-drop-accept="backlog,block"
      data-drop-meta={JSON.stringify({ weekday, period: block.startPeriod })}
      style={{
        gridColumn: weekday + 1,
        gridRow: `${String(block.startPeriod)} / ${String(block.endPeriod + 1)}`,
      }}
      title={
        block.locked ? t('week.lockedTip') : `${formatHm(block.startMinute)}–${formatHm(block.endMinute)}${block.adaptive ? ' · Agnes 安排，可调整' : ' · 手动安排，保持位置'}`
      }
      onPointerDown={block.locked ? undefined : onDragStart}
    >
      <button
        type="button"
        className="dp-gblock-body"
        aria-pressed={block.done}
        aria-label={`${t(`common.category.${block.category}`)}：${block.title}`}
        onClick={() => {
          if (draggedRecently()) return
          onToggle()
        }}
      >
        <span className="dp-gblock-title">{block.title}</span>
        {block.category === 'gym' && gym !== undefined && gym.actions > 0 && (
          <span className="dp-gblock-gym">
            {t('week.gymLoad', { actions: String(gym.actions), sets: String(gym.sets) })}
          </span>
        )}
        {block.note !== '' && <span className="dp-gblock-note">{block.note}</span>}
      </button>
      {onOpenGym !== null && (
        <button
          type="button"
          className="dp-gblock-open"
          aria-label={t('week.openGym')}
          title={t('week.openGym')}
          onPointerDown={(event) => {
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.stopPropagation()
            onOpenGym()
          }}
        >
          <Icon name="gym" size={11} />
        </button>
      )}
      {!block.locked && (
        <button
          type="button"
          className="dp-gblock-del"
          aria-label={t('common.delete')}
          onPointerDown={(event) => {
            event.stopPropagation()
          }}
          onClick={(event) => {
            event.stopPropagation()
            onDelete()
          }}
        >
          <Icon name="close" size={11} />
        </button>
      )}
    </div>
  )
}
