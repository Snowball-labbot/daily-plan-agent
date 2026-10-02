import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { addDays, isoDate, parseIsoDate, todayIso, weekdayZh } from '../../clock.ts'
import type { BodyPartValue, ExerciseRecord, GymItemRecord, GymSessionRecord } from '../../domain.ts'
import { GripIcon, draggedRecently, startDrag, useDragState, useDropHandler, type DragPayload } from '../drag/DragLayer.tsx'
import { NewExerciseForm } from './ExerciseForm.tsx'
import { Icon } from '../icons.tsx'
import { Card, Dots, Empty, PageShell } from '../ui/kit.tsx'
import { loggedSets, gymSetFromFields } from '../../gym.ts'
import type { PageProps } from './types.ts'

const PARTS: readonly BodyPartValue[] = ['chest', 'back', 'legs', 'shoulders', 'core', 'cardio']

export function GymPage({ t, state, runtime }: PageProps): JSX.Element {
  const drag = useDragState()
  const snapshot = state.snapshot
  const [part, setPart] = useState<BodyPartValue | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [feeling, setFeeling] = useState<number | null>(null)
  /**
   * The library is fetched on its own rather than read off the snapshot: it is
   * the whole content of this page, so a stale or failed snapshot must not be
   * able to render it as "empty" with no explanation.
   */
  const [exercises, setExercises] = useState<ExerciseRecord[] | null>(null)
  const [libraryError, setLibraryError] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)

  const loadLibrary = useCallback(async (): Promise<void> => {
    try {
      const list = await runtime.gymExercises()
      setExercises(list)
      setLibraryError(null)
    } catch (error) {
      setExercises([])
      setLibraryError(error instanceof Error ? error.message : String(error))
    }
  }, [runtime])

  useEffect(() => {
    void loadLibrary()
  }, [loadLibrary])

  /**
   * The day being edited. Training gets planned ahead of the week, so the page
   * has to be able to look at any date — reading today's session off the
   * snapshot meant the only way to plan Tuesday was to wait for Tuesday.
   */
  const day = state.gymDate ?? snapshot?.todayIso ?? todayIso()
  const [session, setSession] = useState<GymSessionRecord | null>(null)
  const rowPositions = useRef(new Map<string, number>())
  const sessionElement = useRef<HTMLDivElement | null>(null)
  useLayoutEffect(() => {
    const rows = sessionElement.current?.querySelectorAll<HTMLElement>('[data-gym-item]') ?? []
    const next = new Map<string, number>()
    for (const row of rows) {
      const id = row.dataset.gymItem!, top = row.offsetTop
      const before = rowPositions.current.get(id)
      if (before !== undefined && before !== top && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        row.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'translateY(0)' }], { duration: 220, easing: 'ease-out' })
      }
      next.set(id, top)
    }
    rowPositions.current = next
  }, [session?.items, day])
  const sessionRequest = useRef(0)
  const suggested = snapshot?.gymFocus.focus[0] ?? null
  useEffect(() => { setPart(null); setFeeling(null); setFinishing(false) }, [day])

  const loadSession = useCallback(async (): Promise<void> => {
    const request = ++sessionRequest.current
    try {
      const next = await runtime.gymSession(day)
      if (request === sessionRequest.current) setSession(next)
    } catch {
      // Leave the previous view rather than blanking the panel on a hiccup.
    }
  }, [runtime, day])

  // `nowIso` changes on every snapshot reload, which every mutation triggers —
  // so this keeps the session in step without threading a reload through each
  // of the eight call sites below.
  useEffect(() => {
    void loadSession()
  }, [loadSession, snapshot?.nowIso])


  useEffect(() => {
    if (part !== null || session?.date !== day) return
    const initial = session?.focus[0] ?? session?.items[0]?.part ?? suggested
    if (initial !== null && initial !== undefined) setPart(initial)
  }, [part, session, suggested, day])

  const date = day

  const commitOrder = useCallback(
    (orderedIds: string[]) => {
      void runtime.reorderGymItems(date, orderedIds)
    },
    [date, runtime],
  )

  const dropHandler = useCallback(
    (payload: DragPayload, meta: unknown) => {
      const raw = Number((meta as { index?: number } | null)?.index ?? Number.NaN)
      if (!Number.isFinite(raw)) return
      // -1 is the panel-level sentinel: "wherever you dropped inside me, append".
      const index = raw < 0 ? (session?.items.length ?? 0) : raw
      if (payload.kind === 'gym-exercise') {
        void runtime.addGymItem(date, payload.exerciseId, index)
        runtime.notify(t('gym.added'))
        return
      }
      if (payload.kind === 'gym-reorder' && session !== null) {
        const ids = session.items.map((item) => item.id)
        const from = ids.indexOf(payload.itemId)
        if (from < 0) return
        const next = ids.filter((id) => id !== payload.itemId)
        next.splice(index > from ? index - 1 : index, 0, payload.itemId)
        commitOrder(next)
      }
    },
    [date, runtime, session, t, commitOrder],
  )

  useDropHandler(dropHandler)

  // `session` is fetched per day now, so null means "that day hasn't loaded yet"
  // rather than "unreachable" — same guard, different reason.
  if (snapshot === null || session === null || session.date !== day) {
    return (
      <PageShell title={t('nav.gym')}>
        <Empty title={t('common.loading')} />
      </PageShell>
    )
  }

  const rotation = snapshot.settings.gymRotation
  const library = (exercises ?? []).filter((exercise) => part === null || exercise.part === part)
  const logged = loggedSets(session.items)
  const total = session.items.reduce((sum, item) => sum + item.sets, 0)
  const draggingExercise = drag.payload?.kind === 'gym-exercise' || drag.payload?.kind === 'gym-reorder'
  const activeSlot = drag.zoneId?.startsWith('g:') === true ? Number(drag.zoneId.slice(2)) : null

  return (
    <PageShell
      title={`${t('nav.gym')} · ${String(parseIsoDate(day).getMonth() + 1)}月${String(parseIsoDate(day).getDate())}日 周${weekdayZh(parseIsoDate(day))}`}
      sub={`${session.items.length > 0 ? [...new Set(session.items.map((item) => t(`common.part.${item.part}`)))].join(' / ') : part === null ? t('gym.noPart') : t('gym.suggest', { part: t(`common.part.${part}`) })} · ${session.items.length} 个动作 · ${logged}/${total} 组${session.finishedAt !== null ? ' · 已结束' : ''}`}
      actions={
        <>
          
          {/* Plan the week, not just today: step to any date and edit it. */}
          <span className="dp-daynav">
            <button
              type="button"
              className="dp-btn dp-btn--sm dp-btn--icon"
              aria-label={t('gym.prevDay')}
              onClick={() => {
                runtime.setGymDate(isoDate(addDays(parseIsoDate(day), -1)))
              }}
            >
              <Icon name="chevronLeft" size={14} />
            </button>
            <button
              type="button"
              className="dp-btn dp-btn--sm"
              disabled={day === snapshot.todayIso}
              onClick={() => {
                runtime.setGymDate(null)
              }}
            >
              {day === snapshot.todayIso ? t('gym.isToday') : t('gym.backToToday')}
            </button>
            <button
              type="button"
              className="dp-btn dp-btn--sm dp-btn--icon"
              aria-label={t('gym.nextDay')}
              onClick={() => {
                runtime.setGymDate(isoDate(addDays(parseIsoDate(day), 1)))
              }}
            >
              <Icon name="chevronRight" size={14} />
            </button>
          </span>
          <button
            type="button"
            className="dp-btn dp-btn--sm"
            onClick={() => {
              if (part === null) return
              void runtime.setGymFocus(date, [part], true)
            }}
          >
            <Icon name="refresh" size={14} />
            {t('gym.switch')}
          </button>
          <button
            type="button"
            className="dp-btn dp-btn--sm"
            onClick={() => {
              void runtime.applyLastGym(date, part)
            }}
          >
            {t('gym.applyLast')}
          </button>
          <button
            type="button"
            className="dp-btn dp-btn--sm dp-btn--primary"
            disabled={session.items.length === 0}
            onClick={() => {
              setFinishing(true)
            }}
          >
            {t('gym.finish')}
          </button>
          <button
            type="button"
            className="dp-btn dp-btn--sm"
            title={t('gym.planTip')}
            disabled={session.items.length === 0}
            onClick={() => {
              void runtime.queueGymSession(date)
            }}
          >
            <Icon name="week" size={14} />
            {t('gym.plan')}
          </button>
        </>
      }
    >

      {finishing && (
        <div className="dp-card" style={{ marginBottom: 14, display: 'flex', alignItems: 'center', gap: 14 }}>
          <span>{t('gym.feeling')}</span>
          <Dots
            total={5}
            filled={feeling ?? 0}
            label={t('gym.feeling')}
            onPick={(value) => {
              setFeeling(value)
            }}
          />
          <span className="dp-spacer" />
          <button
            type="button"
            className="dp-btn dp-btn--sm"
            onClick={() => {
              setFinishing(false)
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="dp-btn dp-btn--sm dp-btn--primary"
            onClick={() => {
              void runtime.finishGym(date, feeling)
              setFinishing(false)
              runtime.notify(t('gym.finished'))
            }}
          >
            {t('common.confirm')}
          </button>
        </div>
      )}

      <div className="dp-gym">
        <aside className="dp-gym-lib dp-scroll" data-drag-scroll>
          <div className="dp-parts" role="tablist" aria-label={t('gym.parts')}>
            {PARTS.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={part === key}
                className="dp-chip dp-chip--solid"
                data-on={part === key ? 'true' : undefined}
                onClick={() => {
                  setPart(key)
                }}
                onDoubleClick={() => {
                  void runtime.setGymFocus(date, [key])
                }}
              >
                {t(`common.part.${key}`)}
              </button>
            ))}
          </div>
          <div className="dp-pool-head">
            {t('gym.library')}
            <span className="dp-muted">{exercises === null ? '…' : String(library.length)}</span>
            {rotation.length > 0 && (
              <span className="dp-faint">
                · {rotation.map((p) => t(`common.part.${p}`)).join(' ')}
              </span>
            )}
          </div>
          {libraryError !== null && (
            <div className="dp-error" role="alert">
              {t('gym.libraryError')}: {libraryError}
            </div>
          )}
          {exercises !== null && exercises.length === 0 && libraryError === null && (
            <button
              type="button"
              className="dp-btn dp-btn--sm"
              disabled={seeding}
              onClick={() => {
                setSeeding(true)
                void runtime
                  .seedExercises()
                  .then(() => loadLibrary())
                  .catch((error: unknown) => {
                    setLibraryError(error instanceof Error ? error.message : String(error))
                  })
                  .finally(() => {
                    setSeeding(false)
                  })
              }}
            >
              {seeding ? t('gym.seeding') : t('gym.seedHint')}
            </button>
          )}
          {library.map((exercise) => (
            <LibraryCard
              key={exercise.id}
              exercise={exercise}
              onDragStart={(event) => {
                startDrag(event, {
                  kind: 'gym-exercise',
                  exerciseId: exercise.id,
                  name: exercise.name,
                  part: exercise.part,
                })
              }}
              onAppend={() => {
                void runtime.addGymItem(date, exercise.id)
                runtime.notify(`${exercise.name} · ${t('gym.added')}`)
              }}
            />
          ))}
          <NewExerciseForm
            t={t}
            state={state}
            runtime={runtime}
            onCreated={() => {
              void loadLibrary()
            }}
          />
        </aside>

        {/* The panel itself accepts a drop (append), so the whole dashed box is
            a valid target instead of only the thin insert lines between rows. */}
        <div
          className="dp-gym-session dp-scroll" ref={sessionElement} data-dragging={draggingExercise ? 'true' : undefined}
          data-drag-scroll
          data-drop="g:end"
          data-drop-accept="gym-exercise,gym-reorder"
          data-drop-meta='{"index":-1}'
        >
          <div className="dp-pool-head">
            {t('gym.today')}
            <span className="dp-muted">
              {String(session.items.length)} {t('gym.exercises')} · {String(logged)}/{String(total)}{' '}
              {t('gym.sets')}
            </span>
          </div>
          {session.items.length === 0 && (
            <Empty
              hint={t('gym.empty')}
              action={
                <button
                  type="button"
                  className="dp-btn dp-btn--sm"
                  onClick={() => {
                    void runtime.applyLastGym(date, part)
                  }}
                >
                  {t('gym.applyLast')}
                </button>
              }
            />
          )}
          {session.items.map((item, index) => (
            <div className="dp-exercise-card" data-gym-item={item.id} key={item.id}>
              <SlotLine
                index={index}
                active={activeSlot === index && draggingExercise}
                label={t('gym.dropHere')}
              />
              <SessionRow
                date={date} runtime={runtime} canLog={date <= snapshot.todayIso}
                t={t}
                item={item}
                index={index}
                onDragStart={(event) => {
                  startDrag(event, {
                    kind: 'gym-reorder',
                    date,
                    itemId: item.id,
                    name: item.name,
                  })
                }}
                onPatch={(patch) => {
                  void runtime.updateGymItem(date, item.id, patch)
                }}
                onRemove={() => {
                  void runtime.removeGymItem(date, item.id)
                }}
              />
            </div>
          ))}
          <SlotLine
            index={session.items.length}
            active={activeSlot === session.items.length && draggingExercise}
            label={t('gym.dropHere')}
          />
          {session.items.length > 0 && <p className="dp-faint" style={{ marginTop: 8 }}>拖入动作，点数字修改；做完一组点「+ 组」，也可以告诉 Agnes 一次补记。进步在「记录 → 训练记录」里查看。</p>}
          
        </div>

      </div>
    </PageShell>
  )
}

function SlotLine({
  index,
  active,
  label,
}: {
  readonly index: number
  readonly active: boolean
  readonly label: string
}): JSX.Element {
  return (
    <div
      className="dp-gym-slot"
      data-drop={`g:${String(index)}`}
      data-drop-accept="gym-exercise,gym-reorder"
      data-drop-meta={JSON.stringify({ index })}
      data-preview={active ? 'true' : undefined}
    >
      {active && <span className="dp-gym-slot-label">{label}</span>}
    </div>
  )
}

function LibraryCard({
  exercise,
  onDragStart,
  onAppend,
}: {
  readonly exercise: ExerciseRecord
  readonly onDragStart: (event: React.PointerEvent) => void
  readonly onAppend: () => void
}): JSX.Element {
  return (
    <button
      type="button"
      className="dp-pool-card"
      data-cat="gym"
      onPointerDown={onDragStart}
      onClick={() => {
        // A drop must not also append — the drag already placed it.
        if (draggedRecently()) return
        onAppend()
      }}
    >
      <span className="dp-pool-grip">
        <GripIcon />
      </span>
      <span className="dp-pool-body">
        <span className="dp-pool-title">{exercise.name}</span>
        <span className="dp-pool-meta">
          {exercise.equipment === '' ? '' : `${exercise.equipment} · `}
          {String(exercise.defaultSets)}×{exercise.defaultReps}
        </span>
      </span>
    </button>
  )
}

function SessionRow({
  date, runtime, canLog, index,
  t,
  item,
  onDragStart,
  onPatch,
  onRemove,
}: {
  readonly t: PageProps['t']
  readonly item: GymItemRecord
  readonly date: string; readonly runtime: PageProps['runtime']; readonly canLog: boolean; readonly index: number;
  readonly onDragStart: (event: React.PointerEvent) => void
  readonly onPatch: (patch: Partial<GymItemRecord>) => void
  readonly onRemove: () => void
}): JSX.Element {
  const [fields, setFields] = useState({ reps: item.reps, weight: item.weight })
  const [saving, setSaving] = useState(false)
  const requestId = useRef<string | null>(null)
  useEffect(() => { setFields({ reps: item.reps, weight: item.weight }) }, [item.reps, item.weight])
  const record = async (): Promise<void> => {
    const set = gymSetFromFields(fields.reps, fields.weight)
    if (!set) { runtime.notify('先在这一行填实际次数（如 10）和重量（如 40kg），再记一组。'); return }
    setSaving(true); requestId.current ??= `set:${crypto.randomUUID()}`
    try {
      await runtime.call('gym.set.log', { date, itemId: item.id, requestId: requestId.current, set })
      await runtime.refresh(); requestId.current = null
    } catch (failure) { runtime.notify(String(failure)) }
    finally { setSaving(false) }
  }
  return (
    <div className="dp-gym-row" data-drop={`g:row:${index}`} data-drop-row={index} data-drop-accept="gym-exercise,gym-reorder" data-drop-meta={JSON.stringify({ index })}>
      <span className="dp-gym-grip" onPointerDown={onDragStart} role="button" tabIndex={0} aria-label={t('gym.reorder')}>
        <GripIcon />
      </span>
      <span className="dp-gym-name">{item.name}</span>
      <InlineNumber
        value={item.sets}
        label={t('gym.sets')}
        onCommit={(value) => {
          onPatch({ sets: value })
        }}
      />
      <span className="dp-gym-x">×</span>
      <InlineText
        value={fields.reps}
        label={t('gym.reps')}
        width={52}
        onCommit={(value) => {
          setFields((before) => ({ ...before, reps: value })); requestId.current = null
          onPatch({ reps: value })
        }}
      />
      <InlineText
        value={fields.weight}
        label={t('gym.weight')}
        width={54}
        onCommit={(value) => {
          setFields((before) => ({ ...before, weight: value })); requestId.current = null
          onPatch({ weight: value })
        }}
      />
      <span className="dp-spacer" />
      <Dots
        total={item.sets}
        filled={item.doneSets}
        label={`${item.name} ${t('gym.sets')}`}
        onPick={(value) => {
          onPatch({ doneSets: value })
        }}
      />
      {canLog && <button type="button" className="dp-inline dp-log-set" disabled={saving} title="按本行填写的重量与次数，记录实际完成的一组" aria-label={`记录${item.name}这一组`} onClick={() => { void record() }}>{saving ? '保存…' : '+ 组'}</button>}
      <button type="button" className="dp-gym-del" aria-label={t('common.delete')} onClick={onRemove}>
        <Icon name="trash" size={13} />
      </button>
    </div>
  )
}

function InlineNumber({
  value,
  label,
  onCommit,
}: {
  readonly value: number
  readonly label: string
  readonly onCommit: (value: number) => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(value))
  useEffect(() => {
    setDraft(String(value))
  }, [value])
  if (!editing) {
    return (
      <button
        type="button"
        className="dp-inline"
        aria-label={label}
        onClick={() => {
          setEditing(true)
        }}
      >
        {String(value)}
      </button>
    )
  }
  const commit = (): void => {
    const parsed = Math.round(Number(draft))
    setEditing(false)
    if (Number.isFinite(parsed) && parsed >= 1 && parsed <= 30) onCommit(parsed)
    else setDraft(String(value))
  }
  return (
    <input
      autoFocus
      className="dp-inline-input"
      style={{ width: 40 }}
      value={draft}
      inputMode="numeric"
      onChange={(event) => {
        setDraft(event.target.value)
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
        if (event.key === 'Escape') {
          event.stopPropagation()
          setEditing(false)
          setDraft(String(value))
        }
      }}
    />
  )
}

function InlineText({
  value,
  label,
  width,
  onCommit,
}: {
  readonly value: string
  readonly label: string
  readonly width: number
  readonly onCommit: (value: string) => void
}): JSX.Element {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef<HTMLInputElement | null>(null)
  useEffect(() => {
    setDraft(value)
  }, [value])
  if (!editing) {
    return (
      <button
        type="button"
        className="dp-inline"
        style={{ minWidth: width }}
        aria-label={label}
        onClick={() => {
          setEditing(true)
        }}
      >
        {value === '' ? '—' : value}
      </button>
    )
  }
  const commit = (): void => {
    setEditing(false)
    onCommit(draft.trim())
  }
  return (
    <input
      ref={ref}
      autoFocus
      className="dp-inline-input"
      style={{ width }}
      value={draft}
      placeholder={label}
      onChange={(event) => {
        setDraft(event.target.value)
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
        if (event.key === 'Escape') {
          event.stopPropagation()
          setEditing(false)
          setDraft(value)
        }
      }}
    />
  )
}
