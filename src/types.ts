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
  /** API-provided watermarked variants kept as last-resort playback/download sources. */
  watermarkedUrls?: string[]
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

export type UserRole = 'normal' | 'creator' | 'premium' | 'vip' | 'admin'

/**
 * A signed-in account. Two login methods produce one:
 *   * the original device-local login (password hashed on the device), and
 *   * "Login with Telegram", where the account lives in PostgreSQL and the
 *     server issues a signed JWT (see lib/telegramLogin.ts).
 */
export interface LocalAccount {
  name: string
  username: string
  /** SHA-256 digest of the password; the raw password is never stored. */
  passwordHash: string
  createdAt: string
  role: UserRole
  status?: 'on' | 'off'
  /** Telegram user id, present only for Telegram logins. */
  telegramId?: string
  /** Which login produced this session. */
  source?: 'local' | 'telegram'
  /** Telegram profile photo, when the account came from Telegram. */
  photoUrl?: string
}

export type AuthResult = { ok: true } | { ok: false; error: string }
