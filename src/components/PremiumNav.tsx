import { useLocation, useNavigate } from 'react-router-dom'
import { HomeIcon, LibraryIcon } from './icons'

export function PremiumNav(): React.JSX.Element {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const tabs = [
    { path: '/premium', label: 'Home', Icon: HomeIcon, match: pathname === '/premium' || pathname.startsWith('/premium/model') || pathname.startsWith('/premium/hotpic') || pathname.startsWith('/premium/videos') },
    { path: '/premium/library', label: 'Library', Icon: LibraryIcon, match: pathname.startsWith('/premium/library') || pathname.startsWith('/premium/channel') || pathname.startsWith('/premium/album') }
  ]

  return (
    <nav className="bottom-nav premium-ott-nav" aria-label="Premium navigation">
      {tabs.map((tab) => (
        <button
          key={tab.path}
          className={`nav-tab${tab.match ? ' is-active' : ''}`}
          type="button"
          onClick={() => navigate(tab.path)}
          aria-current={tab.match ? 'page' : undefined}
        >
          <span className="nav-icon"><tab.Icon size={20} /></span>
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  )
}
