import { useEffect, useRef, useState } from 'react'
import type { GymSessionRecord } from '../../domain.ts'
import type { gymProgress } from '../../gym.ts'
import type { PageProps } from '../pages/types.ts'
import { ActualGymSets, GymTrends } from './ActualGym.tsx'

/** Training analytics and corrections live with records, away from workout planning. */
export function TrainingRecords({ state, runtime }: Pick<PageProps, 'state' | 'runtime'>): JSX.Element {
  const today = state.snapshot?.todayIso ?? ''
  const [date, setDate] = useState(today)
  const [groups, setGroups] = useState<ReturnType<typeof gymProgress>>([])
  const [session, setSession] = useState<GymSessionRecord | null>(null)
  const [error, setError] = useState<string | null>(null)
  const chooseInitialDate = useRef(true)
  useEffect(() => {
    let cancelled = false
    setSession(null)
    void Promise.all([runtime.call<ReturnType<typeof gymProgress>>('gym.performance', { date }), runtime.gymSession(date)])
      .then(([progress, record]) => {
        if (cancelled) return
        setGroups(progress); setSession(record); setError(null)
        if (chooseInitialDate.current) {
          chooseInitialDate.current = false
          const latest = progress.flatMap((group) => group.points.map((point) => point.date)).filter((day) => day <= today).sort().at(-1)
          if (latest && !record.items.some((item) => (item.actualSets?.length ?? 0) > 0)) setDate(latest)
        }
      })
      .catch((failure) => { if (!cancelled) setError(String(failure)) })
    return () => { cancelled = true }
  }, [date, runtime, today, state.snapshot?.nowIso])
  const dates = [...new Set(groups.flatMap((group) => group.points.map((point) => point.date)))].sort().reverse()
  return <div className="dp-training-records">
    <GymTrends groups={groups} />
    <div className="dp-btnrow"><b>训练明细</b><input type="date" aria-label="训练记录日期" max={today} value={date} onChange={(event) => { if (event.target.value) { chooseInitialDate.current = false; setDate(event.target.value) } }} />{dates.slice(0, 5).map((day) => <button type="button" className="dp-btn dp-btn--sm" key={day} onClick={() => { chooseInitialDate.current = false; setDate(day) }}>{day.slice(5)}</button>)}</div>
    {error && <div className="dp-error" role="alert">{error}</div>}
    {session && session.items.filter((item) => (item.actualSets?.length ?? 0) > 0).map((item) => <div className="dp-record-exercise" key={item.id}><b>{item.name}</b><ActualGymSets date={date} item={item} runtime={runtime} canLog={date <= today} /></div>)}
    {session && !session.items.some((item) => (item.actualSets?.length ?? 0) > 0) && <p className="dp-muted">这一天还没有组数记录。可在训练行里记录一组，或告诉 Agnes 补记。</p>}
  </div>
}
