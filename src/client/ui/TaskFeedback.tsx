import { useState } from 'react'
import type { PlanBlockRecord } from '../../domain.ts'
import type { PlanRuntime } from '../runtime.ts'
import { PhoneSheet } from './PhoneSheet.tsx'

export function TaskFeedback({
  date,
  block,
  runtime,
  onClose,
}: {
  date: string
  block: PlanBlockRecord
  runtime: PlanRuntime
  onClose: () => void
}): JSX.Element {
  const [note, setNote] = useState(block.executionNote ?? ''),
    [progress, setProgress] = useState(
      block.completionProgress === undefined ? '' : String(block.completionProgress),
    ),
    [done, setDone] = useState(block.done),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await runtime.call('plan.block.feedback', {
        date,
        blockId: block.id,
        note,
        progress: progress === '' ? null : Number(progress),
        done,
      })
      await runtime.refresh()
      onClose()
    } catch (failure) {
      setError(String(failure))
    } finally {
      setBusy(false)
    }
  }
  return (
    <PhoneSheet
      title={block.title}
      onClose={onClose}
      footer={
        <button className="phone-primary" disabled={busy} onClick={() => void save()}>
          {busy ? '保存…' : '保存记录'}
        </button>
      }
    >
      <div className="phone-edit-fields">
        <label className="phone-check-field">
          <input type="checkbox" checked={done} onChange={(event) => setDone(event.target.checked)} />
          这次已打卡
        </label>
        <label>
          目标完成度（可选）
          <div className="phone-progress-field">
            <input
              type="number"
              inputMode="numeric"
              min={0}
              max={100}
              placeholder="例如 60"
              aria-label="目标完成度"
              value={progress}
              onChange={(event) => setProgress(event.target.value)}
            />
            <span>%</span>
          </div>
        </label>
        <label>
          执行备注
          <textarea
            rows={4}
            placeholder="完成了哪些？卡在哪里？下次从哪里接着做？"
            maxLength={2000}
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>
        <small>打卡记录这次投入，完成度记录成果。Agnes 复盘时会一起参考。</small>
        {error && <p role="alert">{error}</p>}
      </div>
    </PhoneSheet>
  )
}
