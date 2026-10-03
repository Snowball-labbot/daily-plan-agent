import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from '../icons.tsx'
import { usePhoneViewport } from './phoneViewport.ts'

export function PhoneSheet({
  title,
  children,
  footer,
  onClose,
}: {
  title: string
  children: ReactNode
  footer?: ReactNode
  onClose: () => void
}): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  const viewport = usePhoneViewport()
  useEffect(() => {
    const dialog = ref.current!
    const previousFocus = document.activeElement as HTMLElement | null
    const owner = dialog.closest<HTMLElement>('[role="dialog"]')
    dialog.showModal()
    return () => {
      dialog.close()
      // Restore after React removes the dialog and the browser finishes closing it.
      requestAnimationFrame(() => {
        if (document.querySelector('dialog[open]')) return
        const target = previousFocus !== document.body && previousFocus?.isConnected
          ? previousFocus : owner?.querySelector<HTMLElement>('[data-coach-close]')
        if (target?.getClientRects().length) target.focus({ preventScroll: true })
      })
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className="phone-sheet"
      style={viewport.style}
      data-short-viewport={viewport.short || undefined}
      aria-label={title}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <header>
        <h2>{title}</h2>
        <button type="button" aria-label="关闭" onClick={onClose}>
          <Icon name="close" size={18} />
        </button>
      </header>
      <div className="phone-sheet-body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </dialog>
  )
}
