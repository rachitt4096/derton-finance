import useMarketStore from '../../store/useMarketStore'

const TOAST_META = {
  h: { icon: 'UP', label: 'Live Alert' },
  w: { icon: 'FYI', label: 'Notice' },
  l: { icon: 'ERR', label: 'Attention' },
}

function Toast() {
  const toasts = useMarketStore((state) => state.toasts)
  const removeToast = useMarketStore((state) => state.removeToast)

  return (
    <div id="toasts">
      {toasts.map((toast) => (
        <div className={`toast ${toast.type}`} key={toast.id}>
          <span className="toast-icon" aria-hidden="true">
            {TOAST_META[toast.type]?.icon ?? 'MSG'}
          </span>
          <div className="toast-body">
            <span className="toast-label">{TOAST_META[toast.type]?.label ?? 'Update'}</span>
            <span className="toast-message">{toast.message}</span>
          </div>
          <button className="t-x" type="button" onClick={() => removeToast(toast.id)} aria-label="Dismiss notification">
            x
          </button>
        </div>
      ))}
    </div>
  )
}

export default Toast
