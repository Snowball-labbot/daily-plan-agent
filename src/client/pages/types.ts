import type { Translate } from '../contracts.ts'
import type { PageKey, PlanRuntime, PlanState } from '../runtime.ts'

export interface PageProps {
  readonly t: Translate
  readonly state: PlanState
  readonly runtime: PlanRuntime
  readonly onTellAgnes?: ((text?: string) => void) | undefined
}

export type { PageKey }
