import { lazy, Suspense, useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { BottomNav } from './components/BottomNav'
import { ContentShield } from './components/ContentShield'
import { ErrorBoundary } from './components/ErrorBoundary'
import { ToastHost } from './components/ToastHost'
import { VideoPlayerSheet } from './components/VideoPlayerSheet'
import { AppProvider, useApp } from './context/AppContext'
import { CommunityProvider } from './context/CommunityContext'
import { hasPremiumAccess } from './lib/roles'

const AdminPanelScreen = lazy(async () => ({ default: (await import('./screens/AdminPanelScreen')).AdminPanelScreen }))
import { CollectionScreen } from './screens/CollectionScreen'
import { CreatorScreen } from './screens/CreatorScreen'
import { DiscoverScreen } from './screens/DiscoverScreen'
import { DownloadsScreen } from './screens/DownloadsScreen'
import { HomeScreen } from './screens/HomeScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { LoginScreen } from './screens/LoginScreen'
import { PremiumNav } from './components/PremiumNav'
import { PremiumAlbumScreen } from './screens/PremiumAlbumScreen'
import { PremiumChannelScreen } from './screens/PremiumChannelScreen'
import { PremiumLibraryScreen } from './screens/PremiumLibraryScreen'
import { PremiumHotpicAlbumScreen } from './screens/PremiumHotpicAlbumScreen'
import { PremiumModelScreen } from './screens/PremiumModelScreen'
import { PremiumScreen } from './screens/PremiumScreen'
import { PremiumVideosScreen } from './screens/PremiumVideosScreen'
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

function PremiumOnly({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { account } = useApp()
  // A local premium/vip role unlocks Premium.
  return hasPremiumAccess(account?.role) ? <>{children}</> : <Navigate to="/premium" replace />
}

function XsApp(): React.JSX.Element {
  const location = useLocation()
  const inPremium = location.pathname.startsWith('/premium')
  return (
    <div className={`app-frame${inPremium ? ' app-frame--ott' : ''}${location.pathname.startsWith('/admin') ? '' : ' app-frame--guard'}`}>
      <ContentShield />
      <ScrollToTop />
      <main className="app-content">
        <ErrorBoundary>
        <Suspense fallback={<p className="form-help" style={{ padding: 24 }}>Loading…</p>}>
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
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/premium" element={<PremiumScreen />} />
          <Route path="/premium/model/:username" element={<PremiumOnly><PremiumModelScreen /></PremiumOnly>} />
          <Route path="/premium/hotpic/:id" element={<PremiumOnly><PremiumHotpicAlbumScreen /></PremiumOnly>} />
          <Route path="/premium/videos" element={<PremiumOnly><PremiumVideosScreen /></PremiumOnly>} />
          <Route path="/premium/library" element={<PremiumOnly><PremiumLibraryScreen /></PremiumOnly>} />
          <Route path="/premium/channel/:id" element={<PremiumOnly><PremiumChannelScreen /></PremiumOnly>} />
          <Route path="/premium/album/:id" element={<PremiumOnly><PremiumAlbumScreen /></PremiumOnly>} />
          <Route path="/admin" element={<AdminPanelScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
        </ErrorBoundary>
      </main>
      {inPremium ? <PremiumNav /> : <BottomNav />}
      <VideoPlayerSheet />
      <ToastHost />
    </div>
  )
}

export default function App(): React.JSX.Element {
  return (
    <AppProvider>
      <CommunityProvider>
        <HashRouter>
          <XsApp />
        </HashRouter>
      </CommunityProvider>
    </AppProvider>
  )
}
