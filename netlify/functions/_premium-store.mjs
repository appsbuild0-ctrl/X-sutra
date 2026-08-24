import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'

const ADMIN_PASSWORD = process.env.PREMIUM_ADMIN_PASSWORD || 'admin123'
const LOCAL_FILE = process.env.PREMIUM_LOCAL_FILE || ''

export function adminPassword() {
  return ADMIN_PASSWORD
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  }
}

export const defaultSettings = {
  premiumUpload: true,
  urlImport: true,
  imageUpload: true,
  videoUpload: true,
  fileUpload: false,
  albumCreation: true,
  channelCreation: true,
  announcements: true,
  newVideoNotifications: true
}

function emptyCatalog() {
  return {
    settings: { ...defaultSettings },
    channels: [],
    albums: [],
    media: [],
    announcements: []
  }
}

async function blobStore() {
  const { getStore } = await import('@netlify/blobs')
  return getStore('premium-posts')
}

export async function readCatalog() {
  try {
    if (LOCAL_FILE) {
      if (!existsSync(LOCAL_FILE)) return emptyCatalog()
      const parsed = JSON.parse(await readFile(LOCAL_FILE, 'utf8'))
      return normalizeCatalog(parsed)
    }
    const store = await blobStore()
    const raw = await store.get('catalog')
    if (raw) return normalizeCatalog(JSON.parse(raw))
    const legacy = await store.get('posts')
    const catalog = emptyCatalog()
    if (legacy) {
      const posts = JSON.parse(legacy)
      if (Array.isArray(posts)) {
        catalog.media = posts.map((post) => ({
          id: post.id,
          type: 'video',
          url: post.videoUrl,
          thumbnail: post.thumbnail || '',
          title: post.title || 'Premium clip',
          tags: [],
          channelId: '',
          albumId: '',
          sourcePage: '',
          createdAt: post.createdAt || new Date().toISOString()
        }))
      }
    }
    return catalog
  } catch {
    return emptyCatalog()
  }
}

function normalizeCatalog(raw) {
  const catalog = emptyCatalog()
  if (!raw || typeof raw !== 'object') return catalog
  catalog.settings = { ...defaultSettings, ...(raw.settings || {}) }
  catalog.channels = Array.isArray(raw.channels) ? raw.channels : []
  catalog.albums = Array.isArray(raw.albums) ? raw.albums : []
  catalog.media = Array.isArray(raw.media) ? raw.media : []
  catalog.announcements = Array.isArray(raw.announcements) ? raw.announcements : []
  return catalog
}

export async function writeCatalog(catalog) {
  const next = {
    settings: { ...defaultSettings, ...catalog.settings },
    channels: (catalog.channels || []).slice(0, 80),
    albums: (catalog.albums || []).slice(0, 200),
    media: (catalog.media || []).slice(0, 4000),
    announcements: (catalog.announcements || []).slice(0, 200)
  }
  const payload = JSON.stringify(next)
  if (LOCAL_FILE) {
    await writeFile(LOCAL_FILE, payload, 'utf8')
    return next
  }
  const store = await blobStore()
  await store.set('catalog', payload)
  return next
}

export function nid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export function announce(catalog, title, detail, kind) {
  if (!catalog.settings.announcements) return
  catalog.announcements.unshift({
    id: nid('ann'),
    title,
    detail: String(detail || '').slice(0, 240),
    kind,
    createdAt: new Date().toISOString()
  })
}

export function publicCatalog(catalog) {
  const channels = catalog.channels.filter((channel) => channel.status !== 'off').sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  const channelIds = new Set(channels.map((channel) => channel.id))
  const albums = catalog.albums.filter((album) => album.published !== false && (!album.channelId || channelIds.has(album.channelId)))
  const albumIds = new Set(albums.map((album) => album.id))
  const media = catalog.media.filter((item) => {
    if (item.channelId && !channelIds.has(item.channelId)) return false
    if (item.albumId && !albumIds.has(item.albumId)) return false
    return true
  })
  return {
    settings: catalog.settings,
    channels,
    albums,
    media,
    announcements: catalog.settings.announcements ? catalog.announcements : []
  }
}

export function mediaToItem(entry) {
  const isVideo = entry.type === 'video'
  return {
    id: entry.id,
    title: entry.title || (isVideo ? 'Premium video' : 'Premium image'),
    description: entry.title || '',
    creator: 'premium',
    thumbnail: entry.thumbnail || (isVideo ? '' : entry.url),
    thumbnailUrls: [entry.thumbnail || (!isVideo ? entry.url : '')].filter(Boolean),
    previewUrl: isVideo ? entry.url : undefined,
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
