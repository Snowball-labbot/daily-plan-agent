/**
 * The 8 preset colours a backlog item (and the block it becomes) can be tagged
 * with.
 *
 * Deliberately its own module with **no imports**: the client needs these keys
 * at runtime, and importing them from `domain.ts` would drag zod — and therefore
 * ~780KB — into the browser bundle.
 */
export const PICK_COLORS = [
  'blue',
  'indigo',
  'teal',
  'green',
  'amber',
  'orange',
  'rose',
  'slate',
] as const

export type PickColor = (typeof PICK_COLORS)[number]

export function isPickColor(value: unknown): value is PickColor {
  return typeof value === 'string' && (PICK_COLORS as readonly string[]).includes(value)
}
