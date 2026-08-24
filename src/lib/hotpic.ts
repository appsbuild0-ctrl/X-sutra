import type { Creator, MediaItem } from '../types'

const ENDPOINT = '/api/hotpic'

export interface HotpicAlbumCard {
  id: string
  title: string
  cover: string
  url: string
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

async function getJson<T>(params: Record<string, string>): Promise<T> {
  const url = new URL(ENDPOINT, window.location.origin)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const response = await fetch(url.toString(), { headers: { Accept: 'application/json' } })
  const data = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(data.error || `Hotpic request failed (${response.status})`)
  return data
}

export const hotpicApi = {
  async topModels(): Promise<Creator[]> {
    const data = await getJson<{ users?: Creator[] }>({ path: 'desi' })
    return Array.isArray(data.users) ? data.users.filter((user) => user.username) : []
  },
  async profile(username: string): Promise<HotpicProfile> {
    return getJson<HotpicProfile>({ path: 'user', u: username })
  },
  async album(id: string): Promise<HotpicAlbum> {
    return getJson<HotpicAlbum>({ path: 'album', id })
  }
}
