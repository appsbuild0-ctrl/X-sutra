import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
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

type RouteLocation = ReturnType<typeof useLocation>

function PremiumOnly({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { account } = useApp()
  // A local premium/vip role unlocks Premium.
  return hasPremiumAccess(account?.role) ? <>{children}</> : <Navigate to="/premium" replace />
}

/** The full route table. `location` can be overridden so a kept-alive copy of a
 *  previously visited screen can keep rendering against its own URL (params,
 *  search) even while a newer screen is on top. */
function RouteTable({ location }: { location?: RouteLocation }): React.JSX.Element {
  return (
    <Routes location={location}>
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
  )
}

const MAX_KEPT_SCREENS = 12

/**
 * Keeps every screen you visit mounted (hidden once you navigate deeper) and
 * restores each one's scroll when you come back to it. That makes back/forward
 * feel like a native app: returning to a search/creator/tag feed picks up
 * exactly where you left off — same results, same scroll — instead of mounting
 * a fresh screen at the top and reloading everything.
 */
function RouteKeepAlive(): React.JSX.Element {
  const location = useLocation()
  // Each history entry's screen stays mounted so a "back" resumes it in place.
  const [entries, setEntries] = useState<Array<{ key: string; location: RouteLocation }>>(() => [
    { key: location.key, location }
  ])
  const handledKey = useRef<string | null>(location.key)
  const [restoreTick, setRestoreTick] = useState(0)
  const scrollByKey = useRef(new Map<string, number>())
  const scrollKey = useRef<string | null>(location.key)

  // Reconcile the mounted stack whenever the route changes. Runs in the layout
  // phase (before paint) so there is no blank flash between screens.
  useLayoutEffect(() => {
    const key = location.key
    if (key === handledKey.current) return
    handledKey.current = key
    setEntries((current) => {
      let next: Array<{ key: string; location: RouteLocation }>
      const existing = current.findIndex((entry) => entry.key === key)
      if (existing !== -1) {
        // Back to a screen that is still mounted: drop any screens opened
        // after it, then show that older copy again in place.
        next = current.slice(0, existing + 1)
      } else {
        // A brand-new push: keep the current screen mounted underneath it.
        next = [...current, { key, location }]
      }
      while (next.length > MAX_KEPT_SCREENS && next.length > 1) {
        // Evict the oldest hidden screen, never the one on top.
        const top = next[next.length - 1].key
        if (next[0].key === top) break
        next = next.slice(1)
      }
      return next
    })
    setRestoreTick((t) => t + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key])

  // Remember each screen's scroll offset while it is the visible one.
  useEffect(() => {
    const key = location.key
    scrollKey.current = key
    const record = (): void => {
      if (scrollKey.current === key) scrollByKey.current.set(key, window.scrollY)
    }
    record()
    window.addEventListener('scroll', record)
    return () => window.removeEventListener('scroll', record)
  }, [location.key])

  // Restore the incoming screen's scroll. This depends on `restoreTick` (not
  // just the route) so it runs AFTER the reconciliation above has committed and
  // the screen is actually in the DOM — otherwise restoring to a deep offset
  // would clamp to 0 because the content was not laid out yet.
  useLayoutEffect(() => {
    const key = location.key
    const saved = scrollByKey.current.get(key)
    window.scrollTo({ top: saved ?? 0, left: 0, behavior: 'auto' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreTick])

  const visibleKey = location.key
  return (
    <div className="route-keepalive">
      {entries.map((entry) => (
        <div
          key={entry.key}
          className="route-screen"
          style={entry.key === visibleKey ? undefined : { display: 'none' }}
        >
          <Suspense fallback={<p className="form-help" style={{ padding: 24 }}>Loading…</p>}>
            <RouteTable location={entry.location} />
          </Suspense>
        </div>
      ))}
    </div>
  )
}

function XsApp(): React.JSX.Element {
  const location = useLocation()
  const inPremium = location.pathname.startsWith('/premium')
  return (
    <div className={`app-frame${inPremium ? ' app-frame--ott' : ''}${location.pathname.startsWith('/admin') ? '' : ' app-frame--guard'}`}>
      <ContentShield />
      <main className="app-content">
        <ErrorBoundary>
          <RouteKeepAlive />
        </ErrorBoundary>
      </main>
      {inPremium ? <PremiumNav /> : <BottomNav />}
      <VideoPlayerSheet />
      <ToastHost />
    </div>
  )
}

export default function App(): React.JSX.Element {
  // We restore scroll ourselves per kept-alive screen, so stop the browser from
  // restoring its own history scroll positions (which would fight it).
  useEffect(() => {
    try {
      if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
    } catch {
      /* some WebViews restrict this — harmless */
    }
  }, [])

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
