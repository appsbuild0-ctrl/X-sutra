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
import { readStored, removeStored, writeStored } from '../lib/storage'
import type { DownloadRecord, MediaItem, Preferences } from '../types'

type ToastTone = 'default' | 'success' | 'error'

interface ToastMessage {
  id: number
  text: string
  tone: ToastTone
}

interface AppContextValue {
  saved: MediaItem[]
  downloads: DownloadRecord[]
  activeMedia: MediaItem | null
  profileName: string
  preferences: Preferences
  toast: ToastMessage | null
  isSaved: (id: string) => boolean
  toggleSaved: (item: MediaItem) => void
  requestDownload: (item: MediaItem) => Promise<void>
  clearDownloads: () => void
  openPlayer: (item: MediaItem) => void
  closePlayer: () => void
  setProfileName: (name: string) => void
  clearProfile: () => void
  updatePreferences: (patch: Partial<Preferences>) => void
  notify: (text: string, tone?: ToastTone) => void
}

const AppContext = createContext<AppContextValue | null>(null)

const SAVED_KEY = 'x-sutra.saved.v1'
const DOWNLOADS_KEY = 'x-sutra.downloads.v1'
const PROFILE_KEY = 'x-sutra.profile.v1'
const PREFERENCES_KEY = 'x-sutra.preferences.v1'
const defaultPreferences: Preferences = { quality: 'hd', autoplay: false }

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
    await Filesystem.downloadFile({
      url,
      path: filename,
      directory: Directory.Documents,
      recursive: true
    })
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
    // A cross-origin host may not allow a blob fetch. Opening the public file is
    // still a useful browser fallback and works with Android's download handler.
    triggerBrowserDownload(url, filename)
  }
}

export function AppProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [saved, setSaved] = useState<MediaItem[]>(() => readStored(SAVED_KEY, []))
  const [downloads, setDownloads] = useState<DownloadRecord[]>(() => readStored(DOWNLOADS_KEY, []))
  const [profileName, setProfileNameState] = useState<string>(() => readStored(PROFILE_KEY, ''))
  const [preferences, setPreferences] = useState<Preferences>(() => readStored(PREFERENCES_KEY, defaultPreferences))
  const [activeMedia, setActiveMedia] = useState<MediaItem | null>(null)
  const [toast, setToast] = useState<ToastMessage | null>(null)

  useEffect(() => writeStored(SAVED_KEY, saved), [saved])
  useEffect(() => writeStored(DOWNLOADS_KEY, downloads), [downloads])
  useEffect(() => writeStored(PREFERENCES_KEY, preferences), [preferences])
  useEffect(() => {
    if (profileName) writeStored(PROFILE_KEY, profileName)
    else removeStored(PROFILE_KEY)
  }, [profileName])

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
      const exists = current.some((savedItem) => savedItem.id === item.id)
      if (exists) {
        notify('Removed from your local library')
        return current.filter((savedItem) => savedItem.id !== item.id)
      }
      notify('Saved to your local library', 'success')
      return [item, ...current]
    })
  }, [notify])

  const requestDownload = useCallback(async (item: MediaItem) => {
    const url = preferences.quality === 'sd'
      ? item.videoUrlSd ?? item.videoUrl
      : item.videoUrl ?? item.videoUrlSd

    if (!url) {
      notify('A downloadable video file is not available for this item', 'error')
      return
    }

    const recordId = `${item.id}-${Date.now()}`
    const record: DownloadRecord = {
      id: recordId,
      item,
      status: 'queued',
      createdAt: new Date().toISOString()
    }
    setDownloads((current) => [record, ...current])

    try {
      setDownloads((current) => current.map((entry) =>
        entry.id === recordId ? { ...entry, status: 'downloading' } : entry
      ))
      await saveVideo(url, fileNameFor(item))
      setDownloads((current) => current.map((entry) =>
        entry.id === recordId ? { ...entry, status: 'done' } : entry
      ))
      notify('Download started — check your Downloads folder', 'success')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to download this item'
      setDownloads((current) => current.map((entry) =>
        entry.id === recordId ? { ...entry, status: 'failed', error: message } : entry
      ))
      notify('The download could not be started', 'error')
    }
  }, [notify, preferences.quality])

  const value = useMemo<AppContextValue>(() => ({
    saved,
    downloads,
    activeMedia,
    profileName,
    preferences,
    toast,
    isSaved,
    toggleSaved,
    requestDownload,
    clearDownloads: () => {
      setDownloads([])
      notify('Download history cleared')
    },
    openPlayer: setActiveMedia,
    closePlayer: () => setActiveMedia(null),
    setProfileName: (name) => {
      const clean = name.trim().slice(0, 32)
      setProfileNameState(clean)
      if (clean) notify(`Welcome, ${clean}`, 'success')
    },
    clearProfile: () => {
      setProfileNameState('')
      notify('Local profile removed')
    },
    updatePreferences: (patch) => setPreferences((current) => ({ ...current, ...patch })),
    notify
  }), [activeMedia, downloads, isSaved, notify, preferences, profileName, requestDownload, saved, toast, toggleSaved])

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside AppProvider')
  return context
}
