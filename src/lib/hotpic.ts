import type { Creator, MediaItem } from '../types'

const ENDPOINT = '/api/hotpic'

const FALLBACK_MODELS: Creator[] = [
  'DesiHub', 'Nova.Black', 'Anonymous', 'mohnichohan56', 'ashiknishat95', 'wandaxhulk', 'Jhoncerry09'
].map((username) => ({
  username,
  displayName: username.replace(/\./g, ' '),
  avatar: `https://hotpic.vip/images/user/${encodeURIComponent(username)}.jpg`,
  profileUrl: `https://hotpic.vip/u/${encodeURIComponent(username)}`,
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
    try {
      const data = await getJson<{ users?: Creator[] }>({ path: 'desi' })
      const live = Array.isArray(data.users) ? data.users.filter((user) => user.username) : []
      return live.length ? live : FALLBACK_MODELS
    } catch {
      return FALLBACK_MODELS
    }
  },
  async profile(username: string): Promise<HotpicProfile> {
    try {
      return await getJson<HotpicProfile>({ path: 'user', u: username })
    } catch {
      return {
        username,
        displayName: username,
        avatar: `https://hotpic.vip/images/user/${encodeURIComponent(username)}.jpg`,
        profileUrl: `https://hotpic.vip/u/${encodeURIComponent(username)}`,
        albums: 0,
        joined: '',
        items: []
      }
    }
  },
  async album(id: string): Promise<HotpicAlbum> {
    return getJson<HotpicAlbum>({ path: 'album', id })
  }
}
