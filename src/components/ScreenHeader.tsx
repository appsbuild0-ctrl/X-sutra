import type { ReactNode } from 'react'
import { CrownMark } from './CrownMark'
import { ArrowLeftIcon } from './icons'
import { useNavigate } from 'react-router-dom'

interface ScreenHeaderProps {
  title: string
  eyebrow?: string
  actions?: ReactNode
  /** Brand mark is reserved for the Home screen only. */
  showMark?: boolean
  /** Show back button on the left side */
  showBack?: boolean
}

export function ScreenHeader({ title, eyebrow, actions, showMark = false, showBack = false }: ScreenHeaderProps): React.JSX.Element {
  const navigate = useNavigate()
  return (
    <header className="screen-header">
      <div className="screen-header__identity">
        {showBack && (
          <button className="round-button" type="button" onClick={() => navigate(-1)} aria-label="Go back">
            <ArrowLeftIcon size={19} />
          </button>
        )}
        {showMark && <span className="brand-mark" aria-hidden="true"><CrownMark size={28} /></span>}
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
        </div>
      </div>
      {actions && <div className="screen-header__actions">{actions}</div>}
    </header>
  )
}
