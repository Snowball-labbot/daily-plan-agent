/**
 * Deterministic ids. Idempotency of `plan.generate-week` and `plan.rollforward`
 * depends entirely on these being pure functions of their inputs.
 */

/** Non-cryptographic FNV-1a, 8 hex chars. */
export function stableHash(input: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

let counter = 0

export function newId(prefix = 'b'): string {
  const api = globalThis.crypto
  if (api !== undefined && typeof api.randomUUID === 'function') {
    return `${prefix}_${api.randomUUID()}`
  }
  counter += 1
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`
}

/**
 * `ctx.storageDomain` with `layout: 'per-record'` turns a record key into a file
 * name and rejects anything outside /^[a-zA-Z0-9_-]+$/:
 *
 *   unit 'dsh_daily_plan': per-record key 'x_chest_杠铃卧推' is not path-safe
 *
 * Learned the hard way — a Chinese exercise id made every seeded write throw, so
 * the gym library stayed empty with no visible error. Anything used as a
 * **table key** must pass this. In-record ids (block ids, log ids) are exempt,
 * because they live inside a record's JSON rather than becoming a file name.
 */
export function isPathSafeKey(key: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(key)
}

/** Block materialised from the timetable. Re-running generate-week is a no-op. */
export function generatedBlockId(courseId: string, date: string, startPeriod: number): string {
  return `g:${courseId}:${date}:${startPeriod}`
}

/** Block created by a carried-over item. Re-confirming carry-over adds nothing. */
export function carryBlockId(sourceBlockId: string | null, title: string, targetDate: string): string {
  const anchor = sourceBlockId !== null && sourceBlockId !== '' ? sourceBlockId : `h${stableHash(title)}`
  return `carry:${anchor.replace(/[:]/g, '_')}:${targetDate}`
}

/** Block materialised from a standing weekly routine. Re-generating is a no-op. */
export function routineBlockId(routineId: string, date: string): string {
  return `routine:${routineId}:${date}`
}

/** Fresh id for each Agnes run — a JSONL session log can never be reused. */
export function routinesSessionId(): string {
  return `dsh-daily-plan-routines-${String(Date.now())}-${stableHash(String(Math.random()))}`
}

export function reviewSessionId(date: string): string {
  return `dsh-daily-plan-review-${date}-${String(Date.now())}-${stableHash(date + String(Math.random()))}`
}
