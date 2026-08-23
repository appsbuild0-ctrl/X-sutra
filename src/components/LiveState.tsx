import type { ReactNode } from 'react'
import { RefreshIcon } from './icons'

interface LiveErrorProps {
  message: string
  onRetry: () => void
  title?: string
}

export function LiveError({ message, onRetry, title = 'Live data could not load.' }: LiveErrorProps): React.JSX.Element {
  return (
    <div className="empty-state empty-state--tall live-error">
      <span className="empty-state__icon"><RefreshIcon size={25} /></span>
      <strong>{title}</strong>
      <span>{message}</span>
      <button className="secondary-button" type="button" onClick={() => void onRetry()}><RefreshIcon size={17} /> Try again</button>
    </div>
  )
}

export function ScreenNotice({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="connection-note connection-note--live">{children}</div>
}
