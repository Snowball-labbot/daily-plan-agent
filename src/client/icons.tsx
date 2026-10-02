import type { ReactNode } from 'react'

export type IconName =
  | 'today'
  | 'week'
  | 'gym'
  | 'review'
  | 'record'
  | 'setting'
  | 'back'
  | 'refresh'
  | 'plus'
  | 'minus'
  | 'trash'
  | 'close'
  | 'check'
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronDown'
  | 'grip'
  | 'clock'
  | 'sparkle'
  | 'warn'
  | 'list'
  | 'target'
  | 'flame'
  | 'bell'
  | 'database'
  | 'import'
  | 'export'
  | 'reorder'

/**
 * Hand-rolled Lucide-style set. We deliberately do not import the built-in icon
 * components: their prop contract is unverified on this DSH build, and a bad
 * require would take the whole plugin down at boot. 24px grid, 1.8 stroke,
 * currentColor — the same rules the rest of the app follows.
 */
const PATHS: Record<IconName, ReactNode> = {
  today: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <path d="m9 15 2 2 4-4" />
    </>
  ),
  week: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <path d="M7.5 14h3M13.5 14h3M7.5 17.5h3M13.5 17.5h3" />
    </>
  ),
  gym: (
    <>
      <path d="M6.5 6.5v11M3.5 9v5M17.5 6.5v11M20.5 9v5M6.5 12h11" />
    </>
  ),
  review: (
    <>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </>
  ),
  record: (
    <>
      <rect x="3" y="3" width="4.4" height="4.4" rx="1" />
      <rect x="9.8" y="3" width="4.4" height="4.4" rx="1" />
      <rect x="16.6" y="3" width="4.4" height="4.4" rx="1" />
      <rect x="3" y="9.8" width="4.4" height="4.4" rx="1" />
      <rect x="9.8" y="9.8" width="4.4" height="4.4" rx="1" />
      <rect x="16.6" y="9.8" width="4.4" height="4.4" rx="1" />
      <rect x="3" y="16.6" width="4.4" height="4.4" rx="1" />
      <rect x="9.8" y="16.6" width="4.4" height="4.4" rx="1" />
      <rect x="16.6" y="16.6" width="4.4" height="4.4" rx="1" />
    </>
  ),
  setting: (
    <>
      <path d="M4 6h9M18.5 6H20M4 12h4M13.5 12H20M4 18h9M18.5 18H20" />
      <circle cx="15.5" cy="6" r="2.2" />
      <circle cx="10.8" cy="12" r="2.2" />
      <circle cx="15.5" cy="18" r="2.2" />
    </>
  ),
  back: <path d="M19 12H5m0 0 7-7m-7 7 7 7" />,
  refresh: (
    <>
      <path d="M20.5 12a8.5 8.5 0 1 1-2.5-6" />
      <path d="M20.5 3.5v5h-5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  trash: (
    <>
      <path d="M3.5 6h17M9 6V4h6v2" />
      <path d="M18.5 6 17.5 20h-11L5.5 6" />
      <path d="M10 10.5v6M14 10.5v6" />
    </>
  ),
  close: <path d="M18 6 6 18M6 6l12 12" />,
  check: <path d="m20 6.5-11 11-5-5" />,
  chevronLeft: <path d="m15 18-6-6 6-6" />,
  chevronRight: <path d="m9 18 6-6-6-6" />,
  chevronDown: <path d="m6 9.5 6 6 6-6" />,
  grip: (
    <g fill="currentColor" stroke="none">
      <circle cx="9" cy="6" r="1.5" />
      <circle cx="9" cy="12" r="1.5" />
      <circle cx="9" cy="18" r="1.5" />
      <circle cx="15" cy="6" r="1.5" />
      <circle cx="15" cy="12" r="1.5" />
      <circle cx="15" cy="18" r="1.5" />
    </g>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  sparkle: <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9Z" />,
  warn: (
    <>
      <path d="M12 9.5v4M12 17.2h.01" />
      <path d="M10.3 3.9 2.4 17a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
  flame: (
    <path d="M12 2.5c1.6 4.2 5.2 5.3 5.2 9.3a5.2 5.2 0 0 1-10.4 0c0-2 1-3.2 1-3.2s.5 1.6 2 1.6c1.8 0 2.2-4.3 2.2-7.7Z" />
  ),
  bell: (
    <>
      <path d="M6 9.5a6 6 0 0 1 12 0c0 4.8 2 5.9 2 5.9H4s2-1.1 2-5.9" />
      <path d="M10.4 19.5a2 2 0 0 0 3.2 0" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="7.5" ry="3" />
      <path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" />
      <path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" />
    </>
  ),
  import: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </>
  ),
  export: (
    <>
      <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4 20.5h16" />
    </>
  ),
  reorder: <path d="M12 3.5v17M8.5 7 12 3.5 15.5 7M8.5 17l3.5 3.5 3.5-3.5" />,
}

export interface IconProps {
  readonly name: IconName
  readonly size?: number
  readonly className?: string
}

export function Icon({ name, size = 16, className }: IconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  )
}
