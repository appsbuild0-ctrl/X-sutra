import { Capacitor } from '@capacitor/core'
import type { MediaItem } from '../types'

/**
 * media.redgifs.com hosts the permanent clean files but refuses direct
 * foreign/referer-less requests (403). The streaming function at /api/media
 * forwards those requests with accepted fingerprints, so prefer the proxied
 * URL and keep the direct URL as the next candidate.
 */
export function mediaProxyUrl(url: string): string | null {
  if (Capacitor.isNativePlatform()) return null
  const match = url.match(/media\.redgifs\.com\/([A-Za-z0-9_-]+\.(?:mp4|webm|jpe?g|png))$/i)
  if (!match) return null
  return `/api/media?name=${encodeURIComponent(match[1])}`
}

/**
 * Ordered playback/download candidates. SD (mobile) versions come first for
 * instant playback, then HD. The API returns permanent clean media.redgifs.com
 * URLs, and that host serves browsers directly (it blocks datacenter IPs, not
 * residential/mobile ones) — so direct URLs come first. The same-origin media
 * proxy stays as a final fallback for environments where direct loading is refused.
 */
/** A source the <video> element can load: http(s), same-origin API/assets, or
 *  local blob URLs produced by the premium IndexedDB store. */
function isPlayableSource(url: string): boolean {
  if (/^(?:https?|blob):/i.test(url)) return true
  if (url.startsWith('/')) return /\.(?:mp4|webm|mov|m4v)(?:[?#]|$)/i.test(url) || url.startsWith('/api/media') || url.startsWith('/api/premium-file')
  return false
}

function isHotpicSource(url: string): boolean {
  return /hotpic\.(?:vip|cc|one)(?:\/|$)/i.test(url)
}

export function playbackCandidates(item: MediaItem): string[] {
  const direct = [
    item.videoUrlSd,   // SD first for faster initial playback
    item.videoUrl,     // HD as fallback after SD starts
    /\.(?:mp4|webm)(?:[?#]|$)/i.test(item.previewUrl ?? '') ? item.previewUrl : undefined,
    ...(item.watermarkedUrls ?? [])
  ].filter((url): url is string => typeof url === 'string' && isPlayableSource(url) && !isHotpicSource(url))

  const withFallbacks = [...direct]
  for (const url of direct) {
    const proxy = mediaProxyUrl(url)
    if (proxy) withFallbacks.push(proxy)
  }
  return [...new Set(withFallbacks)]
}

/**
 * Download a proxied media file completely by assembling bounded range
 * chunks (each proxy response is capped, so loop until the total from the
 * Content-Range header has been fetched).
 */
export async function fetchMediaBlob(proxyUrl: string): Promise<Blob> {
  const CHUNK = 4 * 1024 * 1024
  const chunks: BlobPart[] = []
  let start = 0
  let total = Infinity
  while (start < total) {
    const response = await fetch(proxyUrl, { headers: { Range: `bytes=${start}-${start + CHUNK - 1}` } })
    if (!response.ok && response.status !== 206) throw new Error(`Media proxy chunk failed (${response.status})`)
    const blob = await response.blob()
    if (blob.size === 0) throw new Error('Media proxy returned an empty chunk')
    chunks.push(blob)
    const contentRange = response.headers.get('content-range')
    const totalMatch = contentRange?.match(/\/(\d+)\s*$/)
    if (totalMatch) total = Number(totalMatch[1])
    else total = start + blob.size
    start += blob.size
    if (blob.size < CHUNK) break
  }
  return new Blob(chunks)
}
