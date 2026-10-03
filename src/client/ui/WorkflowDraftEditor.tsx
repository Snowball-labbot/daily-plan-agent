import { useEffect, useState } from 'react'
import type { WorkflowDraftEdits, WorkflowRunRecord } from '../../domain.ts'
import { formatHm } from '../../clock.ts'
import { PhoneSheet } from './PhoneSheet.tsx'
import { Icon } from '../icons.tsx'

type Row = { title: string; date: string; dueDate: string; start: string; end: string; note: string; timed: boolean }
const minute = (value: string): number | null => value ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : null
function initial(run: WorkflowRunRecord): { tasks: Row[]; appointments: Row[] } {
  return { tasks: (run.draft?.tasks ?? []).map((task) => ({ title: task.title, date: task.dueDate ?? run.planStart ?? run.date,
    dueDate: task.dueDate ?? '', start: '', end: '', note: task.note, timed: false })),
    appointments: (run.draft?.appointments ?? []).map((event) => ({ title: event.title, date: event.date, dueDate: '', start: formatHm(event.startMinute),
      end: formatHm(event.endMinute), note: event.note, timed: true })) }
}

/** Edits stay local until the user applies; no second model call is needed. */
export function WorkflowDraftEditor({ run, busy, onChange, mobile=false }: { run: WorkflowRunRecord; busy: boolean; onChange: (edits: WorkflowDraftEdits | null) => void; mobile?: boolean }): JSX.Element {
  const [rows, setRows] = useState(() => initial(run))
  const [selected,setSelected]=useState<{kind:'tasks'|'appointments';index:number}|null>(null)
  useEffect(() => { setRows(initial(run)); onChange(null) }, [run.id, run.updatedAt, onChange])
  const update = (kind: 'tasks' | 'appointments', index: number, patch: Partial<Row>): void => {
    const next = { ...rows, [kind]: rows[kind].map((row, i) => i === index ? { ...row, ...patch } : row) }
    setRows(next)
    if (JSON.stringify(next) === JSON.stringify(initial(run))) { onChange(null); return }
    onChange({ tasks: next.tasks.map((row, i) => ({ index: i, title: row.title, date: row.date, dueDate: row.dueDate || null,
      startMinute: row.timed ? minute(row.start) : null, endMinute: row.timed ? minute(row.end) : null, note: row.note })),
      appointments: next.appointments.map((row, i) => ({ index: i, title: row.title, date: row.date, startMinute: minute(row.start), endMinute: minute(row.end), note: row.note })) })
  }
  if(mobile) {
    const chosen=selected?rows[selected.kind][selected.index]:undefined
    const disabled=busy||(selected?.kind==='tasks'&&run.status==='applied')
    return <div className="phone-plan-list">{(['tasks','appointments']as const).flatMap(kind=>rows[kind].map((row,index)=><button key={`${kind}:${index}`} type="button" className="phone-plan-item" onClick={()=>setSelected({kind,index})}><span><b>{row.title}</b><small>{(row.timed?row.date:row.dueDate||row.date).slice(5)} · {row.timed?`${row.start}–${row.end}`:'弹性安排'}{row.note?' · 有备注':''}</small></span><Icon name="chevronRight" size={16}/></button>))}
      {chosen&&selected&&<PhoneSheet title="微调安排" onClose={()=>setSelected(null)} footer={<button className="phone-primary" onClick={()=>setSelected(null)}>完成编辑</button>}><div className="phone-edit-fields">
        <label>名称<input value={chosen.title} disabled={disabled} maxLength={200} onChange={event=>update(selected.kind,selected.index,{title:event.target.value})}/></label>
        <label>{chosen.timed?'日期':'截止日期'}<input type="date" value={chosen.timed?chosen.date:chosen.dueDate} disabled={disabled} min={run.planStart??run.date} max={run.planEnd} onChange={event=>update(selected.kind,selected.index,chosen.timed?{date:event.target.value}:{dueDate:event.target.value,date:event.target.value||run.planStart||run.date})}/></label>
        {selected.kind==='tasks'&&<label className="phone-check-field"><input type="checkbox" checked={chosen.timed} disabled={disabled} onChange={event=>update(selected.kind,selected.index,{timed:event.target.checked})}/>指定具体时段</label>}
        {chosen.timed&&<div className="phone-time-fields"><label>开始<input type="time" value={chosen.start} disabled={disabled} onChange={event=>update(selected.kind,selected.index,{start:event.target.value})}/></label><label>结束<input type="time" value={chosen.end} disabled={disabled} onChange={event=>update(selected.kind,selected.index,{end:event.target.value})}/></label></div>}
        <label>描述或地点<textarea rows={3} value={chosen.note} disabled={disabled} maxLength={1000} onChange={event=>update(selected.kind,selected.index,{note:event.target.value})}/></label>
        {disabled&&run.status==='applied'&&<small>此任务已进入任务池。要改变目标，继续告诉 Agnes 即可。</small>}
      </div></PhoneSheet>}
    </div>
  }
  return <div className="dp-draft-editor">{(['tasks', 'appointments'] as const).flatMap((kind) => rows[kind].map((row, index) => {
    const label = kind === 'tasks' ? `任务 ${index + 1}` : `活动 ${index + 1}`
    const disabled = busy || (kind === 'tasks' && run.status === 'applied')
    return <div className="dp-draft-edit-row" key={`${run.id}:${kind}:${index}`}>
      <input className="dp-draft-edit-title" aria-label={`${label}名称`} value={row.title} maxLength={200} disabled={disabled} onChange={(event) => update(kind, index, { title: event.target.value })} />
      <div className="dp-draft-edit-time">
        {row.timed ? <><input type="date" aria-label={`${label}日期`} value={row.date} min={run.planStart ?? run.date} max={run.planEnd} disabled={disabled} onChange={(event) => update(kind, index, { date: event.target.value })} /><input type="time" aria-label={`${label}开始时间`} value={row.start} disabled={disabled} onChange={(event) => update(kind, index, { start: event.target.value })} /><span>–</span><input type="time" aria-label={`${label}结束时间`} value={row.end} disabled={disabled} onChange={(event) => update(kind, index, { end: event.target.value })} />{kind === 'tasks' && <button type="button" disabled={disabled} onClick={() => update(kind, index, { timed: false, start: '', end: '' })}>弹性安排</button>}</> : <><span>截止</span><input type="date" aria-label={`${label}截止日期`} value={row.dueDate} disabled={disabled} onChange={(event) => update(kind, index, { dueDate: event.target.value, date: event.target.value || run.planStart || run.date })} /><button type="button" disabled={disabled} onClick={() => update(kind, index, { timed: true })}>指定时段</button></>}
      </div>
      <input className="dp-draft-edit-note" aria-label={`${label}备注`} placeholder="补充描述或地点（可选）" value={row.note} maxLength={1000} disabled={disabled} onChange={(event) => update(kind, index, { note: event.target.value })} />
      {row.timed && !row.end && <small>结束时间待补充，这项活动暂不写入日程。</small>}
    </div>
  }))}</div>
}
