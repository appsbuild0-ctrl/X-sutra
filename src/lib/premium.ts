import type { MediaItem } from '../types'

export interface PremiumSettings {
  premiumUpload: boolean
  urlImport: boolean
  imageUpload: boolean
  videoUpload: boolean
  fileUpload: boolean
  albumCreation: boolean
  channelCreation: boolean
  announcements: boolean
  newVideoNotifications: boolean
}

export interface PremiumChannel {
  id: string
  name: string
  description: string
  cover: string
  type: 'images' | 'videos' | 'mixed'
  status: 'on' | 'off'
  order: number
  createdAt: string
}

export interface PremiumAlbum {
  id: string
  name: string
  description: string
  cover: string
  tags: string[]
  channelId: string
  published: boolean
  createdAt: string
  updatedAt: string
}

export interface PremiumMedia {
  id: string
  type: 'image' | 'video'
  url: string
  thumbnail: string
  title: string
  tags: string[]
  channelId: string
  albumId: string
  sourcePage: string
  createdAt: string
  filename?: string
  size?: number
  hash?: string
  role?: 'content' | 'hero'
}

export interface PremiumHero {
  id: string
  url: string
  thumbnail: string
  title: string
  createdAt: string
  published?: boolean
}

export interface PremiumAnnouncement {
  id: string
  title: string
  detail: string
  kind: string
  target?: string
  createdAt: string
}

export interface PremiumCatalog {
  settings: PremiumSettings
  channels: PremiumChannel[]
  albums: PremiumAlbum[]
  media: PremiumMedia[]
  heroes: PremiumHero[]
  announcements: PremiumAnnouncement[]
}

export interface ScanItem {
  url: string
  type: 'image' | 'video'
  filename: string
  sourcePage: string
  thumbnail: string
}

export interface ScanPage {
  url: string
  images: ScanItem[]
  videos: ScanItem[]
  error: string | null
}

const ENDPOINT = '/api/premium'
const SCAN = '/api/premium-scan'
export const ADMIN_KEY = 'admin123'

export const emptyCatalog = (): PremiumCatalog => ({
  settings: {
    premiumUpload: true,
    urlImport: true,
    imageUpload: true,
    videoUpload: true,
    fileUpload: false,
    albumCreation: true,
    channelCreation: true,
    announcements: true,
    newVideoNotifications: true
  },
  channels: [],
  albums: [],
  media: [],
  heroes: [],
  announcements: []
})

export async function fetchPremiumCatalog(): Promise<PremiumCatalog> {
  try {
    const response = await fetch(ENDPOINT, { headers: { Accept: 'application/json' } })
    if (!response.ok) return emptyCatalog()
    const data = await response.json() as Partial<PremiumCatalog>
    const fallback = emptyCatalog()
    return {
      settings: { ...fallback.settings, ...data.settings },
      channels: Array.isArray(data.channels) ? data.channels : [],
      albums: Array.isArray(data.albums) ? data.albums : [],
      media: Array.isArray(data.media) ? data.media : [],
      heroes: Array.isArray(data.heroes) ? data.heroes : [],
      announcements: Array.isArray(data.announcements) ? data.announcements : []
    }
  } catch {
    return emptyCatalog()
  }
}

export async function premiumAdmin(action: string, payload: Record<string, unknown> = {}): Promise<{ ok: boolean; error?: string; catalog?: PremiumCatalog; added?: number; skipped?: number }> {
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ password: ADMIN_KEY, action, ...payload })
    })
    const data = await response.json() as { error?: string; added?: number; skipped?: number; catalog?: PremiumCatalog } & Partial<PremiumCatalog>
    if (!response.ok) return { ok: false, error: data.error ?? `Request failed (${response.status})` }
    const catalog = data.catalog ?? (data.channels ? data as PremiumCatalog : undefined)
    return { ok: true, catalog, added: data.added, skipped: data.skipped }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Network error' }
  }
}

export async function scanPremiumPages(urls: string): Promise<{ ok: boolean; error?: string; pages?: ScanPage[]; totals?: { images: number; videos: number; media: number } }> {
  try {
    const response = await fetch(SCAN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ password: ADMIN_KEY, urls })
    })
    const data = await response.json() as { error?: string; pages?: ScanPage[]; totals?: { images: number; videos: number; media: number } }
    if (!response.ok) return { ok: false, error: data.error ?? `Scan failed (${response.status})` }
    return { ok: true, pages: data.pages, totals: data.totals }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Network error' }
  }
}

export function premiumMediaToItem(entry: PremiumMedia): MediaItem {
  const isVideo = entry.type === 'video'
  return {
    id: entry.id,
    title: entry.title || (isVideo ? 'Premium video' : 'Premium image'),
    description: entry.title || '',
    creator: 'premium',
    thumbnail: entry.thumbnail || (isVideo ? '' : entry.url),
    thumbnailUrls: [entry.thumbnail || (!isVideo ? entry.url : '')].filter(Boolean),
    previewUrl: isVideo ? entry.url : entry.url,
    videoUrl: isVideo ? entry.url : undefined,
    videoUrlSd: isVideo ? entry.url : undefined,
    sourceUrl: entry.url,
    duration: 0,
    likes: 0,
    views: 0,
    width: 0,
    height: 0,
    createdAt: Date.parse(entry.createdAt) || 0,
    hasAudio: isVideo,
    tags: entry.tags || [],
    niches: []
  }
}

export function searchPremium(catalog: PremiumCatalog, query: string) {
  const needle = query.trim().toLowerCase()
  if (!needle) return { albums: catalog.albums, media: catalog.media, channels: catalog.channels }
  const hit = (...parts: Array<string | string[] | undefined>) => parts.flat().join(' ').toLowerCase().includes(needle)
  const channels = catalog.channels.filter((channel) => hit(channel.name, channel.description, channel.type))
  const albums = catalog.albums.filter((album) => hit(album.name, album.description, album.tags))
  const media = catalog.media.filter((item) => hit(item.title, item.tags, item.url, item.sourcePage))
  const channelIds = new Set(channels.map((channel) => channel.id))
  const extraAlbums = catalog.albums.filter((album) => channelIds.has(album.channelId))
  const extraMedia = catalog.media.filter((item) => albums.some((album) => album.id === item.albumId) || channelIds.has(item.channelId))
  const albumMap = new Map([...albums, ...extraAlbums].map((album) => [album.id, album]))
  const mediaMap = new Map([...media, ...extraMedia].map((item) => [item.id, item]))
  return { channels, albums: [...albumMap.values()], media: [...mediaMap.values()] }
}

export async function importInBatches(
  items: ScanItem[],
  options: { channelId: string; albumId: string; title?: string; tags?: string; importDuplicates?: boolean },
  onProgress: (done: number, total: number, added: number, skipped: number, failed: number) => void
): Promise<{ added: number; skipped: number; failed: ScanItem[] }> {
  const chunkSize = 8
  let added = 0
  let skipped = 0
  const failed: ScanItem[] = []
  for (let index = 0; index < items.length; index += chunkSize) {
    const chunk = items.slice(index, index + chunkSize)
    const result = await premiumAdmin('importMedia', {
      items: chunk.map((item) => ({ ...item, title: options.title || item.filename })),
      channelId: options.channelId,
      albumId: options.albumId,
      tags: options.tags || '',
      importDuplicates: options.importDuplicates
    })
    if (!result.ok) failed.push(...chunk)
    else {
      added += result.added ?? 0
      skipped += result.skipped ?? 0
    }
    onProgress(Math.min(index + chunk.length, items.length), items.length, added, skipped, failed.length)
  }
  return { added, skipped, failed }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

export async function hashFile(file: File): Promise<string> {
  const slice = await file.slice(0, 65536).arrayBuffer()
  const digest = await crypto.subtle.digest('SHA-256', slice)
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex}:${file.size}:${file.name}`
}

export async function uploadPremiumFile(file: File): Promise<{ ok: boolean; url?: string; id?: string; error?: string }> {
  const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const buffer = new Uint8Array(await file.arrayBuffer())
  const chunkSize = 240_000
  const total = Math.max(1, Math.ceil(buffer.length / chunkSize))
  try {
    for (let index = 0; index < total; index += 1) {
      const data = bytesToBase64(buffer.subarray(index * chunkSize, (index + 1) * chunkSize))
      const response = await fetch('/api/premium-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          password: ADMIN_KEY,
          action: 'chunk',
          id,
          index,
          total,
          contentType: file.type || 'application/octet-stream',
          filename: file.name,
          data
        })
      })
      const payload = await response.json() as { error?: string; url?: string }
      if (!response.ok) return { ok: false, error: payload.error ?? `Upload failed (${response.status})` }
      if (index + 1 === total) return { ok: true, url: payload.url, id }
    }
    return { ok: true, url: `/api/premium-file?id=${id}`, id }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Upload failed' }
  }
}
