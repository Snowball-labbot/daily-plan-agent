import { useEffect, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { Translate } from '../contracts.ts'
import { PAGE_ORDER, type PageKey, type PlanState } from '../runtime.ts'
import { Icon } from '../icons.tsx'

export interface NavProps {
  readonly t: Translate
  readonly page: PageKey
  readonly onSelect: (page: PageKey) => void
}

export function Nav({ t, page, onSelect }: NavProps): JSX.Element {
  useEffect(() => {
    const tab = document.getElementById(`dp-tab-${page}`)
    const rail = tab?.closest('.dp-sidebar')
    if (!tab || !rail || rail.scrollWidth <= rail.clientWidth) return
    const target = tab.getBoundingClientRect(), viewport = rail.getBoundingClientRect()
    if (target.left < viewport.left) rail.scrollLeft += target.left - viewport.left - 10
    else if (target.right > viewport.right) rail.scrollLeft += target.right - viewport.right + 10
  }, [page])
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const tabs: PageKey[] = PAGE_ORDER.filter((key) => key !== 'review')
    const index = tabs.indexOf(page)
    const last = tabs.length - 1
    const focusTab = (target: PageKey): void => {
      onSelect(target)
      window.requestAnimationFrame(() => {
        document.getElementById(`dp-tab-${target}`)?.focus()
      })
    }
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault()
      focusTab(tabs[(index + 1) % tabs.length] ?? 'today')
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault()
      focusTab(tabs[(index + last) % tabs.length] ?? 'today')
    } else if (event.key === 'Home') {
      event.preventDefault()
      focusTab('today')
    } else if (event.key === 'End') {
      event.preventDefault()
      focusTab(tabs[last] ?? 'today')
    }
  }

  return (
    <nav className="dp-sidebar" aria-label="每日计划导航">
      <div className="dp-nav" role="tablist" aria-orientation="horizontal" aria-label={t('app.title')} onKeyDown={onKeyDown}>
      {PAGE_ORDER.filter((key) => key !== 'review').map((key) => (
        <button key={key} type="button" role="tab" id={`dp-tab-${key}`} className="dp-nav-item"
          aria-selected={page === key} aria-controls={`dp-panel-${key}`} tabIndex={page === key ? 0 : -1}
          onClick={() => onSelect(key)}>{t(`nav.${key}`)}</button>
      ))}
      </div>
      <button type="button" id="dp-review-trigger" className="dp-btn dp-btn--sm dp-agent-trigger" aria-haspopup="dialog" onClick={() => onSelect('review')}><Icon name="sparkle" size={14} />告诉 Agnes</button>
    </nav>
  )
}

export function statusText(t: Translate, state: PlanState): string {
  if (state.error !== null) return t('shell.offline')
  if (state.phase === 'ready') return t('shell.synced')
  return t('shell.syncing')
}
