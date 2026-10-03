import type { Context } from '@deepseek-ai/cordis'
import { runAgnesJson } from './agnesJson.ts'
import type { StructuredReviewRecord } from './domain.ts'
import { reviewSessionId } from './identity.ts'
import { fallbackStructured, parseStructuredReview } from './parser.ts'
import {
  buildProbePrompt,
  buildRepairPrompt,
  buildReviewPrompt,
  type ContextDay,
  type ContextPeriod,
  type ContextPractice,
  type ContextReading,
} from './prompt.ts'

export interface StructureOptions {
  readonly date: string
  readonly weekdayZh: string
  readonly rawText: string
  readonly usedPrompts: readonly string[]
  readonly snapshot: {
    readonly planned: number
    readonly done: number
    readonly ratio: number
    readonly gymDone: boolean
  }
  readonly completedTitles: readonly string[]
  readonly openTitles: readonly string[]
  /** Next 7 days with what is already planned, so Agnes does not duplicate it. */
  readonly upcoming: readonly ContextDay[]
  readonly periods: readonly ContextPeriod[]
  /** Learn-page items, so "读了 100 页" lands on the right book. */
  readonly reading: readonly ContextReading[]
  readonly practice: readonly ContextPractice[]
  readonly personalContext?: string
  readonly executionFeedback?: readonly { title:string; checked:boolean; progress?:number|undefined; note:string }[] | undefined
  readonly provider: string
  readonly model: string
  readonly agentPreset: string
  readonly timeoutMs: number
  readonly workspacePath: string
  readonly signal: AbortSignal
}

export interface StructureResult {
  readonly ok: boolean
  readonly structured: StructuredReviewRecord | null
  readonly error: { readonly code: string; readonly message: string } | null
}

function degrade(text: string, date: string, code: string, message: string): StructureResult {
  return {
    ok: false,
    structured: { ...fallbackStructured(text, date), tags: [] } as StructuredReviewRecord,
    error: { code, message },
  }
}

/**
 * Runs one Agnes turn in a throwaway, read-only, tool-less session.
 * Mirrors the battle-tested flow in dsh-cross-market-review's executor:
 * marker-delimited JSON, one automatic repair retry, and a rule-based fallback
 * so the user's own words are never lost.
 */
export async function structureReview(ctx: Context, options: StructureOptions): Promise<StructureResult> {
  const result = await runAgnesJson(
    ctx,
    {
      provider: options.provider,
      model: options.model,
      agentPreset: options.agentPreset,
      timeoutMs: options.timeoutMs,
      workspacePath: options.workspacePath,
      signal: options.signal,
      sessionId: reviewSessionId(options.date),
      label: '整理复盘',
    },
    {
      prompt: buildReviewPrompt({
        date: options.date,
        weekdayZh: options.weekdayZh,
        rawText: options.rawText,
        usedPrompts: options.usedPrompts,
        snapshot: options.snapshot,
        completedTitles: options.completedTitles,
        openTitles: options.openTitles,
        upcoming: options.upcoming,
        periods: options.periods,
        reading: options.reading,
        practice: options.practice,
        personalContext: options.personalContext,
        executionFeedback: options.executionFeedback,
      }),
      repair: buildRepairPrompt,
      parse: (text) => parseStructuredReview(text, options.date).structured,
    },
  )

  // A failed run still returns the rule-based fallback, so the user's own words
  // are never lost — only the field-by-field tidy-up is missing.
  if (result.ok) return { ok: true, structured: result.value, error: null }
  return degrade(options.rawText, options.date, result.code, result.message)
}

/** Cheap "does Agnes answer at all" probe, used by Settings. */
export async function probeAgnes(
  ctx: Context,
  options: {
    readonly provider: string
    readonly model: string
    readonly agentPreset: string
    readonly workspacePath: string
    readonly timeoutMs: number
  },
): Promise<{ readonly ok: boolean; readonly message: string; readonly ms: number }> {
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => {
    controller.abort()
  }, options.timeoutMs)
  try {
    const result = await structureReview(ctx, {
      date: new Date().toISOString().slice(0, 10),
      weekdayZh: '',
      rawText: buildProbePrompt(),
      usedPrompts: [],
      snapshot: { planned: 0, done: 0, ratio: 0, gymDone: false },
      completedTitles: [],
      openTitles: [],
      upcoming: [],
      periods: [],
      reading: [],
      practice: [],
      provider: options.provider,
      model: options.model,
      agentPreset: options.agentPreset,
      timeoutMs: options.timeoutMs,
      workspacePath: options.workspacePath,
      signal: controller.signal,
    })
    const ms = Date.now() - started
    if (result.ok) return { ok: true, message: 'Agnes 连通正常', ms }
    return { ok: false, message: result.error?.message ?? '调用失败', ms }
  } finally {
    clearTimeout(timer)
  }
}
