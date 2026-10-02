import type { PageProps } from '../pages/types.ts'
import { Icon } from '../icons.tsx'

/** Show persisted actions, rather than presenting generated prose as execution. */
export function AgentActivity({ state, onTellAgnes }: Pick<PageProps, 'state' | 'onTellAgnes'>): JSX.Element | null {
  const context = state.snapshot?.workflow
  if (!context) return null
  const latest = [...context.recentFeedback, ...(context.latestRun ? [context.latestRun] : [])].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
  const applied = latest?.status === 'applied' ? latest : null
  const changes = applied?.appliedChanges ?? []
  const memory = context.memories[0]
  return <div className="dp-agent-activity" aria-label="Agnes 执行结果">
    <div className="dp-agent-activity-head"><Icon name="sparkle" size={14} /><b>{changes.length > 0 ? `Agnes 已落实 ${changes.length} 项变更` : '让 Agnes 接着安排'}</b>{applied && <small>{applied.date.slice(5)}</small>}<span className="dp-spacer" />{changes.length > 0 && <button type="button" onClick={() => onTellAgnes?.()}>查看详情<Icon name="chevronRight" size={12} /></button>}</div>
    {changes.length > 0 ? <div className="dp-agent-activity-lines">{changes.slice(0, 2).map((change, index) => <p key={index}><Icon name="check" size={12} />{change}</p>)}{memory && <p><Icon name="database" size={12} />已记住：{memory.text}</p>}</div> : <p className="dp-muted">说出进展或变化，补记学习与训练、维护任务池，再调整后续日程。</p>}
  </div>
}
