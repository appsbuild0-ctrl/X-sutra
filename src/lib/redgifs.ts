import type { Creator, CreatorProfile, FeedOrder, MediaItem, Niche, PageResult, TagSuggestion } from '../types'

/**
 * Browser calls stay same-origin. In production Netlify's function obtains a
 * temporary public token server-side, then calls the public RedGifs V2 API.
 * That avoids exposing a user token and avoids browser CORS failures.
 */
const PROXY_PATH = '/api/redgifs'

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

function queryPath(pathname: string, params: Record<string, string | number | boolean | undefined> = {}): string {
  const url = new URL(pathname, 'https://api.redgifs.com')
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') url.searchParams.set(key, String(value))
  }
  return `${url.pathname}${url.search}`
}

async function request<T>(pathname: string, params?: Record<string, string | number | boolean | undefined>): Promise<T> {
  const path = queryPath(pathname, params)
  const url = new URL(PROXY_PATH, window.location.origin)
  url.searchParams.set('path', path)

  const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    const detail = body ? ` — ${body.slice(0, 180)}` : ''
    throw new Error(`Live public data request failed (${response.status})${detail}`)
  }
  return response.json() as Promise<T>
}

function mediaFromRaw(value: unknown): MediaItem {
  const raw = record(value)
  const urls = record(raw.urls)
  const id = text(raw.id) || text(raw.gifId)
  const tags = stringList(raw.tags)
  const description = text(raw.description) || text(raw.title)
  const title = description || tags.slice(0, 3).join(' · ') || `Clip ${id}`

  return {
    id,
    title,
    description,
    creator: text(raw.userName) || text(raw.username) || text(raw.user) || 'creator',
    thumbnail: text(urls.poster) || text(urls.thumbnail) || text(urls.vthumbnail) || text(raw.thumbnail) || undefined,
    previewUrl: text(urls.vthumbnail) || text(urls.silent) || text(urls.gif) || undefined,
    videoUrl: text(urls.hd) || text(urls.sd) || text(urls.gif) || undefined,
    videoUrlSd: text(urls.sd) || undefined,
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
    const parts = url.pathname.split('/').filter(Boolean)
    const watch = parts.findIndex((part) => part.toLowerCase() === 'watch')
    const candidate = watch >= 0 ? parts[watch + 1] : parts[parts.length - 1]
    return candidate && /^[a-z0-9]+$/i.test(candidate) ? candidate : null
  } catch {
    return null
  }
}
