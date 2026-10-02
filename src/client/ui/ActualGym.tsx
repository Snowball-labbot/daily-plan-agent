import { useRef, useState } from 'react'
import type { GymItemRecord } from '../../domain.ts'
import type { gymProgress } from '../../gym.ts'
import type { PlanRuntime } from '../runtime.ts'

export function ActualGymSets({ date, item, runtime, canLog }: { date: string; item: GymItemRecord; runtime: PlanRuntime; canLog: boolean }): JSX.Element {
  const [reps, setReps] = useState('')
  const [weight, setWeight] = useState('')
  const [rir, setRir] = useState('')
  const [unit, setUnit] = useState('kg')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestId = useRef<string | null>(null)
  const sets = item.actualSets ?? []
  const log = async (): Promise<void> => {
    if (reps.trim() === '' || !Number.isInteger(Number(reps)) || Number(reps) < 1) { setError('填实际完成的次数即可，重量可以留空。'); return }
    setBusy(true); setError(null)
    requestId.current ??= `set:${crypto.randomUUID()}`
    try {
      await runtime.call('gym.set.log', { date, itemId: item.id, requestId: requestId.current,
        set: { reps: Number(reps), weight: unit === 'bodyweight' || weight.trim() === '' ? null : Number(weight), unit,
          rir: rir.trim() === '' ? null : Number(rir) } })
      requestId.current = null; setReps(''); setRir(''); await runtime.refresh()
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(false) }
  }
  return <details className="dp-actual-sets">
    <summary>实际表现 · {sets.length > 0 ? `${sets.length} 组已记录` : '记录重量与次数'}</summary>
    {sets.length > 0 && <div className="dp-set-list">{sets.map((set, index) => <div className="dp-set-line" key={set.id}>
      <span>第 {index + 1} 组</span><b>{set.weight === null ? (set.unit === 'bodyweight' ? '自重' : '重量未记') : `${set.weight} ${set.unit}`} × {set.reps} 次</b>
      {set.rir !== null && <span className="dp-muted">还能做 {set.rir} 次</span>}
      <span className="dp-faint">{set.source === 'review' ? '文字补记' : '当场记录'}</span><span className="dp-spacer" />
      <button type="button" className="dp-btn dp-btn--sm dp-btn--ghost" aria-label={`删除${item.name}第${index + 1}组记录`} disabled={busy} onClick={() => {
        setBusy(true); setError(null)
        void runtime.call('gym.set.remove', { date, itemId: item.id, setId: set.id }).then(() => runtime.refresh())
          .catch((failure) => setError(String(failure))).finally(() => setBusy(false))
      }}>删除</button>
    </div>)}</div>}
    {canLog && <form className="dp-set-form" onSubmit={(event) => { event.preventDefault(); void log() }}>
      <input type="number" min="0" max="1000" step="0.5" aria-label={`${item.name}实际重量`} placeholder="实际重量" value={weight} disabled={busy || unit === 'bodyweight'} onChange={(event) => { setWeight(event.target.value); requestId.current = null }} />
      <select aria-label={`${item.name}重量单位`} value={unit} disabled={busy} onChange={(event) => { setUnit(event.target.value); requestId.current = null }}><option value="kg">kg</option><option value="lb">lb</option><option value="bodyweight">自重</option></select>
      <input type="number" min="1" max="500" aria-label={`${item.name}实际次数`} placeholder="实际次数" value={reps} disabled={busy} onChange={(event) => { setReps(event.target.value); requestId.current = null }} />
      <input type="number" min="0" max="10" step="0.5" aria-label={`${item.name}还能做几次`} placeholder="余力（可不填）" value={rir} disabled={busy} onChange={(event) => { setRir(event.target.value); requestId.current = null }} />
      <button className="dp-btn dp-btn--sm" type="submit" disabled={busy}>{busy ? '保存中…' : '记录这一组'}</button>
    </form>}
    {error && <div className="dp-error" role="alert">{error}</div>}
    <div className="dp-faint">忘记记录？在复盘中说出动作、重量和次数也能补记。</div>
  </details>
}

export function GymTrends({ groups }: { groups: ReturnType<typeof gymProgress> }): JSX.Element {
  return <div className="dp-card dp-gym-trends"><b>训练进步 · 来自实际记录</b>
    {groups.length === 0 ? <div className="dp-muted">记下每组次数与重量，或在复盘中说出来。计划重量和完成圆点不会变成训练成绩。</div> : groups.slice(0, 8).map((group) => {
      const points = group.points.slice(-6), latest = points.at(-1)!
      const weighted = points.every((point) => point.maxWeightKg !== null)
      const values = points.map((point) => weighted ? point.maxWeightKg! : point.reps)
      const min = Math.min(...values), max = Math.max(...values)
      const coords = values.map((value, index) => `${8 + index * 144 / Math.max(1, values.length - 1)},${36 - (value - min) / Math.max(1, max - min) * 28}`).join(' ')
      return <details key={group.exerciseId} className="dp-gym-trend"><summary><span>{group.name}</span>
        <svg viewBox="0 0 160 44" width="110" height="36" role="img" aria-label={`${group.name}${weighted ? '最大记录重量' : '总次数'}趋势，${points.length}次记录`}><polyline points={coords} fill="none" stroke="currentColor" strokeWidth="2" />{values.map((value, index) => <circle key={index} cx={8 + index * 144 / Math.max(1, values.length - 1)} cy={36 - (value - min) / Math.max(1, max - min) * 28} r="2.5" fill="currentColor" />)}</svg>
        <span className="dp-muted">{latest.date} · {latest.sets}组 / {latest.reps}次{latest.maxWeightKg === null ? '' : ` · 最大 ${latest.maxWeightKg}kg`}</span>
      </summary><div className="dp-faint">曲线：{weighted ? '每次训练最大记录重量（kg）' : '每次训练已记录总次数'}</div>
        <table className="dp-progress-table"><thead><tr><th>日期</th><th>实记组数</th><th>总次数</th><th>最大重量</th><th>实记总负荷</th></tr></thead><tbody>{points.map((point) => <tr key={point.date}><td>{point.date}</td><td>{point.sets}</td><td>{point.reps}</td><td>{point.maxWeightKg === null ? '未记 / 自重' : `${point.maxWeightKg}kg`}</td><td>{point.volumeKg === null ? '数据不全' : `${point.volumeKg}kg·次`}</td></tr>)}</tbody></table>
      </details>
    })}
    <div className="dp-faint">比较同一动作的重量和次数，并结合余力、动作质量及恢复情况；总负荷增加不直接等于力量提升。</div>
  </div>
}
