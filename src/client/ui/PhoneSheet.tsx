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
    dialog.showModal()
    return () => {
      dialog.close()
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className="phone-sheet"
      style={viewport.style}
      data-short-viewport={viewport.short || undefined}
      aria-label={title}
      onCancel={onClose}
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
