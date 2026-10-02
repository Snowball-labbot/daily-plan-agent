import { CoachDrawer } from '../ui/CoachDrawer.tsx'
import { useEffect, useRef, useState } from 'react'
import type { Translate } from '../contracts.ts'
import { DragLayer, cancelActiveDrag } from '../drag/DragLayer.tsx'
import { PAGE_ORDER, focusMemory, usePlanState, type PageKey, type PlanRuntime } from '../runtime.ts'
import { GymPage } from '../pages/Gym.tsx'
import { LearnPage } from '../pages/Learn.tsx'
import { RecordPage } from '../pages/Record.tsx'
import { ReviewPage } from '../pages/Review.tsx'
import { SettingsPage } from '../pages/Settings.tsx'
import { TodayPage } from '../pages/Today.tsx'
import { WeekPage } from '../pages/Week.tsx'
import type { PageProps } from '../pages/types.ts'
import { Nav } from './Nav.tsx'
import { TopBar } from './TopBar.tsx'

const PAGES: Record<PageKey, (props: PageProps) => JSX.Element> = {
  today: TodayPage,
  week: WeekPage,
  gym: GymPage,
  learn: LearnPage,
  review: ReviewPage,
  record: RecordPage,
  setting: SettingsPage,
}

export interface RootProps {
  readonly t: Translate
  readonly runtime: PlanRuntime
}

/**
 * The overlay root. Registered into `shell.overlay`, whose layer is
 * `pointer-events:none` with `> * { pointer-events:auto }` — so while closed we
 * must render nothing at all, otherwise our empty container would keep eating
 * clicks meant for DSH.
 */
export function Root({ t, runtime }: RootProps): JSX.Element | null {
  const state = usePlanState(runtime)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const open = state.open
  const page = state.page
  const [coachOpen, setCoachOpen] = useState(false)
  const [composeRequest, setComposeRequest] = useState<{ id: string; text: string; date?: string } | undefined>()
  const tellAgnes = (text?: string): void => {
    if (text?.trim()) setComposeRequest({ id: crypto.randomUUID(), text: text.trim(), ...(state.snapshot ? { date: state.snapshot.todayIso } : {}) })
    setCoachOpen(true)
  }
  useEffect(() => { setCoachOpen(false) }, [page, open])
  useEffect(() => { const main = rootRef.current?.querySelector('.dp-main'); if (coachOpen) main?.setAttribute('inert', ''); else main?.removeAttribute('inert') }, [coachOpen])
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0 }, [page])
  const firedReminders = useRef<Set<string>>(new Set())

  // Warm the snapshot at start-up: the sidebar launcher then feels instant, and
  // the reminders below have something to reason about before the panel opens.
  useEffect(() => {
    void runtime.refresh()
  }, [runtime])

  /**
   * Reminders are client-side polling on purpose: this DSH build exposes no
   * public host→renderer push channel, so DSH has to be open for them to fire.
   * The Settings page says so plainly.
   */
  useEffect(() => {
    const snapshot = state.snapshot
    if (snapshot === null) return
    const check = (): void => {
      const reminder = snapshot.settings.reminder
      if (!reminder.enabled) return
      const now = new Date()
      const pad = (value: number): string => String(value).padStart(2, '0')
      const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`
      const today = `${String(now.getFullYear())}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
      const weekday = ((now.getDay() + 6) % 7) + 1

      if (hm === reminder.reviewTime) {
        const key = `review:${today}`
        if (!firedReminders.current.has(key)) {
          firedReminders.current.add(key)
          const written =
            snapshot.todayReview !== null && snapshot.todayReview.raw.text.trim() !== ''
          if (!written) runtime.notify(t('reminder.review'))
        }
      }
      if (hm === reminder.weeklyPlanTime && weekday === reminder.weeklyPlanWeekday) {
        const key = `plan:${today}`
        if (!firedReminders.current.has(key)) {
          firedReminders.current.add(key)
          runtime.notify(t('reminder.weekly'))
        }
      }
    }
    check()
    const timer = setInterval(check, 30_000)
    return () => {
      clearInterval(timer)
    }
  }, [state.snapshot, runtime, t])

  useEffect(() => {
    if (!open) return
    const previous = document.documentElement.style.overflow
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.documentElement.style.overflow = previous
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      const withModifier = event.metaKey || event.ctrlKey
      if (withModifier && event.key >= '1' && event.key <= '7') {
        event.preventDefault()
        const next = PAGE_ORDER[Number(event.key) - 1] ?? 'today'
        if (next === 'review') setCoachOpen(true); else runtime.setPage(next)
        return
      }
      if (event.key === 'Escape') {
        if ((event.target as Element | null)?.closest?.('.dp-inline-input,.dp-agenda-add,.dp-agent-inline textarea')) return
        // Capture phase + stopPropagation keeps DSH from also acting on Esc.
        event.preventDefault()
        event.stopPropagation()
        if (cancelActiveDrag()) return
        const coachClose = rootRef.current?.querySelector<HTMLButtonElement>('[data-coach-open="true"] [data-coach-close]')
        if (coachClose) { coachClose.click(); return }
        if (page !== 'today') runtime.setPage('today')
        else runtime.close()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open, page, runtime])

  useEffect(() => {
    if (!open) return
    rootRef.current?.focus()
    return () => {
      focusMemory.current?.focus()
    }
  }, [open])

  if (!open) {
    // Still surface toasts while closed (reminders), but never let the wrapper
    // swallow clicks meant for DSH — overlay children default to pointer-events:auto.
    if (state.toast === null) return null
    return (
      <div className="dp-root dp-root--bare" data-dsh-plugin="dsh-daily-plan" aria-hidden="true">
        <div className="dp-toast">{state.toast}</div>
      </div>
    )
  }

  const Current = PAGES[page]

  return (
    <div
      className="dp-root"
      ref={rootRef}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label={t('app.title')}
      data-dsh-plugin="dsh-daily-plan"
      data-dsh-part="overlay"
      data-page={page}
    >
      <span className="dp-sr" aria-live="polite" />
      <div className="dp-main">
      <TopBar
        t={t}
        state={state}
        onClose={() => {
          runtime.close()
        }}
        onRefresh={() => {
          void runtime.refresh()
        }}
        onToday={() => {
          runtime.setPage('today')
        }}
        navigation={<Nav t={t} page={page === 'review' ? 'record' : page} onSelect={(next) => { if (next === 'review') tellAgnes(); else runtime.setPage(next) }} />}
      />
      <div className="dp-body dp-scroll" ref={bodyRef}>
        {state.error !== null && (
          <div className="dp-page" style={{ paddingBottom: 0 }}>
            <div className="dp-error" role="alert">
              {state.error}
            </div>
          </div>
        )}
        <div
          id={`dp-panel-${page === 'review' ? 'record' : page}`}
          role="tabpanel"
          aria-labelledby={`dp-tab-${page === 'review' ? 'record' : page}`}
          tabIndex={-1}
        >
          {state.snapshot !== null && (!state.snapshot.workflow?.recentDays || !state.snapshot.settings.planning) ? (
            <div className="dp-page"><p>新版本已安装。请重启 DSH，加载新的计划引擎后继续使用。</p></div>
          ) : <Current t={t} state={state} runtime={runtime} onTellAgnes={tellAgnes} />}
        </div>
      </div>
      </div>
      <CoachDrawer state={state} runtime={runtime} composeRequest={composeRequest} open={coachOpen} onClose={() => setCoachOpen(false)} />
      {state.toast !== null && <div className="dp-toast">{state.toast}</div>}
      <DragLayer />
    </div>
  )
}
