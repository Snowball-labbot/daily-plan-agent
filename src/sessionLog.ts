/**
 * Reading a session's event log.
 *
 * Kept dependency-free (no `@deepseek-ai/*` imports) on purpose: this is where
 * the review pipeline broke, and a module that can only be exercised inside a
 * running DSH is a module that gets debugged in production.
 */

export interface SessionEvent {
  readonly seq: number
  readonly type: string
  readonly data: Record<string, any>
}

/**
 * The session's event log.
 *
 * `log` is what the Session class actually exposes — `log = []`, with
 * `get seq()` derived from its length (dsh-session/lib/index.js). `events` was
 * copied from another plugin's executor and **does not exist on this version**:
 * reading it threw `events is not iterable` on every run, which surfaced as
 * "整理失败" with a rule-based fallback, so the feature looked like Agnes was
 * refusing to work rather than like a one-word bug.
 *
 * Both names are tried so a rename in either direction cannot take it down
 * again, and `[]` is returned rather than throwing so the caller decides.
 */
export function sessionEvents(session: unknown): readonly SessionEvent[] {
  const candidate = session as { log?: unknown; events?: unknown } | null | undefined
  if (Array.isArray(candidate?.log)) return candidate.log as SessionEvent[]
  if (Array.isArray(candidate?.events)) return candidate.events as SessionEvent[]
  return []
}

export interface TurnText {
  readonly text: string
  readonly completed: boolean
}

/**
 * The assistant text produced since `firstSeq`, and whether the turn ended
 * normally.
 *
 * Only `assistant/message` events carry model output; `assistant/chunk` deltas
 * are storage-level packing, not something to concatenate. A turn that never
 * emitted `turn/end {reason:{kind:'completed'}}` counts as incomplete, which is
 * what makes a timeout or a cancellation surface as a failure instead of as an
 * empty reply.
 */
export function finalAssistantText(events: readonly SessionEvent[], firstSeq: number): TurnText {
  let text = ''
  let completed = false
  for (const event of events) {
    if (event.seq < firstSeq) continue
    if (event.type === 'assistant/message') {
      const content = event.data['message']?.content
      if (Array.isArray(content)) {
        const next = content
          .filter((block: any) => block?.type === 'text')
          .map((block: any) => String(block.text ?? ''))
          .join('')
        if (next !== '') text = next
      }
    }
    if (event.type === 'turn/end') completed = event.data['reason']?.kind === 'completed'
  }
  return { text, completed }
}
