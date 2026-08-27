import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import { openMediaInBrowser, saveMediaBlob } from '../lib/download'
import { playbackCandidates } from '../lib/media'
import { hotpicApi } from '../lib/hotpic'
import { publicMediaApi } from '../lib/redgifs'
import { createUser, onAccountsChange, readSession, verifyLogin, writeSession } from '../lib/accounts'
import {
  clearUserSession,
  loginWithTelegram,
  logoutUser,
  readUserSession,
  refreshUserSession,
  type TelegramWidgetUser
} from '../lib/telegramLogin'
import { readStored, writeStored, removeStored } from '../lib/storage'
import type { AuthResult, Creator, DownloadRecord, DownloadStatus, LocalAccount, LocalCollection, MediaItem, Preferences } from '../types'

type ToastTone = 'default' | 'success' | 'error'

interface ToastMessage {
  id: number
  text: string
  tone: ToastTone
}

interface AppContextValue {
  saved: MediaItem[]
  liked: MediaItem[]
  follows: Creator[]
  collections: LocalCollection[]
  downloads: DownloadRecord[]
  activeMedia: MediaItem | null
  playerQueue: MediaItem[]
  playerIndex: number
  preferences: Preferences
  account: LocalAccount | null
  signIn: (username: string, password: string) => Promise<AuthResult>
  signUp: (name: string, username: string, password: string) => Promise<AuthResult>
  /** Finishes a Telegram Login Widget authentication and stores the JWT. */
  signInWithTelegram: (auth: TelegramWidgetUser) => Promise<AuthResult>
  signOut: () => void
  toast: ToastMessage | null
  isSaved: (id: string) => boolean
  toggleSaved: (item: MediaItem) => void
  isLiked: (id: string) => boolean
  toggleLike: (item: MediaItem) => void
  isFollowing: (username: string) => boolean
  toggleFollow: (creator: Creator) => void
  createCollection: (name: string, description?: string) => void
  deleteCollection: (id: string) => void
  addToCollection: (collectionId: string, item: MediaItem) => void
  collectionItems: (collectionId: string) => MediaItem[]
  requestDownload: (item: MediaItem) => Promise<boolean>
  clearDownloads: () => void
  openPlayer: (item: MediaItem, queue?: MediaItem[]) => void
  stepPlayer: (direction: -1 | 1) => void
  closePlayer: () => void
  /** Re-fetches the playing clip's detail so the player gets fresh direct media URLs. */
  refreshActiveMedia: () => Promise<MediaItem | null>
  /** Admin action: wipes all local library/history data on this device. */
  clearLocalData: () => void
  updatePreferences: (patch: Partial<Preferences>) => void
  notify: (text: string, tone?: ToastTone) => void
}

const AppContext = createContext<AppContextValue | null>(null)

const SAVED_KEY = 'x-sutra.saved.real.v2'
const LIKED_KEY = 'x-sutra.likes.local.v1'
const FOLLOWS_KEY = 'x-sutra.follows.real.v2'
const COLLECTIONS_KEY = 'x-sutra.collections.local.v2'
const DOWNLOADS_KEY = 'x-sutra.downloads.real.v2'
const PREFERENCES_KEY = 'x-sutra.preferences.v2'
const SESSION_KEY = 'x-sutra.session.local.v1'
const defaultPreferences: Preferences = { quality: 'hd', autoplay: true, muted: true, blockedTags: [] }

const usernamePattern = /^[a-z0-9._]{3,20}$/i

export function validUsername(username: string): boolean {
  return usernamePattern.test(username.trim())
}

/** A Telegram session mapped onto the account shape the whole app already uses. */
function telegramAccount(): LocalAccount | null {
  const session = readUserSession()
  if (!session) return null
  return {
    name: session.user.name,
    username: session.user.username || `tg${session.user.telegramId.slice(-6)}`,
    passwordHash: '',
    createdAt: session.user.createdAt,
    role: session.user.role,
    status: session.user.status,
    telegramId: session.user.telegramId,
    photoUrl: session.user.photoUrl,
    source: 'telegram'
  }
}

/** Telegram login wins when both exist; otherwise the device-local account. */
export function readActiveSession(): LocalAccount | null {
  return telegramAccount() ?? readSession()
}

function readRealSaved(): MediaItem[] {
  return readStored<MediaItem[]>(SAVED_KEY, [])
    .filter((item) => item?.id && !item.id.startsWith('xs-demo-'))
    .map((item) => ({ ...item, thumbnailUrls: item.thumbnailUrls ?? (item.thumbnail ? [item.thumbnail] : []) }))
}

function mergeMediaDetail(item: MediaItem, detail: MediaItem): MediaItem {
  return {
    ...item,
    ...detail,
    thumbnail: detail.thumbnail ?? item.thumbnail,
    thumbnailUrls: detail.thumbnailUrls.length ? detail.thumbnailUrls : item.thumbnailUrls,
    previewUrl: detail.previewUrl ?? item.previewUrl,
    videoUrl: detail.videoUrl ?? item.videoUrl,
    videoUrlSd: detail.videoUrlSd ?? item.videoUrlSd,
    watermarkedUrls: detail.watermarkedUrls?.length ? detail.watermarkedUrls : item.watermarkedUrls
  }
}

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [saved, setSaved] = useState<MediaItem[]>(readRealSaved)
  const [liked, setLiked] = useState<MediaItem[]>(() => readStored<MediaItem[]>(LIKED_KEY, []).map((item) => ({ ...item, thumbnailUrls: item.thumbnailUrls ?? (item.thumbnail ? [item.thumbnail] : []) })))
  const [follows, setFollows] = useState<Creator[]>(() => readStored(FOLLOWS_KEY, []))
  const [collections, setCollections] = useState<LocalCollection[]>(() => readStored(COLLECTIONS_KEY, []))
  const [downloads, setDownloads] = useState<DownloadRecord[]>(() => readStored(DOWNLOADS_KEY, []))
  const [preferences, setPreferences] = useState<Preferences>(() => ({ ...defaultPreferences, ...readStored(PREFERENCES_KEY, defaultPreferences) }))
  const [activeMedia, setActiveMedia] = useState<MediaItem | null>(null)
  const [playerQueue, setPlayerQueue] = useState<MediaItem[]>([])
  const [playerIndex, setPlayerIndex] = useState(0)
  const [toast, setToast] = useState<ToastMessage | null>(null)
  const [account, setAccount] = useState<LocalAccount | null>(readActiveSession)

  useEffect(() => onAccountsChange(() => {
    setAccount((current) => {
      if (!current) return current
      return readActiveSession()
    })
  }), [])

  // A Telegram session is re-validated on start, so a role change or a
  // server-side logout applies immediately instead of when the JWT expires.
  useEffect(() => {
    if (!readUserSession()) return
    void refreshUserSession().then((session) => setAccount(session ? telegramAccount() : readSession()))
  }, [])

  useEffect(() => writeStored(SAVED_KEY, saved), [saved])
  useEffect(() => writeStored(LIKED_KEY, liked), [liked])
  useEffect(() => writeStored(FOLLOWS_KEY, follows), [follows])
  useEffect(() => writeStored(COLLECTIONS_KEY, collections), [collections])
  useEffect(() => writeStored(DOWNLOADS_KEY, downloads), [downloads])
  useEffect(() => writeStored(PREFERENCES_KEY, preferences), [preferences])
  useEffect(() => {
    if (!toast) return
    const timeout = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timeout)
  }, [toast])

  const notify = useCallback((text: string, tone: ToastTone = 'default') => {
    setToast({ id: Date.now(), text, tone })
  }, [])

  const signUp = useCallback(async (name: string, username: string, password: string): Promise<AuthResult> => {
    const result = await createUser({ name, username, password, role: 'creator' })
    if (!result.ok || !result.user) return { ok: false, error: result.ok ? 'Could not create account' : result.error }
    writeSession(result.user)
    setAccount(result.user)
    notify(`Welcome, ${result.user.name}`, 'success')
    return { ok: true }
  }, [notify])

  const signIn = useCallback(async (username: string, password: string): Promise<AuthResult> => {
    const result = await verifyLogin(username, password)
    if (!result.ok || !result.user) return { ok: false, error: result.ok ? 'Sign in failed' : result.error }
    writeSession(result.user)
    setAccount(result.user)
    notify(`Signed in as ${result.user.name}`, 'success')
    return { ok: true }
  }, [notify])

  /**
   * Completes a Telegram Login Widget authentication. The widget payload is
   * verified by the backend against the bot token; the role that comes back is
   * the one stored in PostgreSQL, never something the client picked.
   */
  const signInWithTelegram = useCallback(async (auth: TelegramWidgetUser): Promise<AuthResult> => {
    try {
      const session = await loginWithTelegram(auth)
      setAccount(telegramAccount())
      notify(session.user.role === 'admin' ? `Admin signed in — ${session.user.name}` : `Signed in with Telegram — ${session.user.name}`, 'success')
      return { ok: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Telegram login failed'
      notify(message, 'error')
      return { ok: false, error: message }
    }
  }, [notify])

  const signOut = useCallback(() => {
    // A Telegram session is invalidated server-side too, so the token stops
    // working instead of staying valid until it expires.
    if (readUserSession()) void logoutUser()
    clearUserSession()
    removeStored(SESSION_KEY)
    setAccount(null)
    notify('Signed out. Data stays on this device')
  }, [notify])

  const isSaved = useCallback((id: string) => saved.some((item) => item.id === id), [saved])

  const toggleSaved = useCallback((item: MediaItem) => {
    setSaved((current) => {
      if (current.some((savedItem) => savedItem.id === item.id)) {
        notify('Removed from your local library')
        return current.filter((savedItem) => savedItem.id !== item.id)
      }
      notify('Saved to your local library', 'success')
      return [item, ...current]
    })
  }, [notify])

  const isLiked = useCallback((id: string) => liked.some((item) => item.id === id), [liked])

  const toggleLike = useCallback((item: MediaItem) => {
    setLiked((current) => {
      if (current.some((likedItem) => likedItem.id === item.id)) {
        notify('Removed local like')
        return current.filter((likedItem) => likedItem.id !== item.id)
      }
      notify('Liked on this device', 'success')
      return [item, ...current]
    })
  }, [notify])

  const isFollowing = useCallback((username: string) => follows.some((creator) => creator.username === username), [follows])

  const toggleFollow = useCallback((creator: Creator) => {
    setFollows((current) => {
      if (current.some((entry) => entry.username === creator.username)) {
        notify(`Unfollowed @${creator.username}`)
        return current.filter((entry) => entry.username !== creator.username)
      }
      notify(`Following @${creator.username} locally`, 'success')
      return [creator, ...current]
    })
  }, [notify])

  const createCollection = useCallback((name: string, description = '') => {
    const clean = name.trim().slice(0, 48)
    if (!clean) {
      notify('Name your collection first', 'error')
      return
    }
    setCollections((current) => [{
      id: `local-${Date.now()}`,
      name: clean,
      description: description.trim().slice(0, 120),
      itemIds: [],
      createdAt: new Date().toISOString()
    }, ...current])
    notify(`Created ${clean}`, 'success')
  }, [notify])

  const deleteCollection = useCallback((id: string) => {
    setCollections((current) => current.filter((collection) => collection.id !== id))
    notify('Collection removed')
  }, [notify])

  const addToCollection = useCallback((collectionId: string, item: MediaItem) => {
    setSaved((current) => current.some((savedItem) => savedItem.id === item.id) ? current : [item, ...current])
    setCollections((current) => current.map((collection) => {
      if (collection.id !== collectionId || collection.itemIds.includes(item.id)) return collection
      return { ...collection, itemIds: [...collection.itemIds, item.id] }
    }))
    notify('Added to collection', 'success')
  }, [notify])

  const collectionItems = useCallback((collectionId: string) => {
    const collection = collections.find((entry) => entry.id === collectionId)
    if (!collection) return []
    return collection.itemIds.map((id) => saved.find((item) => item.id === id)).filter((item): item is MediaItem => Boolean(item))
  }, [collections, saved])

  const requestDownload = useCallback(async (item: MediaItem) => {
    const recordId = `${item.id}-${Date.now()}`
    setDownloads((current) => [{ id: recordId, item, status: 'queued', createdAt: new Date().toISOString() }, ...current])

    try {
      setDownloads((current) => current.map((entry) => entry.id === recordId ? { ...entry, status: 'downloading' } : entry))

      // Refresh the selected clip from the detail endpoint at download time so
      // the file URL is the current URL supplied by the API, not a watch page,
      // embed URL, or hard-coded fallback. Existing API data remains usable if
      // the detail refresh is temporarily unavailable.
      let resolved = item
      try {
        resolved = item.id.startsWith('hp-')
          ? await hotpicApi.resolve(item)
          : mergeMediaDetail(item, await publicMediaApi.getById(item.id))
      } catch (error) {
        if (!item.videoUrl && !item.videoUrlSd) throw error
      }

      const primaryUrl = preferences.quality === 'sd'
        ? resolved.videoUrlSd ?? resolved.videoUrl
        : resolved.videoUrl ?? resolved.videoUrlSd
      if (!primaryUrl) throw new Error('This public clip does not expose a downloadable video URL')

      // Proxied clean URLs first, direct clean next, watermarked originals
      // last — one dead candidate never fails the download.
      const urlChain = playbackCandidates(resolved)

      let mediaUrl = urlChain[0]
      let saved = false
      let lastError: unknown = null
      for (const candidate of urlChain) {
        try {
          await saveMediaBlob(resolved, candidate)
          mediaUrl = candidate
          saved = true
          break
        } catch (error) {
          lastError = error
        }
      }
      let disposition: DownloadStatus = 'done'
      if (!saved) {
        // Every fetchable candidate failed (e.g. CORS): hand the direct
        // source URL to the browser instead of failing the download.
        openMediaInBrowser(resolved, urlChain[0])
        disposition = 'opened'
      }
      const status: DownloadStatus = disposition
      setDownloads((current) => current.map((entry) => entry.id === recordId ? { ...entry, status } : entry))
      if (status === 'done') notify('Saved to your device', 'success')
      else notify('The actual media URL was opened; use your browser to save it')
      return status === 'done' || status === 'opened'
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start download'
      setDownloads((current) => current.map((entry) => entry.id === recordId ? { ...entry, status: 'failed', error: message } : entry))
      notify(message, 'error')
      return false
    }
  }, [notify, preferences.quality])

  const openPlayer = useCallback((item: MediaItem, queue: MediaItem[] = [item]) => {
    const uniqueQueue = queue.filter((entry, index, all) => all.findIndex((candidate) => candidate.id === entry.id) === index)
    const index = Math.max(0, uniqueQueue.findIndex((entry) => entry.id === item.id))
    const resolvedQueue = uniqueQueue.length ? uniqueQueue : [item]
    setPlayerQueue(resolvedQueue)
    setPlayerIndex(index)
    setActiveMedia(resolvedQueue[index] ?? item)
  }, [])

  const stepPlayer = useCallback((direction: -1 | 1) => {
    setPlayerIndex((current) => {
      const next = Math.min(Math.max(current + direction, 0), Math.max(playerQueue.length - 1, 0))
      const nextItem = playerQueue[next]
      if (nextItem) setActiveMedia(nextItem)
      return next
    })
  }, [playerQueue])

  const refreshActiveMedia = useCallback(async (): Promise<MediaItem | null> => {
    if (!activeMedia) return null
    try {
      if (activeMedia.id.startsWith('hp-') || activeMedia.id.startsWith('pm-') || activeMedia.id.startsWith('premium-')) {
        const detail = activeMedia.id.startsWith('hp-') ? await hotpicApi.resolve(activeMedia) : activeMedia
        const merged = mergeMediaDetail(activeMedia, detail)
        setPlayerQueue((current) => current.map((entry, index) => index === playerIndex ? merged : entry))
        setActiveMedia((current) => current && current.id === merged.id ? merged : current)
        return merged
      }
      const detail = await publicMediaApi.getById(activeMedia.id)
      const merged = mergeMediaDetail(activeMedia, detail)
      setPlayerQueue((current) => current.map((entry, index) => index === playerIndex ? merged : entry))
      setActiveMedia((current) => current && current.id === merged.id ? merged : current)
      return merged
    } catch {
      return null
    }
  }, [activeMedia, playerIndex])

  const clearLocalData = useCallback(() => {
    setSaved([])
    setLiked([])
    setFollows([])
    setCollections([])
    setDownloads([])
    notify('All local data cleared', 'success')
  }, [notify])

  const value = useMemo<AppContextValue>(() => ({
    saved,
    liked,
    follows,
    collections,
    downloads,
    activeMedia,
    playerQueue,
    playerIndex,
    preferences,
    account,
    signIn,
    signUp,
    signInWithTelegram,
    signOut,
    toast,
    isSaved,
    toggleSaved,
    isLiked,
    toggleLike,
    isFollowing,
    toggleFollow,
    createCollection,
    deleteCollection,
    addToCollection,
    collectionItems,
    requestDownload,
    clearDownloads: () => {
      setDownloads([])
      notify('Download history cleared')
    },
    openPlayer,
    stepPlayer,
    refreshActiveMedia,
    clearLocalData,
    closePlayer: () => {
      setActiveMedia(null)
      setPlayerQueue([])
      setPlayerIndex(0)
    },
    updatePreferences: (patch) => setPreferences((current) => ({ ...current, ...patch })),
    notify
  }), [account, activeMedia, addToCollection, collectionItems, collections, createCollection, deleteCollection, downloads, follows, isFollowing, isLiked, isSaved, liked, notify, openPlayer, playerIndex, playerQueue, clearLocalData, preferences, refreshActiveMedia, requestDownload, saved, signIn, signInWithTelegram, signOut, signUp, stepPlayer, toast, toggleFollow, toggleLike, toggleSaved])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}
