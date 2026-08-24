import { useEffect } from 'react'
import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { BottomNav } from './components/BottomNav'
import { ToastHost } from './components/ToastHost'
import { VideoPlayerSheet } from './components/VideoPlayerSheet'
import { AppProvider } from './context/AppContext'
import { AdminPanelScreen } from './screens/AdminPanelScreen'
import { CollectionScreen } from './screens/CollectionScreen'
import { CreatorScreen } from './screens/CreatorScreen'
import { DiscoverScreen } from './screens/DiscoverScreen'
import { DownloadsScreen } from './screens/DownloadsScreen'
import { HomeScreen } from './screens/HomeScreen'
import { LibraryScreen } from './screens/LibraryScreen'
import { LoginScreen } from './screens/LoginScreen'
import { PremiumNav } from './components/PremiumNav'
import { PremiumAlbumScreen } from './screens/PremiumAlbumScreen'
import { PremiumAnnouncementsScreen } from './screens/PremiumAnnouncementsScreen'
import { PremiumChannelScreen } from './screens/PremiumChannelScreen'
import { PremiumDownloadsScreen } from './screens/PremiumDownloadsScreen'
import { PremiumScreen } from './screens/PremiumScreen'
import { PremiumSearchScreen } from './screens/PremiumSearchScreen'
import { PremiumUploadScreen } from './screens/PremiumUploadScreen'
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

function XsApp(): React.JSX.Element {
  const location = useLocation()
  const inPremium = location.pathname.startsWith('/premium')
  return (
    <div className={`app-frame${inPremium ? ' app-frame--ott' : ''}`}>
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
          <Route path="/login" element={<LoginScreen />} />
          <Route path="/premium" element={<PremiumScreen />} />
          <Route path="/premium/search" element={<PremiumSearchScreen />} />
          <Route path="/premium/upload" element={<PremiumUploadScreen />} />
          <Route path="/premium/downloads" element={<PremiumDownloadsScreen />} />
          <Route path="/premium/announcements" element={<PremiumAnnouncementsScreen />} />
          <Route path="/premium/videos" element={<PremiumVideosScreen />} />
          <Route path="/premium/channel/:id" element={<PremiumChannelScreen />} />
          <Route path="/premium/album/:id" element={<PremiumAlbumScreen />} />
          <Route path="/admin" element={<AdminPanelScreen />} />
          <Route path="/settings" element={<SettingsScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {inPremium ? <PremiumNav /> : <BottomNav />}
      <VideoPlayerSheet />
      <ToastHost />
    </div>
  )
}

export default function App(): React.JSX.Element {
  return <AppProvider><HashRouter><XsApp /></HashRouter></AppProvider>
}
