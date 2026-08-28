import { useCallback, useEffect, useRef, useState } from 'react'
import type { MediaItem } from '../types'
import type { PremiumMedia } from './premium'

/**
 * Discord as the Premium media source — client side.
 *
 * The feed endpoint is the only thing this needs: it returns media that is
 * already stored with its Premium section, and it triggers the server-side
 * auto-sync when a mapped channel is due. Polling it is what makes a file
 * forwarded into Discord show up here without a manual refresh.
 */

const FEED_ENDPOINT = '/api/discord/feed'
export const MIN_POLL_MS = 15000
export const DEFAULT_POLL_MS = 30000

export interface DiscordFeedItem {
  id: string
  type: 'image' | 'video'
  url: string
  thumbnail: string
  title: string
  channelId: string
  channelName: string
  filename: string
  mimeType: string
  width: number
  height: number
  size: number
  authorName: string
  createdAt: string
}

export interface DiscordFeedSection {
  channelId: string
  name: string
  type: 'images' | 'videos' | 'mixed'
  discordChannelId: string
  kinds: string[]
  lastSyncAt: string
  count: number
}

export interface DiscordFeed {
  media: DiscordFeedItem[]
  sections: DiscordFeedSection[]
  autoSync: boolean
  intervalMs: number
  mode: 'link' | 'store'
  configured: boolean
  synced: { at: string; imported: number; skipped: number; channels: number } | null
  syncError: string
  oldest: string
  hasMore: boolean
}

const emptyFeed: DiscordFeed = {
  media: [], sections: [], autoSync: true, intervalMs: DEFAULT_POLL_MS, mode: 'link',
  configured: false, synced: null, syncError: '', oldest: '', hasMore: false
}

export async function fetchDiscordFeed(options: { channelId?: string; limit?: number; before?: string } = {}): Promise<DiscordFeed> {
  const params = new URLSearchParams()
  if (options.channelId) params.set('channelId', options.channelId)
  if (options.limit) params.set('limit', String(options.limit))
  if (options.before) params.set('before', options.before)
  const query = params.toString()
  const response = await fetch(`${FEED_ENDPOINT}${query ? `?${query}` : ''}`, { headers: { Accept: 'application/json' }, cache: 'no-store' })
  if (!response.ok) throw new Error(`Discord feed failed (${response.status})`)
  const data = await response.json() as Partial<DiscordFeed>
  return {
    ...emptyFeed,
    ...data,
    media: Array.isArray(data.media) ? data.media : [],
    sections: Array.isArray(data.sections) ? data.sections : [],
    intervalMs: Math.max(MIN_POLL_MS, Number(data.intervalMs) || DEFAULT_POLL_MS)
  }
}

/** Feed item → the shape the existing grid/video player already understands. */
export function discordFeedItemToMedia(item: DiscordFeedItem): MediaItem {
  const isVideo = item.type === 'video'
  return {
    id: item.id,
    title: item.title || (isVideo ? 'Discord video' : 'Discord image'),
    description: item.title || '',
    creator: 'premium',
    thumbnail: item.thumbnail || (isVideo ? '' : item.url),
    thumbnailUrls: [item.thumbnail || (!isVideo ? item.url : '')].filter(Boolean),
    // The resolver URL keeps the real extension (&f=clip.mp4), so the player and
    // the download path both recognise it as video and stream it from Discord.
    previewUrl: isVideo ? item.url : item.url,
    videoUrl: isVideo ? item.url : undefined,
    videoUrlSd: isVideo ? item.url : undefined,
    sourceUrl: item.url,
    duration: 0,
    likes: 0,
    views: 0,
    width: item.width || 0,
    height: item.height || 0,
    createdAt: Date.parse(item.createdAt) || 0,
    hasAudio: isVideo,
    tags: [],
    niches: []
  }
}

/** Feed item → the catalog shape the channel/album screens already render. */
export function discordFeedItemToPremiumMedia(item: DiscordFeedItem): PremiumMedia {
  const isVideo = item.type === 'video'
  return {
    id: item.id,
    type: item.type,
    url: item.url,
    thumbnail: item.thumbnail || (isVideo ? '' : item.url),
    title: item.title || (isVideo ? 'Discord video' : 'Discord image'),
    tags: [],
    channelId: item.channelId,
    albumId: '',
    sourcePage: '',
    createdAt: item.createdAt,
    filename: item.filename,
    size: item.size,
    width: item.width,
    height: item.height,
    source: 'discord',
    sourceChannelId: item.channelName,
    authorName: item.authorName
  }
}

/** Merge by id, newest first — what a poll adds to an already rendered list. */
export function mergeFeedItems(current: DiscordFeedItem[], incoming: DiscordFeedItem[]): DiscordFeedItem[] {
  const map = new Map<string, DiscordFeedItem>()
  for (const item of current) map.set(item.id, item)
  for (const item of incoming) if (!map.has(item.id)) map.set(item.id, item)
  return [...map.values()].sort((a, b) => Date.parse(b.createdAt || '0') - Date.parse(a.createdAt || '0'))
}

export interface DiscordFeedState {
  items: DiscordFeedItem[]
  sections: DiscordFeedSection[]
  loading: boolean
  loadingMore: boolean
  refreshing: boolean
  error: string
  hasMore: boolean
  autoSync: boolean
  configured: boolean
  syncError: string
  loadMore: () => void
  refresh: () => void
}

/**
 * Live Premium media from Discord: first page on mount, background polling while
 * the tab is visible, and cursor paging for long collections.
 */
export function useDiscordFeed(options: { channelId?: string; pageSize?: number; enabled?: boolean } = {}): DiscordFeedState {
  const { channelId = '', pageSize = 24, enabled = true } = options
  const [items, setItems] = useState<DiscordFeedItem[]>([])
  const [sections, setSections] = useState<DiscordFeedSection[]>([])
  const [loading, setLoading] = useState(enabled)
  const [loadingMore, setLoadingMore] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [hasMore, setHasMore] = useState(false)
  const [autoSync, setAutoSync] = useState(true)
  const [configured, setConfigured] = useState(true)
  const [syncError, setSyncError] = useState('')
  const oldest = useRef('')
  const booted = useRef(false)

  const apply = useCallback((feed: DiscordFeed, mode: 'first' | 'more' | 'poll') => {
    setSections(feed.sections)
    setAutoSync(feed.autoSync)
    setConfigured(feed.configured)
    setSyncError(feed.syncError)
    if (mode === 'more') {
      setItems((current) => mergeFeedItems(current, feed.media))
      oldest.current = feed.oldest || oldest.current
    } else {
      setItems((current) => (mode === 'poll' ? mergeFeedItems(current, feed.media) : feed.media))
      oldest.current = feed.oldest || ''
    }
    setHasMore(feed.hasMore)
  }, [])

  const load = useCallback(async (mode: 'first' | 'more' | 'poll') => {
    if (mode === 'first') setLoading(true)
    else if (mode === 'more') setLoadingMore(true)
    else setRefreshing(true)
    try {
      const feed = await fetchDiscordFeed({
        channelId,
        limit: pageSize,
        before: mode === 'more' ? oldest.current : ''
      })
      apply(feed, mode)
      setError('')
    } catch (caught) {
      // A failed background poll must never blank a screen that already has media.
      if (mode === 'first') setError(caught instanceof Error ? caught.message : 'Discord feed unavailable.')
    } finally {
      setLoading(false)
      setLoadingMore(false)
      setRefreshing(false)
    }
  }, [apply, channelId, pageSize])

  useEffect(() => {
    if (!enabled) return
    booted.current = true
    void load('first')
  }, [enabled, load])

  // Background polling — the fallback behind the server's read-time auto-sync.
  useEffect(() => {
    if (!enabled || !autoSync) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const tick = async () => {
      if (document.visibilityState === 'visible') await load('poll')
      timer = setTimeout(() => { void tick() }, Math.max(MIN_POLL_MS, Math.min(items.length ? DEFAULT_POLL_MS : 10000, 60000)))
    }
    timer = setTimeout(() => { void tick() }, Math.max(MIN_POLL_MS, 10000))
    const onVisible = () => { if (document.visibilityState === 'visible') void load('poll') }
    document.addEventListener('visibilitychange', onVisible)
    return () => { if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible) }
  }, [autoSync, enabled, items.length, load])

  return {
    items,
    sections,
    loading,
    loadingMore,
    refreshing,
    error,
    hasMore,
    autoSync,
    configured,
    syncError,
    loadMore: () => { if (!loadingMore && hasMore) void load('more') },
    refresh: () => { void load('poll') }
  }
}
