import type { TabId } from '../types'
import { CompassIcon, DownloadIcon, HomeIcon, LibraryIcon, UserIcon } from './icons'

const tabs: Array<{ id: TabId; label: string; Icon: typeof HomeIcon }> = [
  { id: 'home', label: 'Home', Icon: HomeIcon },
  { id: 'discover', label: 'Discover', Icon: CompassIcon },
  { id: 'library', label: 'Library', Icon: LibraryIcon },
  { id: 'downloads', label: 'Downloads', Icon: DownloadIcon },
  { id: 'you', label: 'You', Icon: UserIcon }
]

interface BottomNavProps {
  activeTab: TabId
  onChange: (tab: TabId) => void
}

export function BottomNav({ activeTab, onChange }: BottomNavProps): React.JSX.Element {
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {tabs.map(({ id, label, Icon }) => {
        const selected = id === activeTab
        return (
          <button
            key={id}
            className={`nav-tab${selected ? ' is-active' : ''}`}
            type="button"
            onClick={() => onChange(id)}
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
