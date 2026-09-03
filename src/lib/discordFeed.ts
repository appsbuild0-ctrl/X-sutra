import { useCallback, useEffect, useRef, useState } from 'react'
import type { MediaItem } from '../types'

/** Discord as a media source with feed polling */
const FEED_ENDPOINT = '/api/discord/feed'

export interface DiscordFeedItem {
  id: string
  type: 'image' | 'video'
  url: string
  thumbnail: string
  title: string
  channelId: string
  channelName: string
  filename: string
  mimeType: string
  width: number
  height: number
  size: number
  authorName: string
  createdAt: string
}

export interface DiscordFeedSection {
  channelId: string
  name: string
  type: 'images' | 'videos' | 'mixed'
  discordChannelId: string
  kinds: string[]
  lastSyncAt: string
  count: number
}

export interface DiscordFeed {
  media: DiscordFeedItem[]
  sections: DiscordFeedSection[]
  autoSync: boolean
  intervalMs: number
  mode: 'link' | 'store'
  configured: boolean
  synced: { at: string; imported: number; skipped: number; channels: number } | null
  syncError: string
  oldest: string
  hasMore: boolean
}

export const emptyFeed: DiscordFeed = {
  media: [], sections: [], autoSync: true, intervalMs: 30000, mode: 'link',
  configured: false, synced: null, syncError: '', oldest: '', hasMore: false
}

export async function fetchDiscordFeed(options: { channelId?: string; limit?: number; before?: string } = {}): Promise<DiscordFeed> {
  const params = new URLSearchParams()
  if (options.channelId) params.set('channelId', options.channelId)
  if (options.limit) params.set('limit', String(options.limit))
  if (options.before) params.set('before', options.before)
  const query = params.toString()
  const response = await fetch(`${FEED_ENDPOINT}${query ? `?${query}` : ''}`, { headers: { Accept: 'application/json' }, cache: 'no-store' })
  if (!response.ok) throw new Error(`Discord feed failed (${response.status})`)
  const data = (await response.json()) as Partial<DiscordFeed>
  return {
    ...emptyFeed,
    ...data,
    media: Array.isArray(data.media) ? data.media : [],
    sections: Array.isArray(data.sections) ? data.sections : [],
    intervalMs: Math.max(15000, Number(data.intervalMs) || 30000)
  }
}

export function discordFeedItemToMedia(item: DiscordFeedItem): MediaItem {
  const isVideo = item.type === 'video'
  return {
    id: item.id,
    title: item.title || (isVideo ? 'Discord video' : 'Discord image'),
    description: item.title || '',
    creator: 'premium',
    thumbnail: item.thumbnail || (isVideo ? '' : item.url),
    thumbnailUrls: [item.thumbnail || (!isVideo ? item.url : '')].filter(Boolean),
    previewUrl: isVideo ? `${item.url}#t=0.1` : item.url,
    videoUrl: isVideo ? item.url : undefined,
    videoUrlSd: isVideo ? item.url : undefined,
    sourceUrl: item.url,
    duration: 0,
    likes: 0,
    views: 0,
    width: item.width || 0,
    height: item.height || 0,
    createdAt: Date.parse(item.createdAt) || 0,
    hasAudio: isVideo,
    tags: [],
    niches: []
  }
}
