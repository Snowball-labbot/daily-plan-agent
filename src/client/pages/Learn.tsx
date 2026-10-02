import { useCallback, useEffect, useMemo, useState } from 'react'
import { isoWeekKey, parseIsoDate, todayIso, weekDates, weekdayOf } from '../../clock.ts'
import type { LearningItemRecord, ReadingRecord } from '../../domain.ts'
import { PICK_COLORS } from '../../palette.ts'
import { Icon } from '../icons.tsx'
import { DraftInput, PageShell } from '../ui/kit.tsx'
import type { PageProps } from './types.ts'
import type { WeekGains } from '../wire.ts'

const WEEKDAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'] as const

const UNIT_LABEL: Record<string, string> = { page: '页', chapter: '章', percent: '%' }
const KIND_LABEL: Record<string, string> = { problem: '刷题', course: '网课', skill: '技能', other: '其他' }

type ReadingFormTarget = Partial<ReadingRecord> & { title: string }
type LearningFormTarget = Partial<LearningItemRecord> & { title: string }

export function LearnPage({ t, runtime, state }: PageProps): JSX.Element {
  const [reading, setReading] = useState<ReadingRecord[] | null>(null)
  const [learning, setLearning] = useState<LearningItemRecord[] | null>(null)
  const [gains, setGains] = useState<WeekGains | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const weekKey = state.weekKey ?? isoWeekKey(parseIsoDate(todayIso()))
  const today = state.snapshot?.todayIso ?? todayIso()

  // Same lesson as the gym page: this is the whole content of the page, so it
  // is fetched on its own rather than read off a snapshot that might be stale.
  const load = useCallback(async (): Promise<void> => {
    try {
      const [books, items] = await Promise.all([runtime.readingList(), runtime.learningList()])
      setReading(books)
      setLearning(items)
      setLoadError(null)
    } catch (error) {
      setReading([])
      setLearning([])
      setLoadError(error instanceof Error ? error.message : String(error))
    }
  }, [runtime])

  const loadGains = useCallback(
    async (key: string): Promise<void> => {
      try {
        const dates = weekDates(key)
        const week = await runtime.learnWeekStats(dates[0] ?? today, dates.at(-1) ?? today)
        setGains(week)
      } catch {
        setGains(null)
      }
    },
    [runtime, today],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    void loadGains(weekKey)
  }, [loadGains, weekKey])

  const dates = useMemo(() => weekDates(weekKey), [weekKey])
  const maxDay = Math.max(1, ...(gains?.daily ?? []).map((point) => point.reading + point.learning))

  /** Write-then-reload used by the cards below. */
  const mutate = useCallback(
    async (work: () => Promise<unknown>): Promise<void> => {
      await work()
      await Promise.all([load(), loadGains(weekKey)])
    },
    [load, loadGains, weekKey],
  )
  const reload = useCallback(() => mutate(async () => undefined), [mutate])

  const openBooks = (reading ?? []).filter((book) => book.status !== 'done')
  const finishedBooks = (reading ?? []).filter((book) => book.status === 'done')
  const activeItems = (learning ?? []).filter((item) => item.status !== 'done')
  const doneItems = (learning ?? []).filter((item) => item.status === 'done')

  const thisWeekUnits = gains?.learningUnits ?? 0
  const thisWeekPages = gains?.readingPages ?? 0

  return (
    <PageShell title="学习与阅读" sub="">
    <div className="dp-learn">
      <section className="dp-week-stats">
        <div className="dp-week-stats-row">
          <div className="dp-big">
            <b>{gains === null ? '…' : String(thisWeekPages)}</b>
            <span>{t('learn.pagesUnit')}</span>
          </div>
          <div className="dp-big">
            <b>{gains === null ? '…' : String(thisWeekUnits)}</b>
            <span>{t('learn.unitsUnit')}</span>
          </div>
          <div className="dp-big">
            <b>{String(openBooks.length)}</b>
            <span>{t('learn.readingCount')}</span>
          </div>
          <div className="dp-big">
            <b>{String(activeItems.length)}</b>
            <span>{t('learn.activeCount')}</span>
          </div>
        </div>

        <div className="dp-week-bar" role="img" aria-label={t('learn.weekBar')}>
          {(gains?.daily ?? dates.map((date) => ({ date, reading: 0, learning: 0 }))).map((point) => {
            const total = point.reading + point.learning
            const readShare = total === 0 ? 0 : point.reading / total
            return (
              <span
                key={point.date}
                className="dp-week-bar-col"
                data-today={point.date === today ? 'true' : undefined}
                title={`${point.date} · ${t('learn.pages')} ${String(point.reading)} · ${t('learn.units')} ${String(point.learning)}`}
              >
                <span className="dp-week-bar-track">
                  {total > 0 && (
                    <span className="dp-week-bar-fill" style={{ height: `${String(Math.round((total / maxDay) * 100))}%` }}>
                      <span className="dp-week-bar-read" style={{ height: `${String(Math.round(readShare * 100))}%` }} />
                    </span>
                  )}
                </span>
                <em>{WEEKDAY_SHORT[weekdayOf(parseIsoDate(point.date)) - 1]}</em>
              </span>
            )
          })}
        </div>
        <p className="dp-faint dp-learn-legend">
          <i className="dp-swatch-dot" data-kind="read" /> {t('learn.pages')}
          <i className="dp-swatch-dot" data-kind="learn" /> {t('learn.units')}
        </p>
      </section>

      {loadError !== null && (
        <div className="dp-error" role="alert">
          {t('learn.loadError')}: {loadError}
        </div>
      )}

      <section className="dp-learn-col">
        <header className="dp-subhead">
          <Icon name="list" size={13} />
          <span>{t('learn.reading')}</span>
          <span className="dp-faint">{t('learn.readingHint')}</span>
        </header>

        {reading === null ? (
          <p className="dp-muted">{t('common.loading')}</p>
        ) : (
          <>
            {openBooks.length === 0 && finishedBooks.length === 0 && <p className="dp-muted">{t('learn.noBooks')}</p>}
            {openBooks.map((book) => (
              <BookCard
                key={book.id}
                t={t}
                runtime={runtime}
                book={book}
                weekGain={gains?.reading.find((entry) => entry.id === book.id)?.gain ?? 0}
                today={today}
                onChange={reload}
              />
            ))}
            {finishedBooks.length > 0 && (
              <details className="dp-learn-done">
                <summary>
                  {t('learn.finished')} <span className="dp-faint">{String(finishedBooks.length)}</span>
                </summary>
                {finishedBooks.map((book) => (
                  <BookCard
                    key={book.id}
                    t={t}
                    runtime={runtime}
                    book={book}
                    weekGain={0}
                    today={today}
                    onChange={reload}
                  />
                ))}
              </details>
            )}
            <NewBookForm
              t={t}
              runtime={runtime}
              onCreated={reload}
            />
          </>
        )}
      </section>

      <section className="dp-learn-col">
        <header className="dp-subhead">
          <Icon name="target" size={13} />
          <span>{t('learn.practice')}</span>
          <span className="dp-faint">{t('learn.practiceHint')}</span>
        </header>

        {learning === null ? (
          <p className="dp-muted">{t('common.loading')}</p>
        ) : (
          <>
            {activeItems.length === 0 && doneItems.length === 0 && <p className="dp-muted">{t('learn.noItems')}</p>}
            {activeItems.map((item) => (
              <ItemCard
                key={item.id}
                t={t}
                runtime={runtime}
                item={item}
                weekGain={gains?.learning.find((entry) => entry.id === item.id)?.gain ?? 0}
                today={today}
                onDone={reload}
              />
            ))}
            {doneItems.length > 0 && (
              <details className="dp-learn-done">
                <summary>
                  {t('learn.finished')} <span className="dp-faint">{String(doneItems.length)}</span>
                </summary>
                {doneItems.map((item) => (
                  <ItemCard
                    key={item.id}
                    t={t}
                    runtime={runtime}
                    item={item}
                    weekGain={0}
                    today={today}
                    onDone={reload}
                  />
                ))}
              </details>
            )}
            <NewItemForm
              t={t}
              runtime={runtime}
              onCreated={reload}
            />
          </>
        )}
      </section>
    </div>
    </PageShell>
  )
}

/* ── reading ──────────────────────────────────────────────────────────────── */

interface BookCardProps {
  readonly t: PageProps['t']
  readonly runtime: PageProps['runtime']
  readonly book: ReadingRecord
  readonly weekGain: number
  readonly today: string
  readonly onChange: () => void
}

function BookCard({ t, runtime, book, weekGain, today, onChange }: BookCardProps): JSX.Element {
  const unit = UNIT_LABEL[book.unit] ?? '页'
  const ratio = book.total > 0 ? Math.min(1, book.progress / book.total) : 0
  const weekly = book.weeklyGoal > 0 ? Math.min(1, weekGain / book.weeklyGoal) : 0
  const daysLeft = book.targetDate === null ? null : Math.ceil((parseIsoDate(book.targetDate).getTime() - parseIsoDate(today).getTime()) / 86_400_000)

  const commit = async (value: number): Promise<void> => {
    await runtime.setReadingProgress(book.id, value, today)
    onChange()
  }

  return (
    <article className="dp-learn-card" data-color={book.colorKey === '' ? undefined : book.colorKey}>
      <div className="dp-learn-card-head">
        <span className="dp-book-emblem"><Icon name="list" size={22} /></span><span className="dp-learn-title">{book.title}</span>
        {book.author !== '' && <span className="dp-faint">{book.author}</span>}
        {book.status === 'paused' && <span className="dp-tag">{t('learn.paused')}</span>}
        <button
          type="button"
          className="dp-learn-act"
          aria-label={t('learn.schedule')}
          title={t('learn.schedule')}
          onClick={() => {
            void runtime
              .saveBacklog({
                title: `${t('learn.readPrefix')}《${book.title}》`,
                category: 'study',
                estimatePeriods: 1,
                colorKey: book.colorKey,
                learningRef: book.id,
                learningKind: 'reading',
              })
              .then(onChange)
          }}
        >
          <Icon name="clock" size={12} />
        </button>
        <button
          type="button"
          className="dp-gym-del"
          aria-label={t('common.delete')}
          onClick={() => {
            void runtime.removeReading(book.id).then(onChange)
          }}
        >
          <Icon name="trash" size={12} />
        </button>
      </div>

      <div className="dp-learn-bar" role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${String(Math.round(ratio * 100))}%` }} />
      </div>

      <div className="dp-learn-meta">
        <span className="dp-learn-stat">
          <b>{String(book.progress)}</b>
          {book.total > 0 ? ` / ${String(book.total)} ${unit}` : ` ${unit}`}
        </span>
        <span className="dp-faint">
          {t('learn.thisWeek')} <b className={weekGain > 0 ? 'is-good' : ''}>+{String(weekGain)}</b> {unit}
        </span>
        {book.targetDate !== null && daysLeft !== null && (
          <span className="dp-faint" data-late={daysLeft < 0 ? 'true' : undefined}>
            <Icon name="clock" size={11} />{' '}
            {daysLeft < 0 ? t('learn.overdue', { days: String(-daysLeft) }) : t('learn.daysLeft', { days: String(daysLeft) })}
          </span>
        )}
        <span className="dp-learn-spacer" />
        <span className="dp-learn-now">
          <DraftInput
            className="dp-tiny-input"
            inputMode="numeric"
            value=""
            placeholder={t('learn.updateProgress')}
            ariaLabel={t('learn.updateProgress')}
            onCommit={(text) => {
              const value = Number(text)
              if (Number.isFinite(value) && value >= 0) void commit(Math.round(value))
            }}
          />
        </span>
      </div>

      {book.weeklyGoal > 0 && (
        <div className="dp-learn-goal">
          <span className="dp-learn-goal-track">
            <span style={{ width: `${String(Math.round(weekly * 100))}%` }} data-full={weekly >= 1 ? 'true' : undefined} />
          </span>
          <span className="dp-faint">
            {String(weekGain)} / {String(book.weeklyGoal)} {unit}
            {t('learn.perWeek')}
          </span>
        </div>
      )}
    </article>
  )
}

interface NewBookFormProps {
  readonly t: PageProps['t']
  readonly runtime: PageProps['runtime']
  readonly onCreated: () => void
}

function NewBookForm({ t, runtime, onCreated }: NewBookFormProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [total, setTotal] = useState('')
  const [unit, setUnit] = useState<ReadingRecord['unit']>('page')
  const [goal, setGoal] = useState('')
  const [colorKey, setColorKey] = useState('')

  if (!open) {
    return (
      <button type="button" className="dp-btn dp-btn--sm" onClick={() => setOpen(true)}>
        <Icon name="plus" size={12} /> {t('learn.addBook')}
      </button>
    )
  }

  const submit = (): void => {
    const name = title.trim()
    if (name === '') return
    const payload: ReadingFormTarget = {
      title: name,
      author: author.trim(),
      unit,
      total: Number(total) > 0 ? Number(total) : 0,
      weeklyGoal: Number(goal) > 0 ? Number(goal) : 0,
      colorKey,
      status: 'reading',
    }
    void runtime.upsertReading(payload).then(() => {
      setTitle('')
      setAuthor('')
      setTotal('')
      setGoal('')
      setColorKey('')
      setOpen(false)
      onCreated()
    })
  }

  return (
    <div className="dp-learn-form">
      <div className="dp-pool-row">
        <DraftInput autoFocus value={title} placeholder={t('learn.bookTitle')} onInput={setTitle} onCommit={() => submit()} />
        <DraftInput value={author} placeholder={t('learn.author')} onInput={setAuthor} onCommit={() => submit()} />
      </div>
      <div className="dp-pool-row">
        <select value={unit} onChange={(event) => setUnit(event.target.value as ReadingRecord['unit'])}>
          {(['page', 'chapter', 'percent'] as const).map((key) => (
            <option key={key} value={key}>
              {UNIT_LABEL[key]}
            </option>
          ))}
        </select>
        <DraftInput value={total} inputMode="numeric" placeholder={t('learn.total')} onInput={setTotal} onCommit={() => submit()} />
        <DraftInput value={goal} inputMode="numeric" placeholder={t('learn.weeklyGoal')} onInput={setGoal} onCommit={() => submit()} />
      </div>
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
              onClick={() => setColorKey(colorKey === key ? '' : key)}
            />
          ))}
        </span>
        <span className="dp-learn-spacer" />
        <button type="button" className="dp-btn dp-btn--sm" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </button>
        <button type="button" className="dp-btn dp-btn--sm dp-btn--primary" disabled={title.trim() === ''} onClick={submit}>
          {t('common.save')}
        </button>
      </div>
    </div>
  )
}

/* ── practice ─────────────────────────────────────────────────────────────── */

interface ItemCardProps {
  readonly t: PageProps['t']
  readonly runtime: PageProps['runtime']
  readonly item: LearningItemRecord
  readonly weekGain: number
  readonly today: string
  readonly onDone: () => void
}

function ItemCard({ t, runtime, item, weekGain, today, onDone }: ItemCardProps): JSX.Element {
  const ratio = item.target > 0 ? Math.min(1, item.done / item.target) : 0
  const weekly = item.weeklyGoal > 0 ? Math.min(1, weekGain / item.weeklyGoal) : 0
  const todayValue = item.log.find((entry) => entry.date === today)?.value ?? item.done

  const bump = (delta: number): void => {
    void runtime.bumpLearning(item.id, delta, today).then(onDone)
  }

  return (
    <article className="dp-learn-card" data-color={item.colorKey === '' ? undefined : item.colorKey}>
      <div className="dp-learn-card-head">
        <span className="dp-learn-title">{item.title}</span>
        <span className="dp-tag" data-kind={item.kind}>
          {KIND_LABEL[item.kind] ?? item.kind}
        </span>
        {item.status === 'paused' && <span className="dp-tag">{t('learn.paused')}</span>}
        <button
          type="button"
          className="dp-learn-act"
          aria-label={t('learn.schedule')}
          title={t('learn.schedule')}
          onClick={() => {
            void runtime
              .saveBacklog({
                title: item.title,
                category: 'study',
                estimatePeriods: 1,
                colorKey: item.colorKey,
                learningRef: item.id,
                learningKind: 'practice',
              })
              .then(onDone)
          }}
        >
          <Icon name="clock" size={12} />
        </button>
        <button
          type="button"
          className="dp-gym-del"
          aria-label={t('common.delete')}
          onClick={() => {
            void runtime.removeLearning(item.id).then(onDone)
          }}
        >
          <Icon name="trash" size={12} />
        </button>
      </div>

      <div className="dp-learn-bar" role="progressbar" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
        <span style={{ width: `${String(Math.round(ratio * 100))}%` }} />
      </div>

      <div className="dp-learn-meta">
        <span className="dp-learn-stat">
          <b>{String(item.done)}</b>
          {item.target > 0 ? ` / ${String(item.target)} ${item.unit}` : ` ${item.unit}`}
        </span>
        <span className="dp-faint">
          {t('learn.thisWeek')} <b className={weekGain > 0 ? 'is-good' : ''}>+{String(weekGain)}</b> {item.unit}
        </span>
        <span className="dp-learn-spacer" />
        <span className="dp-learn-stepper">
          <button type="button" aria-label={t('learn.minus')} onClick={() => bump(-1)} disabled={item.done <= 0}>
            <Icon name="minus" size={12} />
          </button>
          <DraftInput
            className="dp-tiny-input dp-tiny-input--w"
            inputMode="numeric"
            value={String(todayValue)}
            ariaLabel={t('learn.todayCount')}
            onCommit={(text) => {
              const value = Number(text)
              if (Number.isFinite(value) && value >= 0) void runtime.setLearningCount(item.id, Math.round(value), today).then(onDone)
            }}
          />
          <button type="button" aria-label={t('learn.plus')} onClick={() => bump(1)}>
            <Icon name="plus" size={12} />
          </button>
        </span>
      </div>

      {item.weeklyGoal > 0 && (
        <div className="dp-learn-goal">
          <span className="dp-learn-goal-track">
            <span style={{ width: `${String(Math.round(weekly * 100))}%` }} data-full={weekly >= 1 ? 'true' : undefined} />
          </span>
          <span className="dp-faint">
            {String(weekGain)} / {String(item.weeklyGoal)} {item.unit}
            {t('learn.perWeek')}
          </span>
        </div>
      )}
    </article>
  )
}

interface NewItemFormProps {
  readonly t: PageProps['t']
  readonly runtime: PageProps['runtime']
  readonly onCreated: () => void
}

function NewItemForm({ t, runtime, onCreated }: NewItemFormProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<LearningItemRecord['kind']>('problem')
  const [unit, setUnit] = useState('题')
  const [target, setTarget] = useState('')
  const [goal, setGoal] = useState('')
  const [colorKey, setColorKey] = useState('')

  if (!open) {
    return (
      <button type="button" className="dp-btn dp-btn--sm" onClick={() => setOpen(true)}>
        <Icon name="plus" size={12} /> {t('learn.addItem')}
      </button>
    )
  }

  const submit = (): void => {
    const name = title.trim()
    if (name === '') return
    const payload: LearningFormTarget = {
      title: name,
      kind,
      unit: unit.trim() === '' ? '题' : unit.trim(),
      target: Number(target) > 0 ? Number(target) : 0,
      weeklyGoal: Number(goal) > 0 ? Number(goal) : 0,
      colorKey,
      status: 'active',
    }
    void runtime.upsertLearning(payload).then(() => {
      setTitle('')
      setTarget('')
      setGoal('')
      setColorKey('')
      setOpen(false)
      onCreated()
    })
  }

  return (
    <div className="dp-learn-form">
      <div className="dp-pool-row">
        <DraftInput autoFocus value={title} placeholder={t('learn.itemTitle')} onInput={setTitle} onCommit={() => submit()} />
        <select value={kind} onChange={(event) => setKind(event.target.value as LearningItemRecord['kind'])}>
          {(['problem', 'course', 'skill', 'other'] as const).map((key) => (
            <option key={key} value={key}>
              {KIND_LABEL[key]}
            </option>
          ))}
        </select>
      </div>
      <div className="dp-pool-row">
        <DraftInput value={unit} placeholder={t('learn.unit')} onInput={setUnit} onCommit={() => submit()} />
        <DraftInput value={target} inputMode="numeric" placeholder={t('learn.total')} onInput={setTarget} onCommit={() => submit()} />
        <DraftInput value={goal} inputMode="numeric" placeholder={t('learn.weeklyGoal')} onInput={setGoal} onCommit={() => submit()} />
      </div>
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
              onClick={() => setColorKey(colorKey === key ? '' : key)}
            />
          ))}
        </span>
        <span className="dp-learn-spacer" />
        <button type="button" className="dp-btn dp-btn--sm" onClick={() => setOpen(false)}>
          {t('common.cancel')}
        </button>
        <button type="button" className="dp-btn dp-btn--sm dp-btn--primary" disabled={title.trim() === ''} onClick={submit}>
          {t('common.save')}
        </button>
      </div>
    </div>
  )
}
