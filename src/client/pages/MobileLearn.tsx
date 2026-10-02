import { useCallback, useEffect, useState } from 'react'
import type { LearningItemRecord, ReadingRecord } from '../../domain.ts'
import { weekDates } from '../../clock.ts'
import { Icon } from '../icons.tsx'
import { PhoneSheet } from '../ui/PhoneSheet.tsx'
import type { WeekGains } from '../wire.ts'
import type { PageProps } from './types.ts'

type Entry =
  | { kind: 'reading'; record?: ReadingRecord }
  | { kind: 'practice'; record?: LearningItemRecord }
const units: Record<string, string> = {
  page: '页',
  chapter: '章',
  percent: '%',
}

export function MobileLearn({
  state,
  runtime,
  onTellAgnes,
}: PageProps): JSX.Element {
  const [books, setBooks] = useState<ReadingRecord[]>([])
  const [items, setItems] = useState<LearningItemRecord[]>([])
  const [gains, setGains] = useState<WeekGains | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Entry | null>(null)
  const today = state.snapshot?.todayIso ?? ''
  const week = state.snapshot?.weekKey ?? ''
  const load = useCallback(async () => {
    if (!week) return
    try {
      const dates = weekDates(week)
      const [reading, learning, stats] = await Promise.all([
        runtime.readingList(),
        runtime.learningList(),
        runtime.learnWeekStats(dates[0]!, dates[6]!),
      ])
      setBooks(reading)
      setItems(learning)
      setGains(stats)
      setLoaded(true)
      setError('')
    } catch (failure) {
      setError(String(failure))
    }
  }, [runtime, week])
  useEffect(() => {
    void load()
  }, [load, state.snapshot?.nowIso])
  const reading = books.filter((book) => book.status !== 'done')
  const learning = items.filter((item) => item.status !== 'done')
  const finished =
    books.filter((book) => book.status === 'done').length +
    items.filter((item) => item.status === 'done').length
  const row = (entry: Entry) => {
    if (!entry.record) return null
    const book = entry.kind === 'reading' ? entry.record : null
    const item = entry.kind === 'practice' ? entry.record : null
    const value = book?.progress ?? item?.done ?? 0,
      total = book?.total ?? item?.target ?? 0
    const unit = book ? (units[book.unit] ?? '页') : item!.unit
    const gain =
      (book ? gains?.reading : gains?.learning)?.find(
        (g) => g.id === entry.record!.id,
      )?.gain ?? 0
    return (
      <button
        key={entry.record.id}
        className="phone-learn-row dp-block"
        data-cat="study"
        data-color={entry.record.colorKey || undefined}
        aria-label={`更新进度：${entry.record.title}`}
        onClick={() => setEditing(entry)}
      >
        <span className="phone-learn-emblem">
          <Icon name={book ? 'list' : 'target'} size={18} />
        </span>
        <span className="phone-learn-copy">
          <b>{entry.record.title}</b>
          <small>
            {value}
            {total > 0 ? ` / ${total}` : ''} {unit}
            <span>
              本周 +{gain}
              {unit}
            </span>
            {entry.record.status === 'paused' && <span>已暂停</span>}
          </small>
          {total > 0 && (
            <span
              className="phone-learn-progress"
              role="progressbar"
              aria-label={`${entry.record.title}进度`}
              aria-valuenow={Math.min(100, Math.round((value / total) * 100))}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <i
                style={{ width: `${Math.min(100, (value / total) * 100)}%` }}
              />
            </span>
          )}
        </span>
        <Icon name="chevronRight" size={16} />
      </button>
    )
  }
  return (
    <section className="phone-learn" aria-label="学习与阅读">
      <div className="phone-learn-heading">
        <h1>学习</h1>
        <button onClick={() => onTellAgnes?.()}>
          告诉 Agnes
          <Icon name="sparkle" size={15} />
        </button>
      </div>
      <p className="phone-learn-overview">
        {reading.length} 本在读<span>·</span>
        {learning.length} 项进行中<span>·</span>本周记录{' '}
        {gains?.daily.filter((d) => d.reading > 0 || d.learning > 0).length ??
          0}{' '}
        天
      </p>
      {error && (
        <p role="alert" className="dp-error">
          {error}
          <button onClick={() => void load()}>重新读取</button>
        </p>
      )}
      {!loaded && !error && <p className="dp-muted">正在读取学习进度…</p>}
      <div className="phone-learn-section">
        <header>
          <h2>阅读</h2>
          <button
            aria-label="添加书籍"
            onClick={() => setEditing({ kind: 'reading' })}
          >
            <Icon name="plus" size={18} />
          </button>
        </header>
        {reading.map((record) => row({ kind: 'reading', record }))}
        {loaded && !reading.length && (
          <p className="phone-section-empty">加入一本书，记录读到了哪里。</p>
        )}
      </div>
      <div className="phone-learn-section">
        <header>
          <h2>课程与练习</h2>
          <button
            aria-label="添加学习项目"
            onClick={() => setEditing({ kind: 'practice' })}
          >
            <Icon name="plus" size={18} />
          </button>
        </header>
        {learning.map((record) => row({ kind: 'practice', record }))}
        {loaded && !learning.length && (
          <p className="phone-section-empty">
            课程、刷题或技能，都可以在这里积累。
          </p>
        )}
      </div>
      {finished > 0 && (
        <details className="phone-learn-finished">
          <summary>已完成 · {finished}</summary>
          {books
            .filter((b) => b.status === 'done')
            .map((record) => row({ kind: 'reading', record }))}
          {items
            .filter((i) => i.status === 'done')
            .map((record) => row({ kind: 'practice', record }))}
        </details>
      )}
      <button className="phone-gym-tell" onClick={() => onTellAgnes?.()}>
        说说学了什么，Agnes 帮你补记与调整
        <Icon name="chevronRight" size={14} />
      </button>
      {editing && (
        <LearningEditor
          entry={editing}
          date={today}
          runtime={runtime}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void load()
          }}
        />
      )}
    </section>
  )
}

function LearningEditor({
  entry,
  date,
  runtime,
  onClose,
  onSaved,
}: {
  entry: Entry
  date: string
  runtime: PageProps['runtime']
  onClose: () => void
  onSaved: () => void
}): JSX.Element {
  const book = entry.kind === 'reading' ? entry.record : undefined
  const item = entry.kind === 'practice' ? entry.record : undefined
  const isReading = entry.kind === 'reading',
    original = entry.record
  const [id] = useState(original?.id ?? `mobile_${crypto.randomUUID()}`)
  const [title, setTitle] = useState(original?.title ?? '')
  const [value, setValue] = useState(String(book?.progress ?? item?.done ?? 0))
  const [unit, setUnit] = useState(
    book?.unit ?? item?.unit ?? (isReading ? 'page' : '题'),
  )
  const [total, setTotal] = useState(String(book?.total ?? item?.target ?? 0))
  const [goal, setGoal] = useState(String(original?.weeklyGoal ?? 0))
  const [author, setAuthor] = useState(book?.author ?? '')
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [deleting, setDeleting] = useState(false)
  const perform = async (work: () => Promise<unknown>) => {
    setBusy(true)
    setError('')
    try {
      await work()
      onSaved()
    } catch (failure) {
      setError(String(failure))
    } finally {
      setBusy(false)
    }
  }
  const valid =
    title.trim() &&
    [value, total, goal].every(
      (v) =>
        v.trim() !== '' && Number.isSafeInteger(Number(v)) && Number(v) >= 0,
    ) &&
    unit.trim()
  const save = () =>
    perform(async () => {
      if (isReading) {
        await runtime.upsertReading({
          id,
          title: title.trim(),
          author,
          total: Number(total),
          weeklyGoal: Number(goal),
          unit: unit as ReadingRecord['unit'],
          ...(book ? {} : { status: 'reading' }),
        })
        if (
          Number(value) !== (book?.progress ?? 0) ||
          Number(total) !== (book?.total ?? 0)
        )
          await runtime.setReadingProgress(id, Number(value), date)
      } else {
        await runtime.upsertLearning({
          id,
          title: title.trim(),
          target: Number(total),
          weeklyGoal: Number(goal),
          unit: unit.trim(),
          ...(item ? {} : { kind: 'other', status: 'active' }),
        })
        if (
          Number(value) !== (item?.done ?? 0) ||
          Number(total) !== (item?.target ?? 0)
        )
          await runtime.setLearningCount(id, Number(value), date)
      }
    })
  return (
    <PhoneSheet
      title={
        original ? '更新学习进度' : isReading ? '加入一本书' : '加入学习项目'
      }
      onClose={onClose}
      footer={
        <button
          className="phone-primary"
          disabled={busy || !valid}
          onClick={() => void save()}
        >
          {busy ? '保存…' : '保存进度'}
        </button>
      }
    >
      <div className="phone-edit-fields">
        <label>
          名称
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label>
          {isReading
            ? `读到第几${units[unit] ?? '页'}`
            : `累计完成了多少${unit}`}
          <input
            inputMode="numeric"
            type="number"
            min={0}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <small>填写当前累计进度，本周增量会自动计算。</small>
        <details
          className="phone-learning-settings"
          open={!original || undefined}
        >
          <summary>目标与设置</summary>
          <div className="phone-edit-fields">
            <label>
              计量单位
              {isReading ? (
                <select value={unit} onChange={(e) => setUnit(e.target.value)}>
                  <option value="page">页</option>
                  <option value="chapter">章</option>
                  <option value="percent">百分比</option>
                </select>
              ) : (
                <input value={unit} onChange={(e) => setUnit(e.target.value)} />
              )}
            </label>
            <div className="phone-time-fields">
              <label>
                总目标（0 为不限）
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={total}
                  onChange={(e) => setTotal(e.target.value)}
                />
              </label>
              <label>
                每周目标
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  value={goal}
                  onChange={(e) => setGoal(e.target.value)}
                />
              </label>
            </div>
            {isReading && (
              <label>
                作者（可选）
                <input
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                />
              </label>
            )}
          </div>
        </details>
        {error && (
          <p role="alert" className="phone-danger">
            {error}
          </p>
        )}
        {original && (
          <div className="phone-gym-options">
            <button
              disabled={busy}
              onClick={() =>
                void perform(() =>
                  runtime.saveBacklog({
                    title: isReading ? `阅读《${title}》` : title,
                    category: 'study',
                    estimatePeriods: 1,
                    learningRef: original.id,
                    learningKind: entry.kind,
                    colorKey: original.colorKey,
                  }),
                )
              }
            >
              加入任务池
            </button>
            <button
              className="phone-danger"
              disabled={busy}
              onClick={() =>
                deleting
                  ? void perform(() =>
                      isReading
                        ? runtime.removeReading(id)
                        : runtime.removeLearning(id),
                    )
                  : setDeleting(true)
              }
            >
              {deleting ? '确认删除这条学习记录' : '删除项目'}
            </button>
          </div>
        )}
      </div>
    </PhoneSheet>
  )
}
