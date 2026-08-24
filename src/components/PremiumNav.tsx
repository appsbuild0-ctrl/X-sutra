import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../context/AppContext'
import { DownloadIcon, HomeIcon, PlusIcon, SearchIcon, SparkIcon } from './icons'

export function PremiumNav(): React.JSX.Element {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { account } = useApp()
  const isAdmin = account?.role === 'admin'
  const tabs = [
    { path: '/premium', label: 'Home', Icon: HomeIcon, match: pathname === '/premium' || pathname.startsWith('/premium/channel') || pathname.startsWith('/premium/album') || pathname.startsWith('/premium/videos') },
    { path: '/premium/search', label: 'Search', Icon: SearchIcon, match: pathname.startsWith('/premium/search') },
    ...(isAdmin ? [{ path: '/premium/upload', label: 'Upload', Icon: PlusIcon, match: pathname.startsWith('/premium/upload') }] : []),
    { path: '/premium/downloads', label: 'Downloads', Icon: DownloadIcon, match: pathname.startsWith('/premium/downloads') },
    { path: '/premium/announcements', label: 'News', Icon: SparkIcon, match: pathname.startsWith('/premium/announcements') }
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
