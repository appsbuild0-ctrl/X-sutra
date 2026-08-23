import { useApp } from '../context/AppContext'
import { CheckIcon, CloseIcon } from './icons'

export function ToastHost(): React.JSX.Element | null {
  const { toast } = useApp()
  if (!toast) return null

  return (
    <div className={`toast toast--${toast.tone}`} role="status" aria-live="polite">
      {toast.tone === 'success' ? <CheckIcon size={18} /> : toast.tone === 'error' ? <CloseIcon size={18} /> : <span className="toast__dot" />}
      <span>{toast.text}</span>
    </div>
  )
}
