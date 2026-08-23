import { useLocation, useNavigate } from 'react-router-dom'
import { CompassIcon, DownloadIcon, HomeIcon, LibraryIcon, UserIcon } from './icons'

const tabs = [
  { path: '/', label: 'Home', Icon: HomeIcon, match: (pathname: string) => pathname === '/' },
  { path: '/discover', label: 'Discover', Icon: CompassIcon, match: (pathname: string) => /^\/(discover|search|creator|tag|niche)/.test(pathname) },
  { path: '/library', label: 'Library', Icon: LibraryIcon, match: (pathname: string) => /^\/(library|collection)/.test(pathname) },
  { path: '/downloads', label: 'Downloads', Icon: DownloadIcon, match: (pathname: string) => pathname.startsWith('/downloads') },
  { path: '/you', label: 'You', Icon: UserIcon, match: (pathname: string) => /^\/(you|settings)/.test(pathname) }
]

export function BottomNav(): React.JSX.Element {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {tabs.map(({ path, label, Icon, match }) => {
        const selected = match(pathname)
        return (
          <button
            key={path}
            className={`nav-tab${selected ? ' is-active' : ''}`}
            type="button"
            onClick={() => navigate(path)}
            aria-current={selected ? 'page' : undefined}
          >
            <span className="nav-icon"><Icon size={20} /></span>
            <span>{label}</span>
          </button>
        )
      })}
    </nav>
  )
}
