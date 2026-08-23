import { useEffect, useState } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { BottomNav } from './components/BottomNav'
import { ToastHost } from './components/ToastHost'
import { VideoPlayerSheet } from './components/VideoPlayerSheet'
import { AppProvider } from './context/AppContext'
import { CollectionScreen } from './screens/CollectionScreen'
import { CreatorScreen } from './screens/CreatorScreen'
import { DiscoverScreen } from './screens/DiscoverScreen'
import { DownloadsScreen } from './screens/DownloadsScreen'
import { HomeScreen } from './screens/HomeScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { LoginScreen } from './screens/LoginScreen'
import { NicheScreen } from './screens/NicheScreen'
import { SearchScreen } from './screens/SearchScreen'
import { SettingsScreen } from './screens/SettingsScreen'
import { TagScreen } from './screens/TagScreen'
import { YouScreen } from './screens/YouScreen'

function ScrollToTop(): null {
  const { pathname } = useLocation()
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }) }, [pathname])
  return null
}

function XsApp(): React.JSX.Element {
  return (
    <div className="app-frame">
      <ScrollToTop />
      <main className="app-content">
        <Routes>
          <Route path="/" element={<HomeScreen />} />
          <Route path="/discover" element={<DiscoverScreen />} />
          <Route path="/search/:query" element={<SearchScreen />} />
          <Route path="/creator/:username" element={<CreatorScreen />} />
          <Route path="/tag/:tag" element={<TagScreen />} />
          <Route path="/niche/:id" element={<NicheScreen />} />
          <Route path="/library" element={<LibraryScreen />} />
          <Route path="/collection/:id" element={<CollectionScreen />} />
          <Route path="/downloads" element={<DownloadsScreen />} />
          <Route path="/you" element={<YouScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <BottomNav />
      <VideoPlayerSheet />
      <ToastHost />
    </div>
  )
}

export default function App(): React.JSX.Element {
  const [authenticated, setAuthenticated] = useState(() => {
    try {
      return window.sessionStorage.getItem('x-sutra.authenticated') === 'true'
    } catch {
      return false
    }
  })

  if (!authenticated) return <LoginScreen onAuthenticated={() => setAuthenticated(true)} />

  return <AppProvider><HashRouter><XsApp /></HashRouter></AppProvider>
}
