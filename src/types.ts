export type TabId = 'home' | 'discover' | 'library' | 'downloads' | 'you'
export type FeedMode = 'trending' | 'latest'
/** Public V2 gif-search sorting values accepted by the source API. */
export type FeedOrder = 'latest' | 'top' | 'top7' | 'top28' | 'score' | 'trending'
export type DownloadStatus = 'queued' | 'downloading' | 'done' | 'opened' | 'failed'

export interface MediaItem {
  id: string
  title: string
  description: string
  creator: string
  thumbnail?: string
  /** Ordered real image/video thumbnail candidates returned by the public API. */
  thumbnailUrls: string[]
  previewUrl?: string
  videoUrl?: string
  videoUrlSd?: string
  sourceUrl: string
  duration: number
  likes: number
  views: number
  width: number
  height: number
  createdAt: number
  hasAudio: boolean
  tags: string[]
  niches: string[]
}

export interface PageResult<T> {
  items: T[]
  page: number
  pages: number
  total: number
}

export interface Creator {
  username: string
  displayName: string
  avatar?: string
  profileUrl?: string
  followers: number
  gifs: number
  views: number
  verified: boolean
}

export interface CreatorProfile extends Creator {
  following: number
  likes: number
}

export interface Niche {
  id: string
  name: string
  description: string
  gifs: number
  subscribers: number
  thumbnail?: string
  cover?: string
  owner?: string
}

export interface TagSuggestion {
  text: string
  gifs: number
}

export interface LocalCollection {
  id: string
  name: string
  description: string
  itemIds: string[]
  createdAt: string
}

export interface DownloadRecord {
  id: string
  item: MediaItem
  status: DownloadStatus
  createdAt: string
  /** Exact media URL returned by the public API for this download attempt. */
  mediaUrl?: string
  error?: string
}

export interface Preferences {
  quality: 'hd' | 'sd'
  autoplay: boolean
  muted: boolean
  blockedTags: string[]
}
