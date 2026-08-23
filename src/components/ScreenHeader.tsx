import type { ReactNode } from 'react'
import { BrandMark } from './icons'

interface ScreenHeaderProps {
  title: string
  eyebrow?: string
  actions?: ReactNode
}

export function ScreenHeader({ title, eyebrow, actions }: ScreenHeaderProps): React.JSX.Element {
  return (
    <header className="screen-header">
      <div className="screen-header__identity">
        <span className="brand-mark" aria-hidden="true"><BrandMark size={28} /></span>
        <div>
          {eyebrow && <p className="eyebrow">{eyebrow}</p>}
          <h1>{title}</h1>
        </div>
      </div>
      {actions && <div className="screen-header__actions">{actions}</div>}
    </header>
  )
}
