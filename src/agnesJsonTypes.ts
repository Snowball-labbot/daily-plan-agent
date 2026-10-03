export interface AgnesJsonOptions {
  readonly provider: string
  readonly model: string
  readonly agentPreset: string
  readonly timeoutMs: number
  readonly workspacePath: string
  readonly signal: AbortSignal
  readonly sessionId: string
  readonly label: string
}

export interface AgnesJsonTurns<T> {
  readonly prompt: string
  readonly repair: (message: string) => string
  readonly parse: (text: string) => T
}

export type AgnesJsonResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: string; readonly message: string }
