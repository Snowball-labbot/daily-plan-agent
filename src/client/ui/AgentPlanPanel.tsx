import type { WorkflowDraftEdits, WorkflowRunRecord } from '../../domain.ts'
import type { AdaptiveResult } from '../../adaptive.ts'
import { formatHm, isoWeekKey, parseIsoDate } from '../../clock.ts'
import type { PlanSnapshot } from '../wire.ts'
import type { PlanRuntime } from '../runtime.ts'
import { Icon } from '../icons.tsx'
import { WorkflowDraftEditor } from './WorkflowDraftEditor.tsx'

/** One persistent plan surface: applying changes its status, not its layout. */
export function AgentPlanPanel({ run, busy, operation, dirty, allocation, context, runtime, onChange, onNavigate }: {
  run: WorkflowRunRecord | null; busy: boolean; dirty: boolean; allocation: AdaptiveResult | null;
  operation?: 'generating' | 'applying';
  context: PlanSnapshot['workflow']; runtime: PlanRuntime; onChange: (edits: WorkflowDraftEdits | null) => void;
  onNavigate?: (() => void) | undefined;
}): JSX.Element {
  const applied = run?.status === 'applied'
  const ready = run?.status === 'ready'
  const draft = run?.draft
  const hasRows = !!(draft?.tasks.length || draft?.appointments.length)
  return <section className="dp-agent-plan" aria-label="安排与记录" aria-busy={busy}>
    <div className="dp-agent-plan-head"><b>安排与记录</b><span role="status">{busy ? operation === 'applying' ? '正在应用…' : '正在整理…' : dirty ? '有修改未保存' : applied ? '已保存' : ready ? '待应用' : '说说你的安排'}</span>
      <button type="button" className="dp-btn dp-btn--ghost dp-btn--sm" onClick={() => { const date = draft?.appointments[0]?.date ?? run?.planStart; if (date) void runtime.setWeek(isoWeekKey(parseIsoDate(date))); runtime.setPage('week'); onNavigate?.() }}>看日程<Icon name="chevronRight" size={12} /></button>
    </div>
    <div className="dp-agent-plan-scroll">
      {draft && run && <>
        {hasRows && <WorkflowDraftEditor run={run} busy={busy || (!applied && (!!run.factsApplied || !!run.intentApplied))} onChange={onChange} />}
        {!hasRows && <p className="dp-agent-plan-empty">{applied ? '本次记录已保存。还想安排什么，继续在上方说就好。' : draft.summary}</p>}
        {draft.questions.length > 0 && <div className="dp-agent-plan-questions">{draft.questions.map((question, index) => <p key={index}>{question}</p>)}</div>}
        {(run.applyWarnings ?? []).map((warning, index) => <p className="dp-brief-warning" key={index}>{warning}</p>)}
        {!!allocation?.waiting.length && <details className="dp-agent-plan-detail"><summary>还有 {allocation.waiting.length} 项需要安排时间</summary>{allocation.waiting.map((item) => <p key={item.taskId}>{item.title}：{item.reason}</p>)}</details>}
        <details className="dp-agent-plan-detail"><summary>记录与调整详情<Icon name="chevronDown" size={12} /></summary>
          <p>{draft.summary}</p>
          {applied ? (run.appliedChanges ?? []).map((change, index) => <p key={index}>{change}</p>) : <>
            {draft.executions.length > 0 && <p>补记 {draft.executions.length} 项执行结果</p>}
            {draft.learningLogs.length > 0 && <p>同步 {draft.learningLogs.length} 条学习记录</p>}
            {draft.gymLogs.map((log) => <p key={log.date}>{log.date} 训练 · {log.exercises.reduce((sum, exercise) => sum + exercise.sets.length, 0)} 组实际数据</p>)}
            {draft.taskActions.map((action, index) => <p key={index}>更新任务：{context.tasks.find((task) => task.id === action.taskId)?.title} · {action.evidence}</p>)}
            {draft.activityLogs.map((item, index) => <p key={index}>{item.date} · {item.title}</p>)}
          </>}
          {draft.gymAdvice.map((advice, index) => <p key={`gym:${index}`}>{advice}</p>)}
          {draft.memories.map((memory, index) => <p key={`memory:${index}`}>记住了：{memory.text}</p>)}
          <div className="dp-result-links">{([['learn', '学习记录'], ['record', '训练记录'], ['setting', '个人记忆']] as const).map(([page, label]) => <button type="button" key={page} onClick={() => { if (page === 'record') runtime.setRecordView('training'); runtime.setPage(page); onNavigate?.() }}>{label}<Icon name="chevronRight" size={12} /></button>)}</div>
          <p className="dp-muted">原文：{run.rawText}</p>
        </details>
      </>}
      {!draft && <div className="dp-agent-plan-empty"><Icon name="week" size={20} /><p>说完近况或下一步，这里会整理出安排。</p><small>时间和描述都可以直接修改。</small></div>}
    </div>
  </section>
}
