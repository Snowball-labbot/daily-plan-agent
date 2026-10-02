import type { WorkflowRunRecord } from '../../domain.ts'

export interface WorkflowSource {
  text: string
  mode: WorkflowRunRecord['mode']
  today: string
  rangeStart: string
  rangeEnd: string
  planStart: string
  planEnd: string
}

export function workflowText(text: string, scope: string): string {
  if (!text.trim()) return text
  return scope === 'training' ? `请重点分析训练表现、进步和恢复，并联动后续安排。用户原文：\n${text}`
    : scope === 'learning' ? `请重点分析学习进度和下一步，并联动后续安排。用户原文：\n${text}` : text
}

/** rawText also contains the audit trail of row edits; it is not the composer source. */
export function workflowInputText(run: WorkflowRunRecord): string {
  return run.inputText ?? run.rawText.split('\n\n【用户手动微调，覆盖对应计划条目】\n')[0]!
}

/** An old preview must never become the submission for newly edited input. */
export function workflowSourceMatches(run: WorkflowRunRecord | null | undefined, source: WorkflowSource): boolean {
  if (!run || run.mode !== source.mode) return false
  if (workflowInputText(run).trim() !== source.text.trim() && !(run.status === 'applied' && !source.text.trim())) return false
  // Relative dates such as “明天” need a fresh interpretation after midnight.
  if (run.status !== 'applied' && run.date !== source.today) return false
  return source.mode === 'plan'
    ? run.planStart === source.planStart && run.planEnd === source.planEnd
    : run.rangeStart === source.rangeStart && run.rangeEnd === source.rangeEnd
}

export function workflowSubmission(run: WorkflowRunRecord | null | undefined, source: WorkflowSource, edited: boolean): 'generate' | 'apply' | 'save' {
  if (!workflowSourceMatches(run, source)) return 'generate'
  if (run?.status === 'ready') return 'apply'
  return run?.status === 'applied' && edited ? 'save' : 'generate'
}
