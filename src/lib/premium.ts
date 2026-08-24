import type { MediaItem } from '../types'

export interface PremiumPost {
  id: string
  title: string
  videoUrl: string
  thumbnail: string
  createdAt: string
}

const ENDPOINT = '/api/premium'

/** Shared premium posts (Netlify Blobs via the site function). */
export async function fetchPremiumPosts(): Promise<PremiumPost[]> {
  try {
    const response = await fetch(ENDPOINT, { headers: { Accept: 'application/json' } })
    if (!response.ok) return []
    const data = await response.json() as { posts?: PremiumPost[] }
    return Array.isArray(data.posts) ? data.posts : []
  } catch {
    return []
  }
}

export async function addPremiumPost(password: string, title: string, videoUrl: string, thumbnail: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ password, title, videoUrl, thumbnail })
    })
    const data = await response.json() as { error?: string }
    if (!response.ok) return { ok: false, error: data.error ?? `Request failed (${response.status})` }
    return { ok: true }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Network error' }
  }
}

/** A premium post as a playable queue item. */
export function premiumPostToMedia(post: PremiumPost): MediaItem {
  return {
    id: post.id,
    title: post.title,
    description: post.title,
    creator: 'premium',
    thumbnail: post.thumbnail,
    thumbnailUrls: post.thumbnail ? [post.thumbnail] : [],
    previewUrl: post.videoUrl,
    videoUrl: post.videoUrl,
    videoUrlSd: post.videoUrl,
    sourceUrl: post.videoUrl,
    duration: 0,
    likes: 0,
    views: 0,
    width: 0,
    height: 0,
    createdAt: Date.parse(post.createdAt) || 0,
    hasAudio: true,
    tags: [],
    niches: []
  }
}
