import type { ReactNode } from 'react'
import { CrownMark } from './CrownMark'

interface ScreenHeaderProps {
  title: string
  eyebrow?: string
  actions?: ReactNode
  /** Brand mark is reserved for the Home screen only. */
  showMark?: boolean
}

export function ScreenHeader({ title, eyebrow, actions, showMark = false }: ScreenHeaderProps): React.JSX.Element {
  return (
    <header className="screen-header">
      <div className="screen-header__identity">
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
