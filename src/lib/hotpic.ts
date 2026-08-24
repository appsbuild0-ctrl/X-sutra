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

function parseFeed(html: string): HotpicAlbumCard[] {
  const albums: HotpicAlbumCard[] = []
  const seen = new Set<string>()
  const re = /\/album\/([A-Za-z0-9_-]{4,})/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(html))) {
    const id = match[1]
    if (seen.has(id)) continue
    seen.add(id)
    const window = html.slice(Math.max(0, match.index - 240), match.index + 1400)
    const title = decode(window.match(/title=["']([^"']+)["']/i)?.[1] || `Album ${id}`)
    const cover = window.match(/src=["'](https?:\/\/cdn[^"']+)["']/i)?.[1]
      || window.match(/src=["'](https?:\/\/[^"']+\.(?:webp|jpe?g|png)[^"']*)["']/i)?.[1]
      || ''
    const owner = decodeURIComponent(window.match(/\/u\/([^"'/#?]+)/i)?.[1] || '')
    albums.push({
      id,
      title,
      cover,
      url: `${ORIGIN}/album/${id}`,
      owner,
      hasVideo: /m-play|play_circle|\.mp4|video/i.test(window)
    })
  }
  return albums
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
  return {
    username,
    displayName: decode(name),
    avatar: `${ORIGIN}/images/user/${encodeURIComponent(username)}.jpg`,
    profileUrl: `${ORIGIN}/u/${encodeURIComponent(username)}`,
    albums,
    joined,
    items: parseFeed(html)
  }
}

function parseAlbum(html: string, id: string): HotpicAlbum {
  const title = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() || `Album ${id}`
  const owner = html.match(/\/u\/([^"'/]+)/i)?.[1] || 'hotpic'
  const media: MediaItem[] = []
  const image = /\/i\/([A-Za-z0-9_-]+)[^>]{0,220}title=["']([^"']*)["'][\s\S]{0,280}?src=["'](https?:\/\/[^"']+)["']/gi
  let match: RegExpExecArray | null
  while ((match = image.exec(html))) {
    const itemId = match[1]
    const name = decode(match[2])
    const thumb = match[3]
    const isVideo = /\.(mp4|mov|avi|webm)$/i.test(name)
    media.push({
      id: `hp-${itemId}`,
      title: name,
      description: title,
      creator: owner,
      thumbnail: thumb,
      thumbnailUrls: [thumb],
      previewUrl: isVideo ? undefined : fullFromThumb(thumb),
      videoUrl: isVideo ? `${ORIGIN}/i/${itemId}` : undefined,
      sourceUrl: `${ORIGIN}/i/${itemId}`,
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
  if (!media.length) {
    const loose = /\/i\/([A-Za-z0-9_-]+)/gi
    while ((match = loose.exec(html))) {
      if (media.some((item) => item.id === `hp-${match![1]}`)) continue
      const window = html.slice(match.index, match.index + 500)
      const thumb = window.match(/src=["'](https?:\/\/[^"']+)["']/i)?.[1] || ''
      media.push({
        id: `hp-${match[1]}`,
        title: match[1],
        description: title,
        creator: owner,
        thumbnail: thumb,
        thumbnailUrls: thumb ? [thumb] : [],
        previewUrl: thumb ? fullFromThumb(thumb) : undefined,
        sourceUrl: `${ORIGIN}/i/${match[1]}`,
        duration: 0,
        likes: 0,
        views: 0,
        width: 0,
        height: 0,
        createdAt: Date.now(),
        hasAudio: false,
        tags: [],
        niches: []
      })
    }
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
  if (!response.ok || body.trim().startsWith('<!DOCTYPE html>') && body.includes('id="root"')) {
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

async function loadPage(kind: 'feed' | 'user' | 'album', params: { tag?: string; page?: number; u?: string; id?: string }): Promise<string> {
  const path = kind === 'user'
    ? `/u/${encodeURIComponent(params.u || '')}`
    : kind === 'album'
      ? `/album/${encodeURIComponent(params.id || '')}`
      : `/t/${encodeURIComponent(params.tag || 'Desi')}${params.page && params.page > 1 ? `?page=${params.page}` : ''}`
  if (Capacitor.isNativePlatform()) return nativeHtml(path)
  return proxyHtml(path)
}

export const hotpicApi = {
  async topModels(): Promise<Creator[]> {
    try {
      const data = await functionJson<{ users?: Creator[] }>({ path: 'desi' })
      const live = Array.isArray(data.users) ? data.users.filter((user) => user.username) : []
      if (live.length) return live
    } catch { /* parse HTML next */ }
    try {
      const users = parseUsers(await loadPage('feed', { tag: 'Desi', page: 1 }))
      return users.length ? users : FALLBACK_MODELS
    } catch {
      return FALLBACK_MODELS
    }
  },
  async profile(username: string): Promise<HotpicProfile> {
    try {
      const data = await functionJson<HotpicProfile>({ path: 'user', u: username })
      if (data.username) return data
    } catch { /* parse HTML next */ }
    try {
      return parseProfile(await loadPage('user', { u: username }), username)
    } catch {
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
  },
  async album(id: string): Promise<HotpicAlbum> {
    try {
      const data = await functionJson<HotpicAlbum>({ path: 'album', id })
      if (data.id) return data
    } catch { /* parse HTML next */ }
    return parseAlbum(await loadPage('album', { id }), id)
  },
  async feed(tag = 'Desi', page = 1): Promise<{ users: Creator[]; albums: HotpicAlbumCard[] }> {
    try {
      const data = await functionJson<{ users?: Creator[]; albums?: HotpicAlbumCard[] }>({ path: 'feed', tag, page: String(page) })
      const users = Array.isArray(data.users) ? data.users : []
      const albums = Array.isArray(data.albums) ? data.albums : []
      if (users.length || albums.length) return { users, albums }
    } catch { /* parse HTML next */ }
    try {
      const html = await loadPage('feed', { tag, page })
      const users = parseUsers(html)
      const albums = parseFeed(html)
      return { users: users.length ? users : FALLBACK_MODELS, albums }
    } catch {
      return { users: FALLBACK_MODELS, albums: [] }
    }
  }
}
