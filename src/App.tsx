import { useCallback, useEffect, useState } from 'react'
import { BottomNav } from './components/BottomNav'
import { ToastHost } from './components/ToastHost'
import { VideoPlayerSheet } from './components/VideoPlayerSheet'
import { AppProvider } from './context/AppContext'
import { DiscoverScreen } from './screens/DiscoverScreen'
import { DownloadsScreen } from './screens/DownloadsScreen'
import { HomeScreen } from './screens/HomeScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { YouScreen } from './screens/YouScreen'
import type { TabId } from './types'

const tabs: TabId[] = ['home', 'discover', 'library', 'downloads', 'you']

function tabFromHash(): TabId {
  const path = window.location.hash.replace(/^#\/?/, '').split('/')[0]
  return tabs.includes(path as TabId) ? (path as TabId) : 'home'
}

function XsApp(): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<TabId>(tabFromHash)

  useEffect(() => {
    const onHashChange = () => setActiveTab(tabFromHash())
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const navigate = useCallback((tab: TabId) => {
    setActiveTab(tab)
    const hash = tab === 'home' ? '#/' : `#/${tab}`
    if (window.location.hash !== hash) window.location.hash = hash
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  let screen: React.JSX.Element
  switch (activeTab) {
    case 'discover':
      screen = <DiscoverScreen />
      break
    case 'library':
      screen = <LibraryScreen onExplore={() => navigate('discover')} />
      break
    case 'downloads':
      screen = <DownloadsScreen />
      break
    case 'you':
      screen = <YouScreen />
      break
    default:
      screen = <HomeScreen />
  }

  return (
    <div className="app-frame">
      <main className="app-content">{screen}</main>
      <BottomNav activeTab={activeTab} onChange={navigate} />
      <VideoPlayerSheet />
      <ToastHost />
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <AppProvider>
      <XsApp />
    </AppProvider>
  )
}
