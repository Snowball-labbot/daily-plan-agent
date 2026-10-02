import { useEffect, useRef, useState } from 'react'
import { isoWeekKey, parseIsoDate } from '../../clock.ts'
import { Icon } from '../icons.tsx'
import { WorkflowPanel } from './WorkflowPanel.tsx'

/** One review entry across every page; drafts and requests stay mounted. */
export function CoachDrawer({ open, onClose, ...props }: Parameters<typeof WorkflowPanel>[0] & { open: boolean; onClose: () => void }): JSX.Element {
  const panel = useRef<HTMLElement | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const [end, setEnd] = useState(props.state.snapshot?.todayIso ?? '')
  const [planning, setPlanning] = useState(false)
  useEffect(() => { if (!end && props.state.snapshot?.todayIso) setEnd(props.state.snapshot.todayIso) }, [end, props.state.snapshot?.todayIso])
  useEffect(() => { if (props.composeRequest?.date) setEnd(props.composeRequest.date) }, [props.composeRequest?.id])
  useEffect(() => {
    if (!open) return
    previousFocus.current = document.activeElement as HTMLElement
    setEnd(props.state.snapshot?.todayIso ?? '')
    const frame = requestAnimationFrame(() => panel.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus())
    return () => { cancelAnimationFrame(frame); previousFocus.current?.focus({ preventScroll: true }) }
  }, [open])
  return <div className="dp-coach-overlay" hidden={!open} data-coach-open={open ? 'true' : undefined} onPointerDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <aside className={`dp-coach-drawer dp-scroll${props.mobile?' phone-coach-drawer':''}`} ref={panel} role="dialog" aria-modal="true" aria-label="复盘与联动安排" onKeyDown={(event) => {
      if (event.key !== 'Tab') return
      const nodes = [...(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),textarea:not(:disabled),input:not(:disabled),select:not(:disabled),summary') ?? [])].filter((node) => node.getClientRects().length > 0)
      const first = nodes[0], last = nodes.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
      <header>{!props.mobile&&<Icon name="sparkle" size={18} />}<div><b>告诉 Agnes</b><small>复盘或展望，记录和计划一起更新</small></div><span className="dp-spacer" /><label hidden={planning||props.mobile}>截至 <input type="date" aria-label="复盘截止日期" value={end} max={props.state.snapshot?.todayIso} onChange={(event) => { if (event.target.value) setEnd(event.target.value) }} /></label><button type="button" className="dp-btn dp-btn--sm dp-btn--ghost" aria-label="关闭复盘" data-coach-close onClick={onClose}><Icon name={props.mobile?'chevronLeft':'close'} size={props.mobile?22:17} /></button></header>
      {end && <WorkflowPanel {...props} weekKey={isoWeekKey(parseIsoDate(end))} reportEnd={end} onReportEndChange={setEnd} onNavigate={onClose} compact unified onPlanningChange={setPlanning} />}
    </aside>
  </div>
}
