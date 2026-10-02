import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

export interface PageShellProps {
  readonly title: ReactNode
  readonly sub?: ReactNode
  readonly actions?: ReactNode
  readonly children: ReactNode
}

export function PageShell({ title, sub, actions, children }: PageShellProps): JSX.Element {
  return (
    <div className="dp-page">
      <div className="dp-head">
        <div className="dp-head-copy"><h2>{title}</h2>
        {sub !== undefined && <span className="dp-muted">{sub}</span>}</div>
        <span className="dp-spacer" />
        {actions !== undefined && <div className="dp-head-actions">{actions}</div>}
      </div>
      {children}
    </div>
  )
}

export interface EmptyProps {
  readonly title?: string
  readonly hint?: string
  readonly action?: ReactNode
}

export function Empty({ title, hint, action }: EmptyProps): JSX.Element {
  return (
    <div className="dp-empty">
      {title !== undefined && <span>{title}</span>}
      {hint !== undefined && <small>{hint}</small>}
      {action}
    </div>
  )
}

export function Card({ children, className }: { readonly children: ReactNode; readonly className?: string }): JSX.Element {
  return <div className={className === undefined ? 'dp-card' : `dp-card ${className}`}>{children}</div>
}

export interface DraftInputProps {
  readonly id?: string
  readonly value: string
  readonly onCommit: (next: string) => void
  readonly className?: string
  readonly style?: CSSProperties
  readonly placeholder?: string
  readonly inputMode?: 'text' | 'numeric'
  readonly ariaLabel?: string
  readonly autoFocus?: boolean
  /** Fired on each edit so a form can enable its Save button before blur. */
  readonly onInput?: (next: string) => void
}

/**
 * Text field that keeps a local draft and only writes back on blur / Enter.
 * Settings inputs go straight to the host, and every write reloads the whole
 * snapshot — committing per keystroke makes typing a Chinese course name
 * unusable and hammers the storage layer.
 */
export function DraftInput({
  id,
  value,
  onCommit,
  className,
  style,
  placeholder,
  inputMode,
  ariaLabel,
  autoFocus,
  onInput,
}: DraftInputProps): JSX.Element {
  const [draft, setDraft] = useState(value)
  const [editing, setEditing] = useState(false)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  return (
    <input
      id={id}
      className={className}
      style={style}
      placeholder={placeholder}
      inputMode={inputMode}
      aria-label={ariaLabel}
      autoFocus={autoFocus === true}
      value={draft}
      onFocus={() => {
        setEditing(true)
      }}
      onChange={(event) => {
        setDraft(event.target.value)
        onInput?.(event.target.value)
      }}
      onBlur={(event) => {
        setEditing(false)
        if (draft !== value) onCommit(draft)
        event.currentTarget.blur()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          setDraft(value)
          event.currentTarget.blur()
        }
      }}
    />
  )
}

export interface StatProps {
  readonly label: string
  readonly value: ReactNode
  readonly accent?: boolean
}

export function Stat({ label, value, accent }: StatProps): JSX.Element {
  return (
    <div className={accent === true ? 'dp-stat is-accent' : 'dp-stat'}>
      <span className="dp-label">{label}</span>
      <b>{value}</b>
    </div>
  )
}

export function StatRow({ children }: { readonly children: ReactNode }): JSX.Element {
  return <div className="dp-stats">{children}</div>
}

/** Five-dot energy / mood / set logger. Clicking dot n means "n done". */
export function Dots({
  total,
  filled,
  onPick,
  label,
}: {
  readonly total: number
  readonly filled: number
  readonly onPick?: (value: number) => void
  readonly label?: string
}): JSX.Element {
  const interactive = onPick !== undefined
  return (
    <span
      className="dp-dots"
      role={interactive ? 'radiogroup' : undefined}
      aria-label={label}
    >
      {Array.from({ length: total }, (_, index) => {
        const value = index + 1
        const dot = <i className={value <= filled ? 'on' : ''}>{'\u25CF'}</i>
        if (!interactive) return <span key={value}>{dot}</span>
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={value === filled}
            aria-label={`${String(value)}`}
            style={{ color: 'inherit' }}
            onClick={() => {
              onPick(value === filled ? value - 1 : value)
            }}
          >
            {dot}
          </button>
        )
      })}
    </span>
  )
}
