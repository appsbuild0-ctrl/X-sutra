import type { Creator, MediaItem, Niche } from '../types'

const API_BASE = 'https://api.redgifs.com/v2'
const TOKEN_URL = `${API_BASE}/auth/temporary`
let cachedToken: string | null = null
let tokenExpiresAt = 0
let fallbackCounter = 0

type RawRecord = Record<string, unknown>

function asRecord(value: unknown): RawRecord {
  return value && typeof value === 'object' ? (value as RawRecord) : {}
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

async function temporaryToken(force = false): Promise<string> {
  if (!force && cachedToken && tokenExpiresAt > Date.now()) return cachedToken

  const response = await fetch(TOKEN_URL, { headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Public API token request failed (${response.status})`)
  const data = asRecord(await response.json())
  const token = asString(data.token)
  if (!token) throw new Error('The public API did not return a usable token')

  cachedToken = token
  tokenExpiresAt = Date.now() + 40 * 60 * 1000
  return token
}

async function request(path: string, retry = true): Promise<RawRecord> {
  const token = await temporaryToken(!retry)
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }
  })

  if (response.status === 401 && retry) {
    cachedToken = null
    tokenExpiresAt = 0
    return request(path, false)
  }
  if (!response.ok) throw new Error(`Public API request failed (${response.status})`)
  return asRecord(await response.json())
}

function buildPath(path: string, params: Record<string, string | number | undefined> = {}): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value))
  })
  const suffix = search.toString()
  return suffix ? `${path}?${suffix}` : path
}

function mediaFromRaw(value: unknown): MediaItem {
  const raw = asRecord(value)
  const urls = asRecord(raw.urls)
  const id = asString(raw.id) ?? asString(raw.gifId) ?? `remote-${++fallbackCounter}`
  const tags = stringList(raw.tags)
  const fallbackTitle = tags.slice(0, 3).join(' · ')
  const title = asString(raw.title) ?? (fallbackTitle || `Clip ${id}`)
  const creator = asString(raw.userName) ?? asString(raw.username) ?? asString(raw.user) ?? 'creator'
  const thumbnail =
    asString(urls.poster) ??
    asString(urls.thumbnail) ??
    asString(urls.vthumbnail) ??
    asString(urls.gif) ??
    asString(raw.thumbnail)

  return {
    id,
    title,
    creator,
    thumbnail,
    previewUrl: asString(urls.vthumbnail) ?? asString(urls.gif),
    videoUrl: asString(urls.hd) ?? asString(urls.sd) ?? asString(urls.gif),
    videoUrlSd: asString(urls.sd),
    sourceUrl: `https://www.redgifs.com/watch/${encodeURIComponent(id)}`,
    duration: asNumber(raw.duration),
    likes: asNumber(raw.likes) ?? asNumber(raw.likesCount),
    views: asNumber(raw.views) ?? asNumber(raw.viewsCount),
    tags,
    width: asNumber(raw.width),
    height: asNumber(raw.height)
  }
}

function mediaList(data: RawRecord): MediaItem[] {
  const values = Array.isArray(data.gifs)
    ? data.gifs
    : Array.isArray(data.items)
      ? data.items
      : Array.isArray(data.contents)
        ? data.contents
        : []
  return values.map(mediaFromRaw).filter((item) => Boolean(item.id))
}

function creatorFromRaw(value: unknown): Creator {
  const raw = asRecord(value)
  const username = asString(raw.username) ?? asString(raw.userName) ?? 'creator'
  return {
    username,
    displayName: asString(raw.name) ?? username,
    avatar: asString(raw.profileImageUrl) ?? asString(raw.avatar),
    followers: asNumber(raw.followers),
    verified: Boolean(raw.verified)
  }
}

export const publicMediaApi = {
  async trending(): Promise<MediaItem[]> {
    return mediaList(await request(buildPath('/feeds/trending/popular', { page: 1, count: 36 })))
  },

  async latest(): Promise<MediaItem[]> {
    return mediaList(await request(buildPath('/gifs/search', { page: 1, count: 36, order: 'latest' })))
  },

  async search(query: string): Promise<MediaItem[]> {
    return mediaList(await request(buildPath('/gifs/search', {
      page: 1,
      count: 36,
      order: 'latest',
      query: query.trim()
    })))
  },

  async creator(username: string): Promise<MediaItem[]> {
    return mediaList(await request(buildPath(`/users/${encodeURIComponent(username)}/search`, {
      page: 1,
      count: 36,
      order: 'latest'
    })))
  },

  async getById(id: string): Promise<MediaItem> {
    const data = await request(`/gifs/${encodeURIComponent(id)}`)
    return mediaFromRaw(data.gif ?? data)
  },

  async creators(): Promise<Creator[]> {
    const data = await request(buildPath('/creators/search', { page: 1, count: 12, order: 'best' }))
    const values = Array.isArray(data.items)
      ? data.items
      : Array.isArray(data.creators)
        ? data.creators
        : Array.isArray(data.users)
          ? data.users
          : []
    return values.map(creatorFromRaw).filter((item) => item.username !== 'creator')
  },

  async niches(): Promise<Niche[]> {
    const data = await request('/niches/trending/search')
    const values = Array.isArray(data.niches) ? data.niches : []
    return values
      .map((value): Niche | null => {
        const raw = asRecord(value)
        const id = asString(raw.id) ?? asString(raw.name)
        const name = asString(raw.name) ?? asString(raw.title)
        return id && name ? { id, name } : null
      })
      .filter((item): item is Niche => item !== null)
  }
}

export function redgifsIdFromLink(input: string): string | null {
  const text = input.trim()
  if (!text) return null
  const direct = text.match(/^[A-Za-z0-9]{5,}$/)
  if (direct) return direct[0]

  try {
    const url = new URL(text.includes('://') ? text : `https://${text}`)
    const parts = url.pathname.split('/').filter(Boolean)
    const watchIndex = parts.findIndex((part) => part.toLowerCase() === 'watch')
    const candidate = watchIndex >= 0 ? parts[watchIndex + 1] : parts[parts.length - 1]
    return candidate && /^[A-Za-z0-9]+$/.test(candidate) ? candidate : null
  } catch {
    const matched = text.match(/(?:watch\/)?([A-Za-z0-9]{5,})/i)
    return matched?.[1] ?? null
  }
}
