import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from '../icons.tsx'

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
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    return () => dialog.close()
  }, [])
  return (
    <dialog
      ref={ref}
      className="phone-sheet"
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
