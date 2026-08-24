import { Capacitor } from '@capacitor/core'
import { mediaProxyUrl } from './media'
import type { MediaItem } from '../types'

/**
 * Public no-login media source (getredgifs.com/api). Its JSON lists the
 * permanent, unsigned media.redgifs.com files — the original clean variants,
 * not the watermarked ones the browser-facing API hands out.
 *
 * Transport order: direct browser call (works when the endpoint is CORS
 * open) → same-origin Netlify Function proxy (`?src=getredgifs`) → give up
 * and let the caller fall back to the built-in API flow.
 */
const DIRECT_BASE = 'https://getredgifs.com/api'
const PROXY_PATH = '/api/redgifs'

type GrgMode = 'direct' | 'proxy' | 'off'
let grgMode: GrgMode = 'direct'

interface RawUrls {
  hd?: string
  sd?: string
  silent?: string
  thumbnail?: string
  poster?: string
  hdUrl?: string
  sdUrl?: string
  silentUrl?: string
  thumbnailUrl?: string
}

interface RawRow {
  id?: string
  title?: string | null
  userName?: string
  urls?: RawUrls
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

async function grgFetch(path: string): Promise<unknown> {
  if (Capacitor.isNativePlatform()) throw new Error('native build uses its own transport')

  if (grgMode === 'direct') {
    try {
      const response = await fetch(`${DIRECT_BASE}${path}`, { headers: { Accept: 'application/json' } })
      if (response.ok && (response.headers.get('content-type') ?? '').includes('json')) {
        return await response.json()
      }
      throw new Error(`direct source failed (${response.status})`)
    } catch {
      grgMode = 'proxy'
    }
  }

  if (grgMode === 'proxy') {
    try {
      const url = new URL(PROXY_PATH, window.location.origin)
      url.searchParams.set('src', 'getredgifs')
      url.searchParams.set('path', path)
      const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
      if (response.ok && (response.headers.get('content-type') ?? '').includes('json')) {
        return await response.json()
      }
      throw new Error(`proxied source failed (${response.status})`)
    } catch {
      grgMode = 'off'
    }
  }

  throw new Error('Public media source unavailable')
}

function toMediaItem(row: RawRow): MediaItem | null {
  const urls = row.urls ?? {}
  const id = str(row.id)
  const hd = str(urls.hd) || str(urls.hdUrl)
  const sd = str(urls.sd) || str(urls.sdUrl)
  const silent = str(urls.silent) || str(urls.silentUrl)
  const thumb = str(urls.thumbnail) || str(urls.thumbnailUrl)
  const poster = str(urls.poster)
  const creator = str(row.userName) || 'creator'
  if (!id || !(hd || sd || silent)) return null
  const title = str(row.title) || `@${creator} clip`
  const thumbCandidates = [thumb, poster].filter(Boolean)
  const thumbsWithProxy = [...thumbCandidates]
  for (const url of thumbCandidates) {
    const proxy = mediaProxyUrl(url)
    if (proxy) thumbsWithProxy.push(proxy)
  }
  return {
    id,
    title,
    description: title,
    creator,
    thumbnail: thumbsWithProxy[0] ?? '',
    thumbnailUrls: thumbsWithProxy,
    previewUrl: silent || sd || hd,
    videoUrl: hd || sd || silent,
    videoUrlSd: sd || hd || silent,
    sourceUrl: `https://www.redgifs.com/watch/${encodeURIComponent(id)}`,
    duration: 0,
    likes: 0,
    views: 0,
    width: 0,
    height: 0,
    createdAt: 0,
    hasAudio: true,
    tags: [],
    niches: []
  }
}

function rows(value: unknown): RawRow[] {
  if (Array.isArray(value)) return value as RawRow[]
  const data = (value as { data?: unknown })?.data
  return Array.isArray(data) ? (data as RawRow[]) : []
}

/** Trending feed (one batch of clean-URL clips). */
export async function grgTrending(): Promise<MediaItem[]> {
  const data = await grgFetch('/trending')
  return rows(data).map(toMediaItem).filter((item): item is MediaItem => item !== null)
}

/** A creator's clips (or a single clip when the query resolves to a gif id). */
export async function grgUserFeed(query: string, page = 1): Promise<{ items: MediaItem[]; hasMore: boolean } | null> {
  const trimmed = query.trim()
  if (!trimmed) return null
  const data = await grgFetch(`/search?query=${encodeURIComponent(trimmed)}&page=${page}`)
  const record = data as { hasMore?: boolean }
  const items = rows(data).map(toMediaItem).filter((item): item is MediaItem => item !== null)
  if (items.length === 0) return null
  return { items, hasMore: Boolean(record?.hasMore) }
}

/** Resolve one clip id to its clean direct media URLs. */
export async function grgGif(id: string): Promise<MediaItem | null> {
  const trimmed = id.trim()
  if (!trimmed) return null
  const data = await grgFetch(`/search?query=${encodeURIComponent(trimmed)}`)
  const direct = (data as { type?: string })?.type === 'gif' ? rows(data) : rows(data)
  const mapped = direct.map(toMediaItem).filter((item): item is MediaItem => item !== null)
  return mapped[0] ?? null
}
