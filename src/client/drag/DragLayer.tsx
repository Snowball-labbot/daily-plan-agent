import { useCallback, useEffect, useSyncExternalStore } from 'react'
import type { BodyPartValue, CategoryValue } from '../../domain.ts'

/**
 * Hand-rolled Pointer Events drag engine, shared by the Week grid and the Gym
 * builder.
 *
 * Why no dnd-kit: both drag shapes here are simple (drop into a snapping grid,
 * reorder one list), and every drag also has a click-equivalent fallback, so a
 * 60-90KB dependency would be dead weight.
 *
 * Two rules that matter:
 *  1. `pointermove` never calls setState. It writes the ghost's transform
 *     directly and only publishes when the *hovered zone* changes — otherwise
 *     the 84-cell grid would re-render 60 times a second.
 *  2. Drop zones are declared in the DOM (`data-drop`, `data-drop-meta`,
 *     `data-drop-accept`), so a whole grid costs zero registrations. The page
 *     installs one handler with `useDropHandler`.
 */

export type DragPayload =
  | {
      readonly kind: 'backlog'
      readonly id: string
      readonly title: string
      readonly category: CategoryValue
      readonly estimatePeriods: number
    }
  | {
      readonly kind: 'block'
      readonly date: string
      readonly blockId: string
      readonly title: string
      readonly category: CategoryValue
      readonly length: number
    }
  | {
      readonly kind: 'gym-exercise'
      readonly exerciseId: string
      readonly name: string
      readonly part: BodyPartValue
    }
  | {
      readonly kind: 'gym-reorder'
      readonly date: string
      readonly itemId: string
      readonly name: string
    }

export type DropHandler = (payload: DragPayload, meta: unknown, zoneId: string) => void

export interface DragState {
  readonly payload: DragPayload | null
  readonly zoneId: string | null
  readonly zoneMeta: unknown
  readonly hint: string | null
}

interface Hit {
  readonly id: string
  readonly meta: unknown
  readonly accepts: readonly string[]
  readonly hint: string | null
}

const NO_DRAG: DragState = { payload: null, zoneId: null, zoneMeta: null, hint: null }

let state: DragState = NO_DRAG
const listeners = new Set<() => void>()
let dropHandler: DropHandler | null = null
let ghostEl: HTMLDivElement | null = null
let moveFrame = 0
let scrollFrame = 0
let scrollDirection = 0
let scrollContainer: Element | null = null

function publish(next: DragState): void {
  state = next
  for (const listener of listeners) listener()
}

function getState(): DragState {
  return state
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useDragState(): DragState {
  return useSyncExternalStore(subscribe, getState, getState)
}

export function setGhostElement(element: HTMLDivElement | null): void {
  ghostEl = element
}

/**
 * Repaint the ghost at the current pointer position.
 *
 * Needed because the ghost is mounted by React *after* the first `paintGhost`
 * call (that one runs before the state update lands), so without a repaint at
 * attach time it would sit at its static top-left corner until the next
 * pointermove — which reads as "the card jumped to the corner instead of
 * following my finger".
 */
export function refreshGhost(): void {
  paintGhost(pointer.x, pointer.y)
}

/** The active page installs its single drop handler here. */
export function useDropHandler(handler: DropHandler | null): void {
  useEffect(() => {
    dropHandler = handler
    return () => {
      if (dropHandler === handler) dropHandler = null
    }
  }, [handler])
}

const DRAG_THRESHOLD_PX = 6

interface Session {
  readonly payload: DragPayload
  readonly startX: number
  readonly startY: number
  active: boolean
}

let session: Session | null = null
let pointer = { x: 0, y: 0 }
let lastDragEndedAt = 0

/**
 * True right after a real drag finished. Click handlers guard on this so a drop
 * never also triggers the click action (toggling a block, appending an exercise).
 */
export function draggedRecently(): boolean {
  return Date.now() - lastDragEndedAt < 300
}

function hitAt(x: number, y: number): Hit | null {
  const element = document.elementFromPoint(x, y)
  const holder = element?.closest('[data-drop]')
  if (holder === null || holder === undefined) return null
  const id = holder.getAttribute('data-drop')
  if (id === null || id === '') return null
  const accept = (holder.getAttribute('data-drop-accept') ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
  const rawMeta = holder.getAttribute('data-drop-meta')
  let meta: unknown = null
  if (rawMeta !== null) {
    try {
      meta = JSON.parse(rawMeta) as unknown
    } catch {
      meta = null
    }
  }
  const row = holder.getAttribute('data-drop-row')
  if (row !== null) {
    const rect = holder.getBoundingClientRect()
    const index = Number(row) + (y > rect.top + rect.height / 2 ? 1 : 0)
    return { id: `g:${index}`, meta: { index }, accepts: accept, hint: null }
  }
  return { id, meta, accepts: accept, hint: holder.getAttribute('data-drop-hint') }
}

function accepts(hit: Hit, payload: DragPayload): boolean {
  // An empty accept list means "anything" — handy for ad-hoc zones.
  return hit.accepts.length === 0 || hit.accepts.includes(payload.kind)
}

function paintGhost(x: number, y: number): void {
  if (ghostEl === null) return
  ghostEl.style.transform = `translate3d(${String(x + 14)}px, ${String(y + 12)}px, 0) rotate(1.5deg) scale(1.03)`
}

function stopAutoScroll(): void {
  if (scrollFrame !== 0) {
    cancelAnimationFrame(scrollFrame)
    scrollFrame = 0
  }
  scrollDirection = 0
  scrollContainer = null
}

function tickAutoScroll(): void {
  if (scrollContainer === null || scrollDirection === 0) {
    stopAutoScroll()
    return
  }
  scrollContainer.scrollBy(0, scrollDirection)
  scrollFrame = requestAnimationFrame(tickAutoScroll)
}

/** Nudge the nearest registered scroll container when the pointer nears its edge. */
function autoScroll(x: number, y: number): void {
  const element = document.elementFromPoint(x, y)
  const container = element?.closest('[data-drag-scroll]') ?? null
  if (container === null) {
    stopAutoScroll()
    return
  }
  const rect = container.getBoundingClientRect()
  const margin = 56
  const direction = y < rect.top + margin ? -10 : y > rect.bottom - margin ? 10 : 0
  if (direction === 0) {
    stopAutoScroll()
    return
  }
  if (scrollFrame !== 0 && scrollContainer === container && scrollDirection === direction) return
  stopAutoScroll()
  scrollContainer = container
  scrollDirection = direction
  scrollFrame = requestAnimationFrame(tickAutoScroll)
}

function detach(): void {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerCancel)
  window.removeEventListener('keydown', onKeyDown, true)
  document.body.style.removeProperty('cursor')
}

export function cancelActiveDrag(): boolean {
  if (session === null) return false
  finish(false)
  return true
}

function finish(commit: boolean): void {
  const current = session
  const payload = state.payload
  const hit = state.zoneId === null ? null : hitAt(pointer.x, pointer.y)
  session = null
  if (current?.active === true) lastDragEndedAt = Date.now()
  stopAutoScroll()
  if (moveFrame !== 0) {
    cancelAnimationFrame(moveFrame)
    moveFrame = 0
  }
  detach()
  publish(NO_DRAG)
  if (ghostEl !== null) ghostEl.style.removeProperty('transform')

  if (current === null || !commit || payload === null || hit === null || !accepts(hit, payload)) return
  dropHandler?.(payload, hit.meta, hit.id)
}

function onPointerMove(event: PointerEvent): void {
  const current = session
  if (current === null) return
  pointer = { x: event.clientX, y: event.clientY }

  if (!current.active) {
    const moved = Math.hypot(event.clientX - current.startX, event.clientY - current.startY)
    if (moved < DRAG_THRESHOLD_PX) return
    current.active = true
    document.body.style.cursor = 'grabbing'
    paintGhost(pointer.x, pointer.y)
    publish({ payload: current.payload, zoneId: null, zoneMeta: null, hint: null })
  }

  if (moveFrame !== 0) return
  moveFrame = requestAnimationFrame(() => {
    moveFrame = 0
    paintGhost(pointer.x, pointer.y)
    autoScroll(pointer.x, pointer.y)
    const hit = hitAt(pointer.x, pointer.y)
    const valid = hit !== null && accepts(hit, current.payload) ? hit : null
    if ((valid?.id ?? null) !== state.zoneId) {
      publish({
        payload: current.payload,
        zoneId: valid?.id ?? null,
        zoneMeta: valid?.meta ?? null,
        hint: valid?.hint ?? null,
      })
    }
  })
}

function onPointerUp(): void {
  if (session !== null) finish(true)
}

function onPointerCancel(): void {
  if (session !== null) finish(false)
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || session === null) return
  event.preventDefault()
  event.stopPropagation()
  finish(false)
}

/**
 * Begin a drag from `onPointerDown`. Releasing before the 6px threshold leaves
 * the ordinary click path untouched, so click still means click.
 */
export function startDrag(event: React.PointerEvent | PointerEvent, payload: DragPayload): void {
  if (event.button !== 0) return
  session = { payload, startX: event.clientX, startY: event.clientY, active: false }
  pointer = { x: event.clientX, y: event.clientY }
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
  window.addEventListener('keydown', onKeyDown, true)
}

/** The ghost. Lives inside the overlay root, so it needs no portal. */
export function DragLayer(): JSX.Element | null {
  const drag = useDragState()

  // A ref *callback* rather than useRef + useEffect: it runs during the commit
  // phase, so the ghost is positioned in the same frame it first appears.
  const attach = useCallback((element: HTMLDivElement | null) => {
    setGhostElement(element)
    if (element !== null) refreshGhost()
  }, [])

  if (drag.payload === null) return null
  const label = drag.payload.kind === 'gym-exercise' || drag.payload.kind === 'gym-reorder'
    ? drag.payload.name
    : drag.payload.title
  const category =
    drag.payload.kind === 'gym-exercise' || drag.payload.kind === 'gym-reorder'
      ? 'gym'
      : drag.payload.category
  return (
    <div ref={attach} className="dp-ghost" data-cat={category} aria-hidden="true">
      <GripIcon />
      <span className="dp-block-title">{label}</span>
    </div>
  )
}

export function GripIcon({ size = 14 }: { readonly size?: number }): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden="true">
      <circle cx="9" cy="6" r="1.6" />
      <circle cx="9" cy="12" r="1.6" />
      <circle cx="9" cy="18" r="1.6" />
      <circle cx="15" cy="6" r="1.6" />
      <circle cx="15" cy="12" r="1.6" />
      <circle cx="15" cy="18" r="1.6" />
    </svg>
  )
}
