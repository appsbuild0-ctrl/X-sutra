import { Capacitor, CapacitorHttp } from '@capacitor/core'
import { grgGif, grgTrending, grgUserFeed } from './getredgifs'
import type { Creator, CreatorProfile, FeedOrder, MediaItem, Niche, PageResult, TagSuggestion } from '../types'

/**
 * Browser calls stay same-origin. Git-connected Netlify builds use the function
 * proxy; static Netlify Drop builds use an included 200 rewrite proxy. Both
 * preserve the public temporary-token flow without a browser CORS failure.
 */
const ORIGIN = 'https://api.redgifs.com'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
// Same request fingerprint as the working backend proxy: the redgifs.com
// Referer/Origin pair is what makes the API return clean media URLs.
const SOURCE_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'User-Agent': USER_AGENT,
  Referer: 'https://www.redgifs.com/',
  Origin: 'https://www.redgifs.com'
}
const PROXY_PATH = '/api/redgifs'
// Web transport tiering: the bundled Netlify Function is preferred (it sends
// the app User-Agent, so the API returns clean media URLs). Deployments
// without functions (plain drag-and-drop sites) automatically fall back to
// the same-origin rewrite proxy, which forwards the browser User-Agent —
// feeds keep working everywhere; watermarks may return only on fallback.
type ProxyMode = 'function' | 'rewrite'
let proxyMode: ProxyMode = 'function'
let rewriteToken = ''
let rewriteTokenExpiry = 0
let nativeToken = ''
let nativeTokenExpiry = 0

type RawRecord = Record<string, unknown>

function record(value: unknown): RawRecord {
  return value && typeof value === 'object' ? (value as RawRecord) : {}
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function number(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

/** Collect string URLs from normal and alternate API response shapes. */
function nestedStrings(value: unknown, depth = 0): string[] {
  if (depth > 3 || value === null || value === undefined) return []
  if (typeof value === 'string') return value ? [value] : []
  if (Array.isArray(value)) return value.flatMap((entry) => nestedStrings(entry, depth + 1))
  if (typeof value === 'object') return Object.values(value as RawRecord).flatMap((entry) => nestedStrings(entry, depth + 1))
  return []
}

function uniqueUrls(values: string[]): string[] {
  return [...new Set(values
    .map((value) => value.startsWith('//') ? `https:${value}` : value)
    .filter((value) => /^https?:\/\//i.test(value)))]
}

/**
 * Any RedGifs media URL (signed, watermarked, or CDN-mirrored) contains the
 * permanent file name. The clean original variants live at fixed, unsigned
 * media.redgifs.com paths (proven by the public no-login source):
 *   <Name>.mp4 · <Name>-mobile.mp4 · <Name>-silent.mp4 · <Name>-mobile.jpg
 */
export function mediaNameFromUrl(url: string): string | null {
  const match = url.match(/(?:media|files|thumbs\d*)\.redgifs\.com\/(?:[^/?#]+\/)?([A-Za-z0-9][A-Za-z0-9_-]*?)\.(?:mp4|webm|m4s|jpe?g|png)(?:[?#]|$)/i)
  if (!match) return null
  return match[1].replace(/-(?:mobile|silent|poster|watermarked)$/i, '')
}

export function cleanMediaSet(name: string): { hd: string; sd: string; silent: string; thumb: string; poster: string } {
  const base = 'https://media.redgifs.com'
  return {
    hd: `${base}/${name}.mp4`,
    sd: `${base}/${name}-mobile.mp4`,
    silent: `${base}/${name}-silent.mp4`,
    thumb: `${base}/${name}-mobile.jpg`,
    poster: `${base}/${name}-poster.jpg`
  }
}

/**
 * RedGifs hands browser-like clients media URLs that point at its watermarked
 * file variant (an own /Watermarked/ path segment). The original file is
 * served from the same path without that segment, so derive the clean twin
 * and try it first; the API-provided URL stays as the fallback.
 */
export function cleanVariantOf(url: string): string | null {
  if (!/\/Watermarked(\/|$)/i.test(url)) return null
  const stripped = url.replace(/\/Watermarked(?=\/)/i, '')
  return stripped !== url ? stripped : null
}

function queryPath(pathname: string, params: Record<string, string | number | boolean | undefined> = {}): string {
  const url = new URL(pathname, ORIGIN)
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }
  return `${url.pathname}${url.search}`
}

function responseData<T>(data: unknown): T {
  if (typeof data !== 'string') return data as T
  try {
    return JSON.parse(data) as T
  } catch {
    throw new Error('The public API returned an invalid JSON response')
  }
}

async function nativeTemporaryToken(force = false): Promise<string> {
  if (!force && nativeToken && Date.now() < nativeTokenExpiry) return nativeToken
  const response = await CapacitorHttp.get({
    url: `${ORIGIN}/v2/auth/temporary`,
    headers: { ...SOURCE_HEADERS }
  })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Temporary public token request failed (${response.status})`)
  }
  const data = responseData<{ token?: string }>(response.data)
  if (!data.token) throw new Error('Temporary public token response was empty')
  nativeToken = data.token
  nativeTokenExpiry = Date.now() + 40 * 60 * 1000
  return nativeToken
}

/** Native HTTP keeps the Android build on the same anonymous API flow without browser CORS. */
async function nativeRequest<T>(path: string, retry = true): Promise<T> {
  const token = await nativeTemporaryToken(!retry)
  const response = await CapacitorHttp.get({
    url: `${ORIGIN}${path}`,
    headers: {
      ...SOURCE_HEADERS,
      Authorization: `Bearer ${token}`
    }
  })
  if (response.status === 401 && retry) {
    nativeToken = ''
    nativeTokenExpiry = 0
    return nativeRequest<T>(path, false)
  }
  if (response.status < 200 || response.status >= 300) {
    const detail = typeof response.data === 'string' ? response.data.slice(0, 180) : JSON.stringify(response.data).slice(0, 180)
    throw new Error(`Live public data request failed (${response.status})${detail ? ` — ${detail}` : ''}`)
  }
  return responseData<T>(response.data)
}

async function rewriteTemporaryToken(force = false): Promise<string> {
  if (!force && rewriteToken && Date.now() < rewriteTokenExpiry) return rewriteToken
  const response = await fetch(`${PROXY_PATH}/v2/auth/temporary`, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Temporary public token request failed (${response.status})`)
  const data = await response.json() as { token?: string }
  if (!data.token) throw new Error('Temporary public token response was empty')
  rewriteToken = data.token
  rewriteTokenExpiry = Date.now() + 40 * 60 * 1000
  return rewriteToken
}

async function rewriteRequest<T>(path: string, retry = true): Promise<T> {
  const token = await rewriteTemporaryToken(!retry)
  const response = await fetch(`${PROXY_PATH}${path}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` }
  })
  if (response.status === 401 && retry) {
    rewriteToken = ''
    rewriteTokenExpiry = 0
    return rewriteRequest<T>(path, false)
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Live public data request failed (${response.status})${body ? ` — ${body.slice(0, 180)}` : ''}`)
  }
  return response.json() as Promise<T>
}

async function functionRequest<T>(path: string): Promise<T> {
  const url = new URL(PROXY_PATH, window.location.origin)
  url.searchParams.set('path', path)
  const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
  // A missing function (plain static deploy) is answered with 404 or the SPA
  // shell HTML — both mean "no function here", never valid feed data.
  if (!response.ok) throw new Error(`Function proxy unavailable (${response.status})`)
  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('json')) throw new Error('Function proxy returned a non-JSON body')
  return response.json() as Promise<T>
}

async function request<T>(pathname: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const path = queryPath(pathname, params)
  if (Capacitor.isNativePlatform()) return nativeRequest<T>(path)

  if (proxyMode === 'function') {
    try {
      return await functionRequest<T>(path)
    } catch {
      proxyMode = 'rewrite'
    }
  }
  return rewriteRequest<T>(path)
}

function mediaFromRaw(value: unknown): MediaItem {
  const raw = record(value)
  const urls = record(raw.urls)
  const id = text(raw.id) || text(raw.gifId)
  const tags = stringList(raw.tags)
  const description = text(raw.description) || text(raw.title)
  const title = description || tags.slice(0, 3).join(' · ') || `Clip ${id}`
  // Some feeds use alternate property names or nest source variants. Preserve
  // every real URL candidate, then let the card/player try the best type first.
  const allUrls = uniqueUrls([
    ...nestedStrings(urls),
    ...nestedStrings({
      thumbnail: raw.thumbnail,
      thumbnailUrl: raw.thumbnailUrl,
      poster: raw.poster,
      posterUrl: raw.posterUrl,
      previewUrl: raw.previewUrl,
      videoUrl: raw.videoUrl,
      media: raw.media
    })
  ])
  const imageUrls = allUrls.filter((url) => /(?:thumb|poster|preview)|\.(?:jpe?g|png|webp|gif)(?:[?#]|$)/i.test(url))
  const videoUrls = allUrls.filter((url) => /(?:silent|video)|\.(?:mp4|webm|m3u8)(?:[?#]|$)/i.test(url))
  const thumbnailUrls = uniqueUrls([
    text(urls.poster), text(urls.thumbnail), text(urls.vthumbnail),
    text(raw.thumbnail), text(raw.thumbnailUrl), text(raw.poster), text(raw.posterUrl),
    ...imageUrls, ...allUrls
  ])
  const rawVideoCandidates = uniqueUrls([
    text(urls.hd), text(urls.sd), text(urls.silent), text(urls.gif),
    text(raw.videoUrl), text(raw.previewUrl), ...videoUrls
  ])
  // Derive the permanent clean media set from the file name found in ANY of
  // the API-provided URLs; the originals stay as last-resort fallbacks.
  const mediaName = rawVideoCandidates.concat(thumbnailUrls).map((url) => mediaNameFromUrl(url)).find((name): name is string => Boolean(name))
  const cleanSet = mediaName ? cleanMediaSet(mediaName) : null
  const cleanFirst: string[] = cleanSet ? [cleanSet.hd, cleanSet.sd, cleanSet.silent] : []
  const watermarked: string[] = []
  for (const url of rawVideoCandidates) {
    const clean = cleanVariantOf(url)
    if (clean) {
      cleanFirst.push(clean)
      watermarked.push(url)
    } else if (/\/Watermarked(\/|$)/i.test(url)) watermarked.push(url)
    else cleanFirst.push(url)
  }
  const preferredVideos = uniqueUrls([...cleanFirst, ...watermarked])

  return {
    id,
    title,
    description,
    creator: text(raw.userName) || text(raw.username) || text(raw.user) || 'creator',
    thumbnail: thumbnailUrls[0],
    thumbnailUrls: cleanSet ? uniqueUrls([...thumbnailUrls, cleanSet.thumb, cleanSet.poster]) : thumbnailUrls,
    previewUrl: cleanSet ? cleanSet.silent : text(urls.silent) || videoUrls[0] || preferredVideos[0],
    videoUrl: preferredVideos[0],
    videoUrlSd: preferredVideos.find((url, index) => index > 0 && /\.(?:mp4|webm)/i.test(url)) ?? preferredVideos[1],
    watermarkedUrls: watermarked,
    sourceUrl: `https://www.redgifs.com/watch/${encodeURIComponent(id)}`,
    duration: number(raw.duration),
    likes: number(raw.likes) || number(raw.likesCount),
    views: number(raw.views) || number(raw.viewsCount),
    width: number(raw.width),
    height: number(raw.height),
    createdAt: number(raw.createDate),
    hasAudio: Boolean(raw.hasAudio),
    tags,
    niches: stringList(raw.niches)
  }
}

function mediaPage(data: unknown): PageResult<MediaItem> {
  const raw = record(data)
  const rows = Array.isArray(raw.gifs)
    ? raw.gifs
    : Array.isArray(raw.items)
      ? raw.items
      : Array.isArray(raw.contents)
        ? raw.contents
        : []
  return {
    items: rows.map(mediaFromRaw).filter((item) => Boolean(item.id)),
    page: number(raw.page, 1),
    pages: number(raw.pages, 1),
    total: number(raw.total, rows.length)
  }
}

function creatorFromRaw(value: unknown): Creator {
  const raw = record(value)
  const username = text(raw.username) || text(raw.userName)
  return {
    username,
    displayName: text(raw.name) || username,
    avatar: text(raw.profileImageUrl) || text(raw.avatar) || undefined,
    profileUrl: text(raw.profileUrl) || text(raw.url) || undefined,
    followers: number(raw.followers),
    gifs: number(raw.gifs) || number(raw.totalGifs),
    views: number(raw.views),
    verified: Boolean(raw.verified)
  }
}

function nicheFromRaw(value: unknown): Niche | null {
  const raw = record(value)
  const id = text(raw.id) || text(raw.name)
  const name = text(raw.name) || text(raw.title)
  if (!id || !name) return null
  return {
    id,
    name,
    description: text(raw.description),
    gifs: number(raw.gifs) || number(raw.contentCount),
    subscribers: number(raw.subscribers),
    thumbnail: text(raw.thumbnail) || text(raw.thumb) || undefined,
    cover: text(raw.cover) || undefined,
    owner: text(raw.owner) || undefined
  }
}

export const publicMediaApi = {
  async trending(page = 1): Promise<PageResult<MediaItem>> {
    // The public no-login source provides the first trending batch with
    // permanent clean media URLs; deeper pages use the direct API flow.
    if (page === 1) {
      try {
        const items = await grgTrending()
        if (items.length) return { items, page: 1, pages: 2, total: items.length }
      } catch { /* fall through to the API flow */ }
    }
    return mediaPage(await request('/v2/feeds/trending/popular', { page, count: 48 }))
  },

  async latest(page = 1, order: FeedOrder = 'latest'): Promise<PageResult<MediaItem>> {
    return mediaPage(await request('/v2/gifs/search', { page, count: 48, order }))
  },

  async search(query: string, page = 1, order: FeedOrder = 'latest'): Promise<PageResult<MediaItem>> {
    return mediaPage(await request('/v2/gifs/search', { page, count: 48, order, query: query.trim() }))
  },

  async tag(tag: string, page = 1, order: FeedOrder = 'latest'): Promise<PageResult<MediaItem>> {
    return mediaPage(await request('/v2/gifs/search', { page, count: 48, order, query: tag.trim() }))
  },

  async getById(id: string): Promise<MediaItem> {
    try {
      const resolved = await grgGif(id)
      if (resolved) return resolved
    } catch { /* fall through to the API flow */ }
    const raw = record(await request('/v2/gifs/' + encodeURIComponent(id)))
    return mediaFromRaw(raw.gif ?? raw)
  },

  async similar(id: string, page = 1): Promise<PageResult<MediaItem>> {
    return mediaPage(await request('/v2/recommend/tags/' + encodeURIComponent(id), { page, count: 48 }))
  },

  async creators(query = '', page = 1): Promise<Creator[]> {
    const data = record(await request('/v2/creators/search', {
      page,
      count: 24,
      order: query ? undefined : 'best',
      query: query.trim() || undefined
    }))
    const rows = Array.isArray(data.items)
      ? data.items
      : Array.isArray(data.creators)
        ? data.creators
        : Array.isArray(data.users)
          ? data.users
          : []
    return rows.map(creatorFromRaw).filter((creator) => Boolean(creator.username))
  },

  async creator(username: string, page = 1, order: FeedOrder = 'latest'): Promise<PageResult<MediaItem>> {
    try {
      const feed = await grgUserFeed(username, page)
      if (feed) return { items: feed.items, page, pages: page + (feed.hasMore ? 1 : 0), total: feed.items.length }
    } catch { /* fall through to the API flow */ }
    return mediaPage(await request(`/v2/users/${encodeURIComponent(username)}/search`, { page, count: 48, order }))
  },

  async creatorProfile(username: string): Promise<CreatorProfile> {
    const raw = record(await request('/v1/users/' + encodeURIComponent(username)))
    const base = creatorFromRaw(raw)
    return {
      ...base,
      username: base.username || username,
      displayName: base.displayName || username,
      following: number(raw.following),
      likes: number(raw.likes)
    }
  },

  async creatorTags(username: string): Promise<string[]> {
    const data = await request<unknown>('/v2/creators/' + encodeURIComponent(username) + '/tags')
    return Array.isArray(data) ? stringList(data) : stringList(record(data).tags)
  },

  async suggestions(query: string): Promise<TagSuggestion[]> {
    if (!query.trim()) return []
    const rows = await request<Array<RawRecord>>('/v2/search/suggest', { query: query.trim() })
    return (Array.isArray(rows) ? rows : [])
      .filter((item) => text(item.type) === 'tag' && Boolean(text(item.text)))
      .map((item) => ({ text: text(item.text), gifs: number(item.gifs) }))
  },

  async niches(): Promise<Niche[]> {
    const raw = record(await request('/v2/niches/trending/search'))
    const rows = Array.isArray(raw.niches) ? raw.niches : []
    return rows.map(nicheFromRaw).filter((item): item is Niche => item !== null)
  },

  async categories(): Promise<string[]> {
    const raw = record(await request('/v2/niches/categories'))
    return stringList(raw.categories)
  },

  async searchNiches(query: string): Promise<Niche[]> {
    if (!query.trim()) return []
    const raw = record(await request('/v2/niches/search', { order: 'best_match', page: 1, query: query.trim() }))
    const rows = Array.isArray(raw.niches) ? raw.niches : []
    return rows.map(nicheFromRaw).filter((item): item is Niche => item !== null)
  },

  async niche(id: string, page = 1, order: FeedOrder = 'latest'): Promise<PageResult<MediaItem>> {
    return mediaPage(await request('/v2/niches/' + encodeURIComponent(id) + '/gifs', { page, count: 48, order }))
  },

  async relatedNiches(id: string): Promise<Niche[]> {
    const raw = record(await request('/v2/niches/' + encodeURIComponent(id) + '/related'))
    const rows = Array.isArray(raw.niches) ? raw.niches : Array.isArray(raw) ? raw : []
    return rows.map(nicheFromRaw).filter((item): item is Niche => item !== null)
  }
}

export function redgifsIdFromLink(input: string): string | null {
  const value = input.trim()
  if (!value) return null
  if (/^[a-z0-9]{5,}$/i.test(value)) return value
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`)
    const hostname = url.hostname.toLowerCase()
    if (hostname !== 'redgifs.com' && !hostname.endsWith('.redgifs.com')) return null
    const parts = url.pathname.split('/').filter(Boolean)
    const watch = parts.findIndex((part) => part.toLowerCase() === 'watch')
    const candidate = watch >= 0 ? parts[watch + 1] : parts[parts.length - 1]
    return candidate && /^[a-z0-9]+$/i.test(candidate) ? candidate : null
  } catch {
    return null
  }
}
