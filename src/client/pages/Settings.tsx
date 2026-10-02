import { CourseCalendarEditor } from '../ui/CourseCalendarEditor.tsx'
import { useRef, useState } from 'react'
import { formatHm, parseHm } from '../../clock.ts'
import type {
  BodyPartValue,
  CategoryValue,
  CourseRecord,
  PeriodRecord,
  RoutineRecord,
} from '../../domain.ts'
import { PICK_COLORS } from '../../palette.ts'
import { DEFAULT_PERIODS } from '../../seed.ts'
import { Icon } from '../icons.tsx'
import { Card, DraftInput, PageShell } from '../ui/kit.tsx'
import type { PlanSnapshot, RoutineDraft } from '../wire.ts'
import { CourseImport } from './CourseImport.tsx'
import { NewExerciseForm } from './ExerciseForm.tsx'
import type { PageProps } from './types.ts'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'] as const

/**
 * Ids only have to be unique inside the settings document — routines are array
 * elements, not storage keys, so the ASCII constraint does not apply here.
 */
function newIdSuffix(): string {
  const api = globalThis.crypto
  if (api !== undefined && typeof api.randomUUID === 'function') return api.randomUUID()
  return `${String(Date.now())}${String(Math.floor(Math.random() * 1_000_000))}`
}

/** A draft from Agnes becomes a real row with a fresh id and default styling. */
function withFreshId(draft: RoutineDraft): RoutineRecord {
  return {
    schemaVersion: 1,
    id: `rt_${newIdSuffix()}`,
    title: draft.title,
    category: draft.category,
    weekdays: [...draft.weekdays],
    startPeriod: draft.startPeriod,
    endPeriod: draft.endPeriod,
    colorKey: '',
    enabled: true,
  }
}
const ALL_PARTS: readonly BodyPartValue[] = ['chest', 'back', 'legs', 'shoulders', 'core', 'cardio']

function weeksToText(weeks: readonly number[]): string {
  if (weeks.length === 0) return ''
  const sorted = [...weeks].sort((left, right) => left - right)
  const parts: string[] = []
  let start = sorted[0] as number
  let previous = start
  for (const week of sorted.slice(1)) {
    if (week === previous + 1) {
      previous = week
      continue
    }
    parts.push(start === previous ? String(start) : `${String(start)}-${String(previous)}`)
    start = week
    previous = week
  }
  parts.push(start === previous ? String(start) : `${String(start)}-${String(previous)}`)
  return parts.join(',')
}

function parseWeeks(text: string): number[] {
  const out = new Set<number>()
  for (const chunk of text.split(/[,，、\s]+/u)) {
    if (chunk === '') continue
    const range = /^(\d{1,2})-(\d{1,2})$/u.exec(chunk)
    if (range !== null) {
      const from = Number(range[1])
      const to = Number(range[2])
      for (let week = Math.min(from, to); week <= Math.max(from, to); week += 1) {
        if (week >= 1 && week <= 60) out.add(week)
      }
      continue
    }
    const single = Number(chunk)
    if (Number.isFinite(single) && single >= 1 && single <= 60) out.add(single)
  }
  return [...out].sort((left, right) => left - right)
}

export function SettingsPage({ t, state, runtime }: PageProps): JSX.Element {
  const snapshot: PlanSnapshot | null = state.snapshot
  const [importing, setImporting] = useState(false)
  const [showLibrary, setShowLibrary] = useState(false)
  const [probing, setProbing] = useState(false)
  const [probeResult, setProbeResult] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [periodsDirty, setPeriodsDirty] = useState(false)
  const [routineText, setRoutineText] = useState('')
  /** null means "untouched — show what is stored". Any edit switches to the draft. */
  const [routineRows, setRoutineRows] = useState<RoutineRecord[] | null>(null)
  const [routineBusy, setRoutineBusy] = useState(false)
  const [routineError, setRoutineError] = useState<string | null>(null)

  if (snapshot === null) {
    return (
      <PageShell title={t('setting.title')}>
        <div className="dp-faint">{t('common.loading')}</div>
      </PageShell>
    )
  }

  const settings = snapshot.settings
  const periods: readonly PeriodRecord[] = settings.periods.length > 0 ? settings.periods : DEFAULT_PERIODS

  const patchSettings = (patch: Record<string, unknown>): void => {
    void runtime.updateSettings(patch)
  }

  const routineChanged = routineRows !== null

  const updateRoutine = (index: number, patch: Partial<RoutineRecord>): void => {
    setRoutineRows((current) =>
      (current ?? settings.routines).map((item, position) =>
        position === index ? { ...item, ...patch } : item,
      ),
    )
  }

  const exportAll = async (): Promise<void> => {
    try {
      const dump = await runtime.exportAll()
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `dsh-daily-plan-${snapshot.todayIso}.json`
      link.click()
      setTimeout(() => {
        URL.revokeObjectURL(url)
      }, 30_000)
      runtime.notify(t('setting.exported'))
    } catch (error) {
      runtime.notify(error instanceof Error ? error.message : String(error))
    }
  }

  const importFile = async (file: File): Promise<void> => {
    try {
      const payload = JSON.parse(await file.text()) as Record<string, unknown>
      await runtime.importAll(payload, 'merge')
      await runtime.refresh()
      runtime.notify(t('setting.imported', { count: 0 }))
    } catch (error) {
      runtime.notify(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <PageShell title="偏好设置" sub="偏好、弹性与个人记忆 · 随时调整">
      <div className="dp-settings-jump" role="group" aria-label="设置分区">
        {['个性化与弹性计划', '课表', '作息时间表', '固定安排', '健身'].map((title) => <button className="dp-chip" type="button" key={title} onClick={() => {
          const section = document.getElementById(`dp-setting-${title}`)
          const body = section?.closest('.dp-body')
          if (body && section) body.scrollTop += section.getBoundingClientRect().top - body.getBoundingClientRect().top - 20
        }}>{title}</button>)}
      </div>
      <div className="dp-settings">
        <Section title="个性化与弹性计划">
          <label className="dp-label" htmlFor="dp-personal-context">长期目标、偏好与生活约束</label>
          <DraftInput id="dp-personal-context" value={settings.personalContext} onCommit={(value) => patchSettings({ personalContext: value })} placeholder="例如：英语和论文优先，上午适合深度学习，周末希望留时间给家人。" />
          <div className="dp-btnrow">
            <label>每日弹性任务上限（分钟） <input type="number" min={30} max={600} value={settings.planning.dailyFocusMinutes} onChange={(event) => patchSettings({ planning: { dailyFocusMinutes: Number(event.target.value) } })} /></label>
            <label>机动比例 <input type="number" min={10} max={60} value={Math.round(settings.planning.bufferRatio * 100)} onChange={(event) => patchSettings({ planning: { bufferRatio: Number(event.target.value) / 100 } })} />%</label>
            <label>每日头等大事 <input type="number" min={1} max={8} value={settings.planning.maxDailyTasks} onChange={(event) => patchSettings({ planning: { maxDailyTasks: Number(event.target.value) } })} /></label>
            <label>每周训练目标 <input type="number" min={0} max={7} value={settings.planning.gymWeeklyGoal} onChange={(event) => patchSettings({ planning: { gymWeeklyGoal: Number(event.target.value) } })} />次</label>
          </div>
          <div className="dp-btnrow">
            <label><input type="checkbox" checked={settings.planning.autoPrepareToday} onChange={(event) => patchSettings({ planning: { autoPrepareToday: event.target.checked } })} />每天首次打开时准备今日计划</label>
            <label><input type="checkbox" checked={settings.planning.autoReplanAfterReview} onChange={(event) => patchSettings({ planning: { autoReplanAfterReview: event.target.checked } })} />归档复盘后调整剩余一周</label>
          </div>
          <p className="dp-faint">学习页设置周目标后，会根据实际进度提供推进时段；时间块完成不增加阅读或刷题数量。训练目标默认 0，按你的选择开启。</p>
          {snapshot.workflow.memories.map((memory) => <div key={memory.id} className="dp-btnrow">
            <div><b>{memory.text}</b><div className="dp-faint">{memory.date} · 依据：{memory.evidence}</div></div>
            <button type="button" className="dp-btn dp-btn--sm" onClick={() => { void runtime.call('workflow.memory.remove', { id: memory.id }).then(() => runtime.refresh()).catch((error) => runtime.notify(String(error))) }}>忘记</button>
          </div>)}
        </Section>
        <Section title="节假日与校历"><CourseCalendarEditor state={state} runtime={runtime} /></Section>
        {/* ── timetable ───────────────────────────────────────────────────── */}
        <Section title={t('setting.courses')} count={snapshot.courses.length}>
          <div className="dp-btnrow">
            <button
              type="button"
              className="dp-btn dp-btn--sm dp-btn--primary"
              onClick={() => {
                setImporting((prev) => !prev)
              }}
            >
              <Icon name="import" size={14} />
              {t('setting.pasteImport')}
            </button>
            <button
              type="button"
              className="dp-btn dp-btn--sm"
              onClick={() => {
                void runtime.upsertCourse({
                  name: t('setting.newCourse'),
                  weekday: 1,
                  startPeriod: 1,
                  endPeriod: 2,
                  weeks: [],
                })
              }}
            >
              <Icon name="plus" size={14} />
              {t('common.add')}
            </button>
          </div>

          {importing && (
            <CourseImport
              t={t}
              runtime={runtime}
              onDone={() => {
                setImporting(false)
                void runtime.refresh()
              }}
            />
          )}

          {snapshot.courses.length === 0 ? (
            <div className="dp-faint">{t('setting.noCourses')}</div>
          ) : (
            <div className="dp-table">
              <div className="dp-table-head">
                <span className="dp-col-name">{t('setting.colName')}</span>
                <span className="dp-col-small">{t('setting.colWeekday')}</span>
                <span className="dp-col-small">{t('setting.colPeriods')}</span>
                <span className="dp-col-mid">{t('setting.colWeeks')}</span>
                <span className="dp-col-mid">{t('setting.colLocation')}</span>
                <span className="dp-col-act" />
              </div>
              {snapshot.courses.map((course) => (
                <CourseRow key={course.id} t={t} course={course} runtime={runtime} />
              ))}
            </div>
          )}
        </Section>

        {/* ── period grid ─────────────────────────────────────────────────── */}
        <Section title={t('setting.periods')} count={periods.length}>
          <div className="dp-btnrow">
            <button
              type="button"
              className="dp-btn dp-btn--sm"
              onClick={() => {
                patchSettings({ periods: [...DEFAULT_PERIODS] })
                setPeriodsDirty(false)
              }}
            >
              {t('setting.useDefault')}
            </button>
          </div>
          {periodsDirty && <div className="dp-alert">{t('setting.periodsWarn')}</div>}
          <div className="dp-periods">
            {periods.map((period) => (
              <label key={period.index} className="dp-period">
                <span className="dp-period-index">{t('setting.periodN', { n: period.index })}</span>
                <DraftInput
                  value={formatHm(period.startMinute)}
                  ariaLabel={t('setting.periodStart', { n: period.index })}
                  onCommit={(next) => {
                    try {
                      const minute = parseHm(next)
                      setPeriodsDirty(true)
                      patchSettings({
                        periods: periods.map((item) =>
                          item.index === period.index ? { ...item, startMinute: minute } : item,
                        ),
                      })
                    } catch {
                      runtime.notify(t('setting.badTime'))
                    }
                  }}
                />
                <span className="dp-faint">–</span>
                <DraftInput
                  value={formatHm(period.endMinute)}
                  ariaLabel={t('setting.periodEnd', { n: period.index })}
                  onCommit={(next) => {
                    try {
                      const minute = parseHm(next)
                      setPeriodsDirty(true)
                      patchSettings({
                        periods: periods.map((item) =>
                          item.index === period.index ? { ...item, endMinute: minute } : item,
                        ),
                      })
                    } catch {
                      runtime.notify(t('setting.badTime'))
                    }
                  }}
                />
              </label>
            ))}
          </div>
        </Section>

        {/* ── standing plans ──────────────────────────────────────────────── */}
        <Section title={t('setting.routines')} count={settings.routines.length}>
          <p className="dp-hint">{t('setting.routineHint')}</p>

          <div className="dp-field-grid">
            <label className="dp-field">
              <span className="dp-label">{t('setting.termStart')}</span>
              <DraftInput
                value={settings.termStart}
                placeholder="2026-09-07"
                onCommit={(next) => {
                  patchSettings({ termStart: next.trim() })
                }}
              />
            </label>
            <label className="dp-field">
              <span className="dp-label">{t('setting.termWeeks')}</span>
              <DraftInput
                value={String(settings.termWeeks)}
                inputMode="numeric"
                onCommit={(next) => {
                  const value = Number(next)
                  if (Number.isFinite(value) && value >= 1 && value <= 60) {
                    patchSettings({ termWeeks: Math.round(value) })
                  }
                }}
              />
            </label>
          </div>
          <p className="dp-hint">{t('setting.termHint', { weeks: String(settings.termWeeks) })}</p>

          <div className="dp-field">
            <span className="dp-label">{t('setting.routineDraft')}</span>
            <textarea
              className="dp-routine-input"
              rows={3}
              value={routineText}
              placeholder={t('setting.routinePlaceholder')}
              onChange={(event) => setRoutineText(event.target.value)}
            />
          </div>
          <div className="dp-btnrow">
            <button
              type="button"
              className="dp-btn dp-btn--sm"
              disabled={routineBusy || routineText.trim() === ''}
              onClick={() => {
                setRoutineBusy(true)
                setRoutineError(null)
                void runtime
                  .draftRoutines(routineText.trim())
                  .then((result) => {
                    if (result.ok) {
                      setRoutineRows(result.routines.map(withFreshId))
                      return
                    }
                    setRoutineError(result.error?.message ?? t('setting.routineDraftFailed'))
                  })
                  .catch((error: unknown) => {
                    setRoutineError(error instanceof Error ? error.message : String(error))
                  })
                  .finally(() => {
                    setRoutineBusy(false)
                  })
              }}
            >
              {routineBusy ? t('setting.routineDrafting') : t('setting.routineDraft')}
            </button>
            <button
              type="button"
              className="dp-btn dp-btn--sm"
              onClick={() => {
                setRoutineRows((current) => [
                  ...(current ?? settings.routines),
                  {
                    schemaVersion: 1,
                    id: `rt_${newIdSuffix()}`,
                    title: '',
                    category: 'activity',
                    weekdays: [],
                    startPeriod: 1,
                    endPeriod: 1,
                    colorKey: '',
                    enabled: true,
                  },
                ])
              }}
            >
              {t('setting.routineAdd')}
            </button>
            {routineChanged && (
              <button
                type="button"
                className="dp-btn dp-btn--sm dp-btn--primary"
                onClick={() => {
                  patchSettings({ routines: routineRows ?? settings.routines })
                  setRoutineRows(null)
                  runtime.notify(t('setting.routineSaved'))
                }}
              >
                {t('setting.routineSave')}
              </button>
            )}
          </div>
          {routineError !== null && <div className="dp-alert">{routineError}</div>}
          {routineChanged && routineError === null && (
            <p className="dp-hint">{t('setting.routineDraftReady')}</p>
          )}

          {routineRows !== null && routineRows.length === 0 && (
            <p className="dp-muted">{t('setting.routineEmpty')}</p>
          )}
          {routineRows !== null && (
            <div className="dp-routines">
              {routineRows.map((row, index) => (
                <div key={row.id} className="dp-routine-row" data-color={row.colorKey === '' ? undefined : row.colorKey}>
                  <DraftInput
                    className="dp-routine-name"
                    value={row.title}
                    ariaLabel={t('setting.routineName')}
                    placeholder={t('setting.routineName')}
                    onCommit={(next) => {
                      updateRoutine(index, { title: next })
                    }}
                  />
                  <select
                    value={row.category}
                    aria-label={t('setting.routineName')}
                    onChange={(event) => {
                      updateRoutine(index, { category: event.target.value as CategoryValue })
                    }}
                  >
                    {(['study', 'intern', 'activity', 'gym'] as const).map((key) => (
                      <option key={key} value={key}>
                        {t(`common.category.${key}`)}
                      </option>
                    ))}
                  </select>
                  <span className="dp-weekday-picks">
                    {WEEKDAYS.map((label, dayIndex) => {
                      const day = dayIndex + 1
                      const on = row.weekdays.includes(day)
                      return (
                        <button
                          key={label}
                          type="button"
                          className="dp-weekday-pick"
                          data-on={on ? 'true' : undefined}
                          aria-pressed={on}
                          aria-label={label}
                          onClick={() => {
                            updateRoutine(index, {
                              weekdays: on
                                ? row.weekdays.filter((item) => item !== day)
                                : [...row.weekdays, day].sort((left, right) => left - right),
                            })
                          }}
                        >
                          {label}
                        </button>
                      )
                    })}
                  </span>
                  <span className="dp-routine-periods">
                    <span className="dp-faint">{t('setting.periodShort')}</span>
                    <DraftInput
                      value={String(row.startPeriod)}
                      inputMode="numeric"
                      ariaLabel={t('setting.routinePeriods', { a: String(row.startPeriod), b: String(row.endPeriod) })}
                      onCommit={(next) => {
                        const value = Number(next)
                        if (Number.isFinite(value)) {
                          updateRoutine(index, { startPeriod: Math.max(1, Math.round(value)) })
                        }
                      }}
                    />
                    <span className="dp-faint">–</span>
                    <DraftInput
                      value={String(row.endPeriod)}
                      inputMode="numeric"
                      ariaLabel={t('setting.routinePeriods', { a: String(row.startPeriod), b: String(row.endPeriod) })}
                      onCommit={(next) => {
                        const value = Number(next)
                        if (Number.isFinite(value)) {
                          updateRoutine(index, { endPeriod: Math.max(1, Math.round(value)) })
                        }
                      }}
                    />
                  </span>
                  <span className="dp-swatches">
                    {PICK_COLORS.map((key) => (
                      <button
                        key={key}
                        type="button"
                        className="dp-swatch"
                        data-color={key}
                        data-on={row.colorKey === key ? 'true' : undefined}
                        aria-label={t(`color.${key}`)}
                        aria-pressed={row.colorKey === key}
                        onClick={() => {
                          updateRoutine(index, { colorKey: row.colorKey === key ? '' : key })
                        }}
                      />
                    ))}
                  </span>
                  <button
                    type="button"
                    className="dp-gym-del"
                    aria-label={t('common.delete')}
                    onClick={() => {
                      setRoutineRows((current) => (current ?? []).filter((item) => item.id !== row.id))
                    }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              ))}
              <NewExerciseForm t={t} state={state} runtime={runtime} />
            </div>
          )}
        </Section>

        {/* ── gym ─────────────────────────────────────────────────────────── */}
        <Section title={t('setting.gym')} count={snapshot.exercises.length}>
          <div className="dp-field"><span className="dp-label">训练目标与经验 · Agnes 会结合实际组记录给建议</span>
            <div className="dp-btnrow">
              <select aria-label="训练目标" value={settings.fitness.goal} onChange={(event) => patchSettings({ fitness: { goal: event.target.value } })}>
                <option value="unspecified">尚未指定目标</option><option value="hypertrophy">增肌与体型改善</option><option value="strength">力量提升</option><option value="health">综合健康</option>
              </select>
              <select aria-label="训练经验" value={settings.fitness.experience} onChange={(event) => patchSettings({ fitness: { experience: event.target.value } })}>
                <option value="unspecified">尚未指定经验</option><option value="beginner">刚开始训练</option><option value="intermediate">已有规律训练经验</option><option value="advanced">进阶训练</option>
              </select>
            </div>
            <DraftInput ariaLabel="训练器械与约束" value={settings.fitness.constraints} placeholder="可用器械、训练时长、需要避开的动作；也可以在复盘中直接说明。" onCommit={(value) => patchSettings({ fitness: { constraints: value } })} />
          </div>
          <div className="dp-field">
            <span className="dp-label">{t('setting.rotation')}</span>
            <div className="dp-parts">
              {ALL_PARTS.map((part) => {
                const on = settings.gymRotation.includes(part)
                return (
                  <button
                    key={part}
                    type="button"
                    className="dp-chip dp-chip--solid"
                    data-on={on ? 'true' : undefined}
                    onClick={() => {
                      patchSettings({
                        gymRotation: on
                          ? settings.gymRotation.filter((item) => item !== part)
                          : [...settings.gymRotation, part],
                      })
                    }}
                  >
                    {t(`common.part.${part}`)}
                  </button>
                )
              })}
            </div>
            <span className="dp-faint">{t('setting.rotationHint')}</span>
          </div>
          <div className="dp-field">
            <span className="dp-label">{t('setting.restDays')}</span>
            <div className="dp-parts">
              {WEEKDAYS.map((label, index) => {
                const weekday = index + 1
                const on = settings.gymRestDays.includes(weekday)
                return (
                  <button
                    key={label}
                    type="button"
                    className="dp-chip dp-chip--solid"
                    data-on={on ? 'true' : undefined}
                    onClick={() => {
                      patchSettings({
                        gymRestDays: on
                          ? settings.gymRestDays.filter((item) => item !== weekday)
                          : [...settings.gymRestDays, weekday],
                      })
                    }}
                  >
                    {label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="dp-btnrow">
            <button
              type="button"
              className="dp-btn dp-btn--sm"
              onClick={() => {
                void runtime.seedExercises()
              }}
            >
              {t('gym.seedHint')}
            </button>
            <button
              type="button"
              className="dp-btn dp-btn--sm"
              onClick={() => {
                setShowLibrary((prev) => !prev)
              }}
            >
              {showLibrary ? t('common.collapse') : t('setting.manageLibrary')}
            </button>
          </div>
          {showLibrary && (
            <div className="dp-table">
              {snapshot.exercises.map((exercise) => (
                <div key={exercise.id} className="dp-import-row">
                  <span className="dp-import-name">{exercise.name}</span>
                  <span className="dp-import-meta">
                    {t(`common.part.${exercise.part}`)} · {exercise.equipment} · {String(exercise.defaultSets)}×
                    {exercise.defaultReps}
                  </span>
                  <button
                    type="button"
                    className="dp-gym-del"
                    aria-label={t('common.delete')}
                    onClick={() => {
                      void runtime.removeExercise(exercise.id)
                    }}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ── agnes ───────────────────────────────────────────────────────── */}
        <Section title={t('setting.agnes')}>
          <div className="dp-field-grid">
            <label className="dp-field">
              <span className="dp-label">provider</span>
              <DraftInput
                value={settings.agnes.provider}
                onCommit={(next) => {
                  patchSettings({ agnes: { provider: next.trim() } })
                }}
              />
            </label>
            <label className="dp-field">
              <span className="dp-label">model</span>
              <DraftInput
                value={settings.agnes.model}
                onCommit={(next) => {
                  patchSettings({ agnes: { model: next.trim() } })
                }}
              />
            </label>
            <label className="dp-field">
              <span className="dp-label">agent preset</span>
              <DraftInput
                value={settings.agnes.agentPreset}
                onCommit={(next) => {
                  patchSettings({ agnes: { agentPreset: next.trim() } })
                }}
              />
            </label>
            <label className="dp-field">
              <span className="dp-label">{t('setting.timeout')}</span>
              <DraftInput
                value={String(settings.agnes.timeoutMinutes)}
                inputMode="numeric"
                onCommit={(next) => {
                  const value = Math.round(Number(next))
                  if (Number.isFinite(value) && value >= 1 && value <= 30) {
                    patchSettings({ agnes: { timeoutMinutes: value } })
                  }
                }}
              />
            </label>
          </div>
          <div className="dp-btnrow">
            <button
              type="button"
              className="dp-btn dp-btn--sm"
              disabled={probing}
              onClick={() => {
                setProbing(true)
                setProbeResult(null)
                void runtime
                  .agnesProbe()
                  .then((result) => {
                    setProbeResult(`${result.ok ? '✓' : '✗'} ${result.message} · ${String(result.ms)}ms`)
                  })
                  .catch((error: unknown) => {
                    setProbeResult(error instanceof Error ? error.message : String(error))
                  })
                  .finally(() => {
                    setProbing(false)
                  })
              }}
            >
              <Icon name="target" size={14} />
              {probing ? t('setting.testing') : t('setting.test')}
            </button>
            <label className="dp-check-line">
              <input
                type="checkbox"
                checked={settings.reminder.autoStructure}
                onChange={(event) => {
                  patchSettings({ reminder: { autoStructure: event.target.checked } })
                }}
              />
              {t('setting.autoStructure')}
            </label>
          </div>
          {probeResult !== null && <div className="dp-faint">{probeResult}</div>}
          <p className="dp-faint">{t('setting.agnesHint')}</p>
        </Section>

        {/* ── record ──────────────────────────────────────────────────────── */}
        <Section title={t('setting.record')}>
          <div className="dp-field-grid">
            <label className="dp-field">
              <span className="dp-label">{t('setting.streakThreshold')}</span>
              <input
                type="range"
                min={30}
                max={100}
                step={5}
                value={Math.round(settings.streakThreshold * 100)}
                onChange={(event) => {
                  patchSettings({ streakThreshold: Number(event.target.value) / 100 })
                }}
              />
              <span className="dp-faint">
                {t('setting.streakValue', { percent: Math.round(settings.streakThreshold * 100) })}
              </span>
            </label>
            <label className="dp-field">
              <span className="dp-label">{t('setting.defaultView')}</span>
              <select
                value={settings.record.defaultView}
                onChange={(event) => {
                  patchSettings({ record: { defaultView: event.target.value } })
                }}
              >
                <option value="year">{t('record.year')}</option>
                <option value="month">{t('record.month')}</option>
              </select>
            </label>
            <label className="dp-field">
              <span className="dp-label">{t('setting.countCourseBlocks')}</span>
              <label className="dp-check-line">
                <input
                  type="checkbox"
                  checked={settings.countCourseBlocks}
                  onChange={(event) => {
                    patchSettings({ countCourseBlocks: event.target.checked })
                  }}
                />
                {t('setting.countCourseBlocksHint')}
              </label>
            </label>
          </div>
        </Section>

        {/* ── reminders + data ────────────────────────────────────────────── */}
        <Section title={t('setting.reminder')}>
          <div className="dp-field-grid">
            <label className="dp-field">
              <span className="dp-label">{t('setting.reviewTime')}</span>
              <DraftInput
                value={settings.reminder.reviewTime}
                onCommit={(next) => {
                  try {
                    parseHm(next)
                    patchSettings({ reminder: { reviewTime: next.trim() } })
                  } catch {
                    runtime.notify(t('setting.badTime'))
                  }
                }}
              />
            </label>
            <label className="dp-field">
              <span className="dp-label">{t('setting.weeklyPlanTime')}</span>
              <DraftInput
                value={settings.reminder.weeklyPlanTime}
                onCommit={(next) => {
                  try {
                    parseHm(next)
                    patchSettings({ reminder: { weeklyPlanTime: next.trim() } })
                  } catch {
                    runtime.notify(t('setting.badTime'))
                  }
                }}
              />
            </label>
            <label className="dp-field">
              <span className="dp-label">{t('setting.weeklyPlanWeekday')}</span>
              <select
                value={String(settings.reminder.weeklyPlanWeekday)}
                onChange={(event) => {
                  patchSettings({ reminder: { weeklyPlanWeekday: Number(event.target.value) } })
                }}
              >
                {WEEKDAYS.map((label, index) => (
                  <option key={label} value={String(index + 1)}>
                    {`周${label}`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="dp-btnrow">
            <button type="button" className="dp-btn dp-btn--sm" onClick={() => void exportAll()}>
              <Icon name="export" size={14} />
              {t('setting.export')}
            </button>
            <button
              type="button"
              className="dp-btn dp-btn--sm"
              onClick={() => {
                fileRef.current?.click()
              }}
            >
              <Icon name="import" size={14} />
              {t('setting.import')}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file !== undefined) void importFile(file)
                event.target.value = ''
              }}
            />
          </div>
          <p className="dp-faint">{t('setting.dataHint')}</p>
        </Section>
      </div>
    </PageShell>
  )
}

function Section({
  title,
  count,
  children,
}: {
  readonly title: string
  readonly count?: number
  readonly children: React.ReactNode
}): JSX.Element {
  return (
    <Card className="dp-settings-section">
      <div className="dp-settings-section-head" id={`dp-setting-${title}`}>
        <h3>{title}</h3>
        {count !== undefined && <span className="dp-muted">{String(count)}</span>}
      </div>
      <div className="dp-settings-body">{children}</div>
    </Card>
  )
}

function CourseRow({
  t,
  course,
  runtime,
}: {
  readonly t: PageProps['t']
  readonly course: CourseRecord
  readonly runtime: PageProps['runtime']
}): JSX.Element {
  const patch = (input: Partial<CourseRecord>): void => {
    void runtime.upsertCourse({ ...course, ...input })
  }
  return (
    <div className="dp-table-row">
      <DraftInput
        className="dp-col-name"
        value={course.name}
        onCommit={(next) => {
          const name = next.trim()
          if (name !== '') patch({ name })
        }}
      />
      <select
        className="dp-col-small"
        value={String(course.weekday)}
        onChange={(event) => {
          patch({ weekday: Number(event.target.value) })
        }}
      >
        {WEEKDAYS.map((label, index) => (
          <option key={label} value={String(index + 1)}>
            {label}
          </option>
        ))}
      </select>
      <span className="dp-col-small dp-period-cell">
        <DraftInput
          value={String(course.startPeriod)}
          inputMode="numeric"
          onCommit={(next) => {
            const value = Math.round(Number(next))
            if (Number.isFinite(value) && value >= 1) patch({ startPeriod: value })
          }}
        />
        <span className="dp-faint">–</span>
        <DraftInput
          value={String(course.endPeriod)}
          inputMode="numeric"
          onCommit={(next) => {
            const value = Math.round(Number(next))
            if (Number.isFinite(value) && value >= 1) patch({ endPeriod: value })
          }}
        />
      </span>
      <DraftInput
        className="dp-col-mid"
        placeholder={t('setting.everyWeek')}
        value={weeksToText(course.weeks)}
        onCommit={(next) => {
          patch({ weeks: parseWeeks(next) })
        }}
      />
      <DraftInput
        className="dp-col-mid"
        value={course.location}
        onCommit={(next) => {
          patch({ location: next.trim() })
        }}
      />
      <button
        type="button"
        className="dp-gym-del dp-col-act"
        aria-label={t('common.delete')}
        onClick={() => {
          void runtime.removeCourse(course.id)
        }}
      >
        <Icon name="trash" size={13} />
      </button>
    </div>
  )
}
