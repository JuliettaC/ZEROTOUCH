import { useEffect, useRef } from 'react'
import { Icon } from './UI'

export function Dialog({ children, onClose, className = '', titleId }) {
  const ref = useRef(null)
  useEffect(() => {
    const dialog = ref.current,
      trigger = document.activeElement
    dialog.showModal()
    // showModal() enfoca el primer elemento enfocable (el botón Cerrar) y anula el autoFocus de React:
    // el campo principal se enfoca de forma explícita para poder escribir sin tocar nada.
    dialog.querySelector('[data-autofocus]')?.focus()
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      dialog.close()
      document.body.style.overflow = previousOverflow
      trigger?.focus?.()
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className={`dialog ${className}`}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClick={(event) => {
        if (event.target === ref.current) {
          const box = ref.current.getBoundingClientRect()
          if (
            event.clientX < box.left ||
            event.clientX > box.right ||
            event.clientY < box.top ||
            event.clientY > box.bottom
          )
            onClose()
        }
      }}
    >
      {children}
    </dialog>
  )
}

export function DialogHeader({ id, title, subtitle, onClose }) {
  return (
    <header className="dialog-header">
      <div>
        <h2 id={id}>{title}</h2>
        {subtitle && <p>{subtitle}</p>}
      </div>
      <button type="button" className="close-dialog" aria-label="Cerrar" onClick={onClose}>
        <Icon name="close" />
      </button>
    </header>
  )
}
