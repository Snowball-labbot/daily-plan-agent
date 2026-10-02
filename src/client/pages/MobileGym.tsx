import { useEffect, useRef, useState } from 'react'
import type {
  ExerciseRecord,
  GymItemRecord,
  GymSessionRecord,
} from '../../domain.ts'
import { addDays, isoDate, parseIsoDate } from '../../clock.ts'
import { gymSetFromFields, loggedSets } from '../../gym.ts'
import { Icon } from '../icons.tsx'
import { PhoneSheet } from '../ui/PhoneSheet.tsx'
import type { PageProps } from './types.ts'

export function MobileGym({
  state,
  runtime,
  onTellAgnes,
  t,
}: PageProps): JSX.Element {
  const snapshot = state.snapshot,
    date = state.gymDate ?? snapshot?.todayIso ?? ''
  const [session, setSession] = useState<GymSessionRecord | null>(null),
    [picker, setPicker] = useState(false),
    [editing, setEditing] = useState<GymItemRecord | null>(null)
  const [part, setPart] = useState('all'),
    [search, setSearch] = useState(''),
    [busy, setBusy] = useState(false),
    [menu, setMenu] = useState(false),
    [finish, setFinish] = useState(false)
  const [patch, setPatch] = useState({ sets: '', reps: '', weight: '' })
  const [added, setAdded] = useState<Record<string, number>>({})
  const [operationError, setOperationError] = useState('')
  useEffect(() => {
    let active = true
    void runtime
      .gymSession(date)
      .then((value) => {
        if (active) setSession(value)
      })
      .catch((error) => runtime.notify(String(error)))
    return () => {
      active = false
    }
  }, [date, snapshot?.nowIso, runtime])
  if (!snapshot || !session || session.date !== date)
    return <p className="mobile-loading">正在读取训练…</p>
  const perform = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setOperationError('')
    try {
      await action()
      setSession(await runtime.gymSession(date))
      return true
    } catch (error) {
      setOperationError(String(error))
      runtime.notify(String(error))
      return false
    } finally {
      setBusy(false)
    }
  }
  const library = snapshot.exercises.filter(
    (item) =>
      !item.archived &&
      (part === 'all' || item.part === part) &&
      item.name.toLowerCase().includes(search.toLowerCase()),
  )
  const choose = (item: GymItemRecord) => {
    setOperationError('')
    setPatch({ sets: String(item.sets), reps: item.reps, weight: item.weight })
    setEditing(item)
  }
  return (
    <section className="phone-gym" aria-label="训练">
      <header className="phone-gym-heading">
        <h1>训练</h1>
        <button
          disabled={!session.items.length || busy}
          onClick={() => {
            setOperationError('')
            setFinish(true)
          }}
        >
          结束训练
          <Icon name="check" size={14} />
        </button>
      </header>
      <div className="phone-gym-date">
        <button
          aria-label="前一天"
          onClick={() =>
            runtime.setGymDate(isoDate(addDays(parseIsoDate(date), -1)))
          }
        >
          <Icon name="chevronLeft" size={18} />
        </button>
        <input
          type="date"
          aria-label="训练日期"
          value={date}
          onChange={(event) =>
            event.target.value && runtime.setGymDate(event.target.value)
          }
        />
        <button
          aria-label="后一天"
          onClick={() =>
            runtime.setGymDate(isoDate(addDays(parseIsoDate(date), 1)))
          }
        >
          <Icon name="chevronRight" size={18} />
        </button>
        <button aria-label="训练选项" onClick={() => setMenu(!menu)}>
          <Icon name="setting" size={18} />
        </button>
      </div>
      {menu && (
        <div className="phone-gym-options">
          <button
            onClick={() => {
              runtime.setGymDate(null)
              setMenu(false)
            }}
          >
            回到今天
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void perform(() => runtime.applyLastGym(date, null)).then(() =>
                setMenu(false),
              )
            }
          >
            套用上次训练
          </button>
          <button
            disabled={busy}
            onClick={() =>
              void perform(() => runtime.queueGymSession(date)).then(() =>
                setMenu(false),
              )
            }
          >
            加入任务池
          </button>
          <button
            onClick={() => {
              runtime.setRecordView('training')
              runtime.setPage('record')
            }}
          >
            查看训练记录
          </button>
        </div>
      )}
      <div className="phone-gym-summary">
        <span>{session.items.length} 个动作</span>
        <span>
          {loggedSets(session.items)}/
          {session.items.reduce((n, item) => n + item.sets, 0)} 组
          {session.finishedAt ? ' · 已结束' : ''}
        </span>
      </div>
      <div className="phone-gym-list">
        {session.items.map((item) => (
          <MobileExercise
            key={item.id}
            item={item}
            date={date}
            runtime={runtime}
            canLog={date <= snapshot.todayIso}
            onEdit={() => choose(item)}
            onSaved={() => void runtime.gymSession(date).then(setSession)}
          />
        ))}
      </div>
      {!session.items.length && (
        <p className="phone-gym-empty">添加动作，开始今天的训练。</p>
      )}
      <button
        className="phone-add-exercise"
        onClick={() => {
          setAdded({})
          setOperationError('')
          setPicker(true)
        }}
      >
        <Icon name="plus" size={18} />
        添加动作
      </button>
      <button className="phone-gym-tell" onClick={() => onTellAgnes?.()}>
        忘记记录了？告诉 Agnes 一次补记
        <Icon name="chevronRight" size={14} />
      </button>
      {picker && (
        <PhoneSheet
          title="添加动作"
          onClose={() => setPicker(false)}
          footer={
            <button className="phone-primary" onClick={() => setPicker(false)}>
              完成
              {Object.values(added).length > 0
                ? ` · 已添加 ${Object.values(added).reduce((sum, n) => sum + n, 0)} 个动作`
                : ''}
            </button>
          }
        >
          <p className="phone-picker-hint" role="status">
            点击动作加入训练，可连续添加。
          </p>
          {operationError && (
            <p className="phone-danger" role="alert">
              {operationError}
            </p>
          )}
          <div className="phone-picker-controls">
            <input
              className="phone-search"
              type="search"
              placeholder="搜索动作"
              aria-label="搜索动作"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className="phone-part-tabs">
              {[
                'all',
                'chest',
                'back',
                'legs',
                'shoulders',
                'core',
                'cardio',
              ].map((key) => (
                <button
                  key={key}
                  aria-pressed={part === key}
                  onClick={() => setPart(key)}
                >
                  {key === 'all' ? '全部' : t(`common.part.${key}`)}
                </button>
              ))}
            </div>
          </div>
          <div className="phone-exercise-library">
            {library.map((exercise: ExerciseRecord) => (
              <button
                key={exercise.id}
                disabled={busy}
                onClick={() =>
                  void perform(() =>
                    runtime.addGymItem(date, exercise.id),
                  ).then((ok) => {
                    if (ok)
                      setAdded((current) => ({
                        ...current,
                        [exercise.id]: (current[exercise.id] ?? 0) + 1,
                      }))
                  })
                }
              >
                <span>
                  <b>{exercise.name}</b>
                  <small>
                    {exercise.defaultSets}组 · {exercise.defaultReps}次
                    {exercise.equipment && ` · ${exercise.equipment}`}
                  </small>
                </span>
                {added[exercise.id] ? (
                  <span className="phone-picker-added">
                    <Icon name="check" size={14} />
                    已加入
                    {added[exercise.id]! > 1 ? ` ×${added[exercise.id]}` : ''}
                  </span>
                ) : (
                  <Icon name="plus" size={18} />
                )}
              </button>
            ))}
          </div>
          {!library.length && <p>没有匹配的动作，可以告诉 Agnes 添加训练。</p>}
        </PhoneSheet>
      )}
      {editing && (
        <PhoneSheet
          title={editing.name}
          onClose={() => setEditing(null)}
          footer={
            <button
              className="phone-primary"
              disabled={busy}
              onClick={() =>
                void perform(() =>
                  runtime.updateGymItem(date, editing.id, {
                    sets: Number(patch.sets),
                    reps: patch.reps,
                    weight: patch.weight,
                  }),
                ).then((ok) => {
                  if (ok) setEditing(null)
                })
              }
            >
              保存动作设置
            </button>
          }
        >
          <div className="phone-edit-fields">
            {operationError && (
              <p className="phone-danger" role="alert">
                {operationError}
              </p>
            )}
            <label>
              计划组数
              <input
                type="number"
                min={1}
                max={30}
                value={patch.sets}
                onChange={(event) =>
                  setPatch({ ...patch, sets: event.target.value })
                }
              />
            </label>
            <label>
              目标次数
              <input
                value={patch.reps}
                onChange={(event) =>
                  setPatch({ ...patch, reps: event.target.value })
                }
              />
            </label>
            <label>
              参考重量
              <input
                value={patch.weight}
                onChange={(event) =>
                  setPatch({ ...patch, weight: event.target.value })
                }
              />
            </label>
          </div>
          <div className="phone-gym-options">
            <button
              disabled={busy || session.items[0]?.id === editing.id}
              onClick={() => {
                const ids = session.items.map((i) => i.id),
                  i = ids.indexOf(editing.id)
                if (i > 0) {
                  ;[ids[i - 1], ids[i]] = [ids[i]!, ids[i - 1]!]
                  void perform(() => runtime.reorderGymItems(date, ids))
                }
              }}
            >
              向上移
            </button>
            <button
              disabled={busy || session.items.at(-1)?.id === editing.id}
              onClick={() => {
                const ids = session.items.map((i) => i.id),
                  i = ids.indexOf(editing.id)
                if (i < ids.length - 1) {
                  ;[ids[i + 1], ids[i]] = [ids[i]!, ids[i + 1]!]
                  void perform(() => runtime.reorderGymItems(date, ids))
                }
              }}
            >
              向下移
            </button>
            <button
              className="phone-danger"
              disabled={busy}
              onClick={() =>
                void perform(() =>
                  runtime.removeGymItem(date, editing.id),
                ).then((ok) => {
                  if (ok) setEditing(null)
                })
              }
            >
              移除此动作
            </button>
          </div>
        </PhoneSheet>
      )}
      {finish && (
        <PhoneSheet
          title="结束训练"
          onClose={() => setFinish(false)}
          footer={
            <button
              className="phone-primary"
              disabled={busy}
              onClick={() =>
                void perform(() => runtime.finishGym(date, null)).then((ok) => {
                  if (ok) setFinish(false)
                })
              }
            >
              结束并保存
            </button>
          }
        >
          {operationError && (
            <p className="phone-danger" role="alert">
              {operationError}
            </p>
          )}
          <p>
            已记录 {loggedSets(session.items)}{' '}
            组。每组实际重量与次数会保留；没有填写的组不会变成训练成绩。
          </p>
          <button
            className="phone-gym-tell"
            onClick={() => {
              setFinish(false)
              onTellAgnes?.()
            }}
          >
            还有漏记？告诉 Agnes
          </button>
        </PhoneSheet>
      )}
    </section>
  )
}
function MobileExercise({
  item,
  date,
  runtime,
  canLog,
  onEdit,
  onSaved,
}: {
  item: GymItemRecord
  date: string
  runtime: PageProps['runtime']
  canLog: boolean
  onEdit: () => void
  onSaved: () => void
}): JSX.Element {
  const unit =
    item.actualSets?.at(-1)?.unit ?? (/lb/i.test(item.weight) ? 'lb' : 'kg')
  const [reps, setReps] = useState(String(item.actualSets?.at(-1)?.reps ?? '')),
    [weight, setWeight] = useState(
      String(
        item.actualSets?.at(-1)?.weight ?? item.weight.replace(/kg|lb/gi, ''),
      ),
    ),
    [busy, setBusy] = useState(false)
  const id = useRef<string | null>(null)
  const record = async () => {
    const set = gymSetFromFields(reps, weight ? `${weight}${unit}` : '')
    if (!set) {
      runtime.notify('填写实际次数和重量，再记这一组。')
      return
    }
    setBusy(true)
    id.current ??= crypto.randomUUID()
    try {
      await runtime.call('gym.set.log', {
        date,
        itemId: item.id,
        set,
        requestId: id.current,
      })
      id.current = null
      onSaved()
      await runtime.refresh()
    } catch (error) {
      runtime.notify(String(error))
    } finally {
      setBusy(false)
    }
  }
  return (
    <article className="phone-exercise">
      <div className="phone-exercise-head">
        <button onClick={onEdit}>
          <b>{item.name}</b>
          <span>
            {item.sets}组 · {item.reps}次
          </span>
        </button>
        <span
          className="phone-exercise-count"
          data-complete={
            (item.actualSets?.length ?? 0) >= item.sets || undefined
          }
          aria-label={`已记录 ${item.actualSets?.length ?? 0} 组，共 ${item.sets} 组`}
        >
          {item.actualSets?.length ?? 0}/{item.sets}
        </span>
        <button aria-label={`调整${item.name}`} onClick={onEdit}>
          <Icon name="chevronDown" size={16} />
        </button>
      </div>
      <div className="phone-set-inputs">
        <label>
          <input
            type="text"
            inputMode="decimal"
            aria-label={`${item.name}实际重量`}
            placeholder="重量"
            value={weight}
            onChange={(event) => {
              setWeight(event.target.value)
              id.current = null
            }}
          />
          <span>{unit}</span>
        </label>
        <label>
          <input
            type="text"
            inputMode="numeric"
            aria-label={`${item.name}实际次数`}
            placeholder="次数"
            value={reps}
            onChange={(event) => {
              setReps(event.target.value)
              id.current = null
            }}
          />
          <span>次</span>
        </label>
        <button disabled={busy || !canLog} onClick={() => void record()}>
          {busy ? '保存…' : '+ 记一组'}
        </button>
      </div>
    </article>
  )
}
