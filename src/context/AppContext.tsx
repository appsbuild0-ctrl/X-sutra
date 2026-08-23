import { Capacitor } from '@capacitor/core'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import { readStored, writeStored } from '../lib/storage'
import type { Creator, DownloadRecord, LocalCollection, MediaItem, Preferences } from '../types'

type ToastTone = 'default' | 'success' | 'error'

interface ToastMessage {
  id: number
  text: string
  tone: ToastTone
}

interface AppContextValue {
  saved: MediaItem[]
  follows: Creator[]
  collections: LocalCollection[]
  downloads: DownloadRecord[]
  activeMedia: MediaItem | null
  preferences: Preferences
  toast: ToastMessage | null
  isSaved: (id: string) => boolean
  toggleSaved: (item: MediaItem) => void
  isFollowing: (username: string) => boolean
  toggleFollow: (creator: Creator) => void
  createCollection: (name: string, description?: string) => void
  deleteCollection: (id: string) => void
  addToCollection: (collectionId: string, item: MediaItem) => void
  collectionItems: (collectionId: string) => MediaItem[]
  requestDownload: (item: MediaItem) => Promise<void>
  clearDownloads: () => void
  openPlayer: (item: MediaItem) => void
  closePlayer: () => void
  updatePreferences: (patch: Partial<Preferences>) => void
  notify: (text: string, tone?: ToastTone) => void
}

const AppContext = createContext<AppContextValue | null>(null)

const SAVED_KEY = 'x-sutra.saved.real.v2'
const FOLLOWS_KEY = 'x-sutra.follows.real.v2'
const COLLECTIONS_KEY = 'x-sutra.collections.local.v2'
const DOWNLOADS_KEY = 'x-sutra.downloads.real.v2'
const PREFERENCES_KEY = 'x-sutra.preferences.v2'
const defaultPreferences: Preferences = { quality: 'hd', autoplay: false, muted: false, blockedTags: [] }

function readRealSaved(): MediaItem[] {
  return readStored<MediaItem[]>(SAVED_KEY, [])
    .filter((item) => item?.id && !item.id.startsWith('xs-demo-'))
    .map((item) => ({ ...item, thumbnailUrls: item.thumbnailUrls ?? (item.thumbnail ? [item.thumbnail] : []) }))
}

function fileNameFor(item: MediaItem): string {
  const clean = `${item.creator}-${item.title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 72)
  return `${clean || item.id}.mp4`
}

function triggerBrowserDownload(url: string, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.target = '_blank'
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

async function saveVideo(url: string, filename: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    const { Directory, Filesystem } = await import('@capacitor/filesystem')
    await Filesystem.downloadFile({ url, path: filename, directory: Directory.Documents, recursive: true })
    return
  }

  try {
    const response = await fetch(url)
    if (!response.ok) throw new Error(`Download request failed (${response.status})`)
    const blob = await response.blob()
    const objectUrl = URL.createObjectURL(blob)
    triggerBrowserDownload(objectUrl, filename)
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500)
  } catch {
    // Some public media hosts disallow blob fetches. Let the browser/native
    // handler open the public file instead of inventing a fake completion.
    triggerBrowserDownload(url, filename)
  }
}

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [saved, setSaved] = useState<MediaItem[]>(readRealSaved)
  const [follows, setFollows] = useState<Creator[]>(() => readStored(FOLLOWS_KEY, []))
  const [collections, setCollections] = useState<LocalCollection[]>(() => readStored(COLLECTIONS_KEY, []))
  const [downloads, setDownloads] = useState<DownloadRecord[]>(() => readStored(DOWNLOADS_KEY, []))
  const [preferences, setPreferences] = useState<Preferences>(() => ({ ...defaultPreferences, ...readStored(PREFERENCES_KEY, defaultPreferences) }))
  const [activeMedia, setActiveMedia] = useState<MediaItem | null>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)

  useEffect(() => writeStored(SAVED_KEY, saved), [saved])
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
    const url = preferences.quality === 'sd' ? item.videoUrlSd ?? item.videoUrl : item.videoUrl ?? item.videoUrlSd
    if (!url) {
      notify('This public clip does not expose a downloadable video URL', 'error')
      return
    }

    const recordId = `${item.id}-${Date.now()}`
    setDownloads((current) => [{ id: recordId, item, status: 'queued', createdAt: new Date().toISOString() }, ...current])

    try {
      setDownloads((current) => current.map((entry) => entry.id === recordId ? { ...entry, status: 'downloading' } : entry))
      await saveVideo(url, fileNameFor(item))
      setDownloads((current) => current.map((entry) => entry.id === recordId ? { ...entry, status: 'done' } : entry))
      notify('Download sent to your device/browser', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to start download'
      setDownloads((current) => current.map((entry) => entry.id === recordId ? { ...entry, status: 'failed', error: message } : entry))
      notify('The download could not be started', 'error')
    }
  }, [notify, preferences.quality])

  const value = useMemo<AppContextValue>(() => ({
    saved,
    follows,
    collections,
    downloads,
    activeMedia,
    preferences,
    toast,
    isSaved,
    toggleSaved,
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
    openPlayer: setActiveMedia,
    closePlayer: () => setActiveMedia(null),
    updatePreferences: (patch) => setPreferences((current) => ({ ...current, ...patch })),
    notify
  }), [activeMedia, addToCollection, collectionItems, collections, createCollection, deleteCollection, downloads, follows, isFollowing, isSaved, notify, preferences, requestDownload, saved, toast, toggleFollow, toggleSaved])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}
