import { Capacitor, CapacitorHttp } from '@capacitor/core'
import type { Creator, MediaItem } from '../types'

const ORIGIN = 'https://hotpic.vip'
const ENDPOINT = '/api/hotpic'
const HTML_PROXY = '/api/hotpic-html'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const FALLBACK_MODELS: Creator[] = [
  'DesiHub', 'Nova.Black', 'Anonymous', 'mohnichohan56', 'ashiknishat95', 'wandaxhulk', 'Jhoncerry09'
].map((username) => ({
  username,
  displayName: username.replace(/\./g, ' '),
  avatar: `${ORIGIN}/images/user/${encodeURIComponent(username)}.jpg`,
  profileUrl: `${ORIGIN}/u/${encodeURIComponent(username)}`,
  followers: 0,
  gifs: 0,
  views: 0,
  verified: false
}))

export interface HotpicAlbumCard {
  id: string
  title: string
  cover: string
  url: string
  owner?: string
  hasVideo?: boolean
  kind?: 'album' | 'pic' | 'video'
}

export interface HotpicProfile {
  username: string
  displayName: string
  avatar: string
  profileUrl: string
  albums: number
  joined: string
  items: HotpicAlbumCard[]
}

export interface HotpicAlbum {
  id: string
  title: string
  owner: string
  items: MediaItem[]
}

export interface HotpicFeed {
  users: Creator[]
  albums: HotpicAlbumCard[]
  pics: HotpicAlbumCard[]
  videos: HotpicAlbumCard[]
}

function decode(value: string): string {
  return String(value || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
}

function parseUsers(html: string): Creator[] {
  const users = new Map<string, Creator>()
  const re = /(?:href|src)=["'](?:https?:\/\/(?:www\.)?hotpic\.(?:vip|cc|one))?\/u\/([^"'#?]+)/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    const username = decodeURIComponent(match[1])
    if (!username || users.has(username)) continue
    users.set(username, {
      username,
      displayName: username.replace(/\./g, ' '),
      avatar: `${ORIGIN}/images/user/${encodeURIComponent(username)}.jpg`,
      profileUrl: `${ORIGIN}/u/${encodeURIComponent(username)}`,
      followers: 0,
      gifs: 0,
      views: 0,
      verified: false
    })
  }
  return [...users.values()]
}

function cardFromWindow(id: string, kind: 'album' | 'pic' | 'video', html: string, index: number): HotpicAlbumCard {
  const slice = html.slice(Math.max(0, index - 240), index + 1400)
  const title = decode(slice.match(/title=["']([^"']+)["']/i)?.[1] || (kind === 'album' ? `Album ${id}` : id))
  const cover = slice.match(/src=["'](https?:\/\/cdn[^"']+)["']/i)?.[1]
    || slice.match(/src=["'](https?:\/\/[^"']+\.(?:webp|jpe?g|png)[^"']*)["']/i)?.[1]
    || ''
  const owner = decodeURIComponent(slice.match(/\/u\/([^"'/#?]+)/i)?.[1] || '')
  const looksVideo = kind === 'video' || /m-play|play_circle|\.(mp4|mov|avi|webm)/i.test(`${title} ${slice}`)
  return {
    id,
    title,
    cover,
    url: kind === 'album' ? `${ORIGIN}/album/${id}` : `${ORIGIN}/i/${id}`,
    owner,
    hasVideo: looksVideo,
    kind: kind === 'album' ? 'album' : looksVideo ? 'video' : 'pic'
  }
}

function parseFeed(html: string): HotpicAlbumCard[] {
  const cards: HotpicAlbumCard[] = []
  const seen = new Set<string>()
  const albumRe = /\/album\/([A-Za-z0-9_-]{4,})/gi
  let match: RegExpExecArray | null
  while ((match = albumRe.exec(html))) {
    if (seen.has(`a:${match[1]}`)) continue
    seen.add(`a:${match[1]}`)
    cards.push(cardFromWindow(match[1], 'album', html, match.index))
  }
  const itemRe = /\/i\/([A-Za-z0-9_-]{4,})/gi
  while ((match = itemRe.exec(html))) {
    if (seen.has(`i:${match[1]}`)) continue
    seen.add(`i:${match[1]}`)
    cards.push(cardFromWindow(match[1], 'pic', html, match.index))
  }
  return cards
}

function splitFeed(cards: HotpicAlbumCard[]): Pick<HotpicFeed, 'albums' | 'pics' | 'videos'> {
  return {
    albums: cards.filter((card) => (card.kind || 'album') === 'album'),
    pics: cards.filter((card) => card.kind === 'pic'),
    videos: cards.filter((card) => card.kind === 'video')
  }
}

function emptyProfile(username: string): HotpicProfile {
  return {
    username,
    displayName: username,
    avatar: `${ORIGIN}/images/user/${encodeURIComponent(username)}.jpg`,
    profileUrl: `${ORIGIN}/u/${encodeURIComponent(username)}`,
    albums: 0,
    joined: '',
    items: []
  }
}

function fullFromThumb(thumb: string): string {
  return thumb.replace('/thumb/', '/').replace(/\.webp(?:\?.*)?$/i, '.jpeg')
}

function parseProfile(html: string, username: string): HotpicProfile {
  const name = html.match(/<h[12][^>]*>\s*([^<]{2,80})\s*<\/h[12]>/i)?.[1]?.trim()
    || html.match(/@([A-Za-z0-9._-]{2,40})/)?.[1]
    || username
  const albums = Number(html.match(/(\d+)\s*Albums/i)?.[1] || 0)
  const joined = html.match(/Joined\s+([A-Za-z]+ \d{1,2}, \d{4})/i)?.[1] || ''
  const items = parseFeed(html)
  return {
    username,
    displayName: decode(name),
    avatar: `${ORIGIN}/images/user/${encodeURIComponent(username)}.jpg`,
    profileUrl: `${ORIGIN}/u/${encodeURIComponent(username)}`,
    albums: albums || items.filter((item) => item.kind === 'album').length,
    joined,
    items
  }
}

function parseAlbum(html: string, id: string): HotpicAlbum {
  const title = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() || `Album ${id}`
  const owner = html.match(/\/u\/([^"'/]+)/i)?.[1] || 'hotpic'
  const media: MediaItem[] = []
  const seen = new Set<string>()
  const loose = /\/i\/([A-Za-z0-9_-]+)/gi
  let match: RegExpExecArray | null
  while ((match = loose.exec(html))) {
    if (seen.has(match[1])) continue
    seen.add(match[1])
    const slice = html.slice(match.index, match.index + 700)
    const name = decode(slice.match(/title=["']([^"']+)["']/i)?.[1] || match[1])
    const thumb = slice.match(/src=["'](https?:\/\/[^"']+)["']/i)?.[1] || ''
    const isVideo = /\.(mp4|mov|avi|webm)/i.test(name) || /m-play|play_circle|<video/i.test(slice)
    media.push({
      id: `hp-${match[1]}`,
      title: name,
      description: title,
      creator: owner,
      thumbnail: thumb,
      thumbnailUrls: thumb ? [thumb] : [],
      previewUrl: isVideo ? undefined : (thumb ? fullFromThumb(thumb) : undefined),
      videoUrl: isVideo ? `${ORIGIN}/i/${match[1]}` : undefined,
      sourceUrl: `${ORIGIN}/i/${match[1]}`,
      duration: 0,
      likes: 0,
      views: 0,
      width: 0,
      height: 0,
      createdAt: Date.now(),
      hasAudio: isVideo,
      tags: [],
      niches: []
    })
  }
  return { id, title, owner, items: media }
}

function parseJsonSafe<T>(raw: string): T | null {
  const trimmed = raw.trim()
  if (!trimmed || trimmed.startsWith('<')) return null
  try {
    return JSON.parse(trimmed) as T
  } catch {
    return null
  }
}

async function nativeHtml(path: string): Promise<string> {
  const url = path.startsWith('http') ? path : `${ORIGIN}${path}`
  const response = await CapacitorHttp.get({
    url,
    headers: { Accept: 'text/html', 'User-Agent': UA, Referer: `${ORIGIN}/` }
  })
  const body = typeof response.data === 'string' ? response.data : String(response.data ?? '')
  if (response.status < 200 || response.status >= 300) throw new Error(`Hotpic request failed (${response.status})`)
  return body
}

async function proxyHtml(path: string): Promise<string> {
  const response = await fetch(`${HTML_PROXY}${path}`, { headers: { Accept: 'text/html' } })
  const body = await response.text()
  if (!response.ok || (body.trim().startsWith('<!DOCTYPE html>') && body.includes('id="root"'))) {
    throw new Error('Hotpic HTML proxy unavailable')
  }
  return body
}

async function functionJson<T>(params: Record<string, string>): Promise<T> {
  const url = new URL(ENDPOINT, window.location.origin)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
  const raw = await response.text()
  const data = parseJsonSafe<T & { error?: string }>(raw)
  if (!data) throw new Error('Hotpic API returned a page instead of data')
  if (!response.ok) throw new Error(data.error || `Hotpic request failed (${response.status})`)
  return data
}

async function loadPage(kind: 'feed' | 'user' | 'album' | 'item', params: { tag?: string; page?: number; u?: string; id?: string }): Promise<string> {
  const path = kind === 'user'
    ? `/u/${encodeURIComponent(params.u || '')}`
    : kind === 'album'
      ? `/album/${encodeURIComponent(params.id || '')}`
      : kind === 'item'
        ? `/i/${encodeURIComponent(params.id || '')}`
        : `/t/${encodeURIComponent(params.tag || 'Desi')}${params.page && params.page > 1 ? `?page=${params.page}` : ''}`
  if (Capacitor.isNativePlatform()) return nativeHtml(path)
  return proxyHtml(path)
}

function cardToMedia(card: HotpicAlbumCard): MediaItem {
  const isVideo = card.kind === 'video' || card.hasVideo
  return {
    id: `hp-${card.id}`,
    title: card.title,
    description: card.title,
    creator: card.owner || 'hotpic',
    thumbnail: card.cover,
    thumbnailUrls: card.cover ? [card.cover] : [],
    previewUrl: isVideo ? undefined : card.cover,
    videoUrl: isVideo ? card.url : undefined,
    sourceUrl: card.url,
    duration: 0,
    likes: 0,
    views: 0,
    width: 0,
    height: 0,
    createdAt: Date.now(),
    hasAudio: Boolean(isVideo),
    tags: [],
    niches: []
  }
}

export const hotpicApi = {
  cardToMedia,
  async topModels(): Promise<Creator[]> {
    const feed = await this.feed('Desi', 1)
    return feed.users.length ? feed.users : FALLBACK_MODELS
  },
  async profile(username: string): Promise<HotpicProfile> {
    let profile: HotpicProfile | null = null
    try {
      const data = await functionJson<HotpicProfile>({ path: 'user', u: username })
      if (data.username && data.items?.length) profile = data
    } catch { /* parse HTML next */ }
    if (!profile) {
      try {
        profile = parseProfile(await loadPage('user', { u: username }), username)
      } catch {
        profile = emptyProfile(username)
      }
    }
    if (!profile.items.length) {
      const feed = await this.feed('Desi', 1)
      const owned = [...feed.albums, ...feed.pics, ...feed.videos].filter((card) => card.owner && card.owner.toLowerCase() === username.toLowerCase())
      if (owned.length) profile = { ...profile, items: owned, albums: owned.filter((card) => card.kind === 'album').length }
    }
    return profile
  },
  async album(id: string): Promise<HotpicAlbum> {
    try {
      const data = await functionJson<HotpicAlbum>({ path: 'album', id })
      if (data.id && data.items?.length) return data
    } catch { /* parse HTML next */ }
    try {
      return parseAlbum(await loadPage('album', { id }), id)
    } catch {
      return { id, title: `Album ${id}`, owner: 'hotpic', items: [] }
    }
  },
  async item(id: string): Promise<MediaItem> {
    const html = await loadPage('item', { id })
    const parsed = parseAlbum(html, id)
    if (parsed.items[0]) return parsed.items[0]
    return cardToMedia({ id, title: id, cover: '', url: `${ORIGIN}/i/${id}`, kind: 'pic' })
  },
  async feed(tag = 'Desi', page = 1): Promise<HotpicFeed> {
    try {
      const data = await functionJson<{ users?: Creator[]; albums?: HotpicAlbumCard[] }>({ path: 'feed', tag, page: String(page) })
      const users = Array.isArray(data.users) ? data.users : []
      const cards = Array.isArray(data.albums) ? data.albums : []
      if (users.length || cards.length) return { users: users.length ? users : FALLBACK_MODELS, ...splitFeed(cards) }
    } catch { /* parse HTML next */ }
    try {
      const html = await loadPage('feed', { tag, page })
      const users = parseUsers(html)
      return { users: users.length ? users : FALLBACK_MODELS, ...splitFeed(parseFeed(html)) }
    } catch {
      return { users: FALLBACK_MODELS, albums: [], pics: [], videos: [] }
    }
  }
}
