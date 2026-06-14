import { useEffect } from 'react'

function Modal({ open, onClose, className = '', children }) {
  useEffect(() => {
    if (!open) {
      return undefined
    }

    const onEscape = (event) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [onClose, open])

  if (!open) {
    return null
  }

  return (
    <div
      className="overlay open"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className={`modal ${className}`}>{children}</div>
    </div>
  )
}

export default Modal
