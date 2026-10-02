import type { Context } from '@deepseek-ai/cordis'
import { runAgnesJson } from './agnesJson.ts'
import type { RoutineRecord } from './domain.ts'
import { routinesSessionId } from './identity.ts'
import { parseRoutinesDraft, type RoutineDraft } from './parser.ts'
import { buildRoutinesPrompt, buildRoutinesRepairPrompt, type PeriodSlot } from './prompt.ts'

/**
 * Turning "I eat at 7, 12 and 6:40, and I'm at the gym Tuesday and Thursday
 * evenings" into blocks on a period grid.
 *
 * Only the model call lives here. The prompt is in prompt.ts and the parser is
 * in parser.ts, both dependency-free — so the part that is easy to get wrong
 * (mapping times to periods, rejecting nonsense) is unit-testable without a
 * DSH runtime. This module is the thin wrapper that needs one.
 */

export interface StructureRoutinesResult {
  readonly ok: boolean
  readonly routines: RoutineDraft[]
  readonly error: { readonly code: string; readonly message: string } | null
}

export async function structureRoutines(
  ctx: Context,
  options: {
    readonly description: string
    readonly periods: readonly PeriodSlot[]
    readonly existing: readonly RoutineRecord[]
    readonly termStart: string
    readonly provider: string
    readonly model: string
    readonly agentPreset: string
    readonly timeoutMs: number
    readonly workspacePath: string
    readonly signal: AbortSignal
  },
): Promise<StructureRoutinesResult> {
  const result = await runAgnesJson(
    ctx,
    {
      provider: options.provider,
      model: options.model,
      agentPreset: options.agentPreset,
      timeoutMs: options.timeoutMs,
      workspacePath: options.workspacePath,
      signal: options.signal,
      sessionId: routinesSessionId(),
      label: '整理固定安排',
    },
    {
      prompt: buildRoutinesPrompt({
        description: options.description,
        periods: options.periods,
        existing: options.existing,
        termStart: options.termStart,
      }),
      repair: buildRoutinesRepairPrompt,
      parse: parseRoutinesDraft,
    },
  )
  if (result.ok) return { ok: true, routines: result.value, error: null }
  return { ok: false, routines: [], error: { code: result.code, message: result.message } }
}
