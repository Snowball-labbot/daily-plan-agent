import type { Translate } from '../contracts.ts'
import { Icon } from '../icons.tsx'
import type { PlanState } from '../runtime.ts'
import { statusText } from './Nav.tsx'
import type { ReactNode } from 'react'

export interface TopBarProps {
  readonly t: Translate
  readonly state: PlanState
  readonly onClose: () => void
  readonly onRefresh: () => void
  readonly onToday: () => void
  readonly navigation?: ReactNode
}

const WEEKDAYS = '日一二三四五六'

export function todayStamp(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${month}-${day} 周${WEEKDAYS[now.getDay()] ?? ''}`
}

export function TopBar({ t, state, onClose, onRefresh, onToday, navigation }: TopBarProps): JSX.Element {
  return (
    <div className="dp-topbar">
      <button type="button" className="dp-btn dp-btn--ghost dp-btn--sm dp-shell-back" aria-label={t('shell.back')} title={t('shell.back')} onClick={onClose}>
        <Icon name="back" size={14} />
      </button>
      <span className="dp-topbar-title">{t('app.title')}</span>
      {navigation}
      <span className="dp-status" title={state.error ?? undefined}>
        <span className={`dp-dot is-${state.phase}`} aria-hidden="true" />
        {statusText(t, state)}
      </span>
      <button type="button" className="dp-btn dp-btn--ghost dp-btn--sm dp-shell-refresh" title={t('shell.refresh')} aria-label={t('shell.refresh')} onClick={onRefresh}>
        <Icon name="refresh" size={14} />
      </button>
      <button type="button" className="dp-btn dp-btn--ghost dp-btn--sm dp-shell-today" onClick={onToday}>
        {t('shell.today')}
      </button>
    </div>
  )
}
