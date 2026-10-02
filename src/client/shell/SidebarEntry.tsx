import type { SidebarProps } from '../contracts.ts'
import { Icon } from '../icons.tsx'

export function SidebarEntry({ wide, t, open }: SidebarProps): JSX.Element {
  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <button
        type="button"
        className="dp-sidebar-entry"
        data-wide={wide ? 'true' : 'false'}
        title={wide ? undefined : t('app.sidebar')}
        aria-label={t('app.sidebar')}
        onClick={open}
      >
        <Icon name="today" size={18} />
        {wide && <span>{t('app.sidebar')}</span>}
      </button>
    </div>
  )
}
