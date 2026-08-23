export type TabId = 'home' | 'discover' | 'library' | 'downloads' | 'you'

export type FeedMode = 'for-you' | 'trending'
export type DownloadStatus = 'queued' | 'downloading' | 'done' | 'failed'

export interface MediaItem {
  id: string
  title: string
  creator: string
  thumbnail?: string
  previewUrl?: string
  videoUrl?: string
  videoUrlSd?: string
  sourceUrl?: string
  duration?: number
  likes?: number
  views?: number
  tags: string[]
  width?: number
  height?: number
  gradient?: string
  isDemo?: boolean
}

export interface Creator {
  username: string
  displayName: string
  avatar?: string
  followers?: number
  verified?: boolean
}

export interface Niche {
  id: string
  name: string
}

export interface DownloadRecord {
  id: string
  item: MediaItem
  status: DownloadStatus
  createdAt: string
  error?: string
}

export interface Preferences {
  quality: 'hd' | 'sd'
  autoplay: boolean
}
