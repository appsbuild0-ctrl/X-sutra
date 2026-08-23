import { Capacitor } from '@capacitor/core'
import type { MediaItem } from '../types'

export type DownloadDisposition = 'saved' | 'opened'

const CONTENT_TYPE_EXTENSIONS: ReadonlyArray<[string, string]> = [
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm'],
  ['video/quicktime', 'mov'],
  ['application/mp4', 'mp4'],
  ['application/vnd.apple.mpegurl', 'm3u8'],
  ['application/x-mpegurl', 'm3u8']
]
const MEDIA_EXTENSIONS = new Set(['mp4', 'webm', 'mov', 'm4v', 'm3u8'])

function actualMediaUrl(rawUrl: string): string {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    throw new Error('The public API returned an invalid media URL')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('The public API did not return a downloadable HTTP media URL')
  }
  return url.toString()
}

function mediaExtensionFromUrl(url: string): string | undefined {
  const pathExtension = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i)?.[1]?.toLowerCase()
  return pathExtension && MEDIA_EXTENSIONS.has(pathExtension) ? pathExtension : undefined
}

function extensionFor(url: string, contentType = ''): string {
  const normalizedType = contentType.toLowerCase().split(';', 1)[0]?.trim() ?? ''
  const mapped = CONTENT_TYPE_EXTENSIONS.find(([type]) => normalizedType === type)?.[1]
  return mapped ?? mediaExtensionFromUrl(url) ?? 'mp4'
}

function fileNameFor(item: MediaItem, url: string, contentType = ''): string {
  const clean = `${item.creator}-${item.title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 72)
  return `${clean || item.id}.${extensionFor(url, contentType)}`
}

function triggerBrowserDownload(url: string, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.target = '_blank'
  anchor.rel = 'noopener noreferrer'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

async function assertActualMedia(blob: Blob, url: string, responseType: string): Promise<void> {
  if (blob.size === 0) throw new Error('The media server returned an empty file')

  const normalizedType = responseType.toLowerCase().split(';', 1)[0]?.trim() ?? ''
  const clearlyNotMedia = normalizedType === 'application/json'
    || normalizedType === 'application/xml'
    || normalizedType.startsWith('text/')
  if (clearlyNotMedia) throw new Error(`The media URL returned ${normalizedType} instead of a video`)

  const prefix = new TextDecoder().decode(await blob.slice(0, 512).arrayBuffer()).trimStart().toLowerCase()
  if (/^(?:<!doctype|<html|<head|<body|<script|<\?xml|\{\s*"?(?:error|message))/i.test(prefix)) {
    throw new Error('The media URL returned a document or error response instead of a video')
  }

  const recognizedType = normalizedType.startsWith('video/')
    || normalizedType === 'application/octet-stream'
    || CONTENT_TYPE_EXTENSIONS.some(([type]) => type === normalizedType)
  if ((normalizedType && !recognizedType) || (!normalizedType && !mediaExtensionFromUrl(url))) {
    throw new Error(`The media server returned an unsupported file type${normalizedType ? ` (${normalizedType})` : ''}`)
  }
}

/**
 * Save the exact media URL returned by the public API.
 *
 * Browser downloads are fetched and checked before a Blob is offered as a
 * file, preventing an HTML/error response from being renamed to .mp4. If CORS
 * prevents that verification, the exact media URL is handed to the browser
 * and reported as opened—not as a completed download.
 */
export async function saveMediaFile(item: MediaItem, rawUrl: string): Promise<DownloadDisposition> {
  const url = actualMediaUrl(rawUrl)

  if (Capacitor.isNativePlatform()) {
    const { Directory, Filesystem } = await import('@capacitor/filesystem')
    await Filesystem.downloadFile({
      url,
      path: fileNameFor(item, url),
      directory: Directory.Documents,
      recursive: true
    })
    return 'saved'
  }

  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: 'video/*, application/octet-stream;q=0.9, */*;q=0.1' }
    })
  } catch {
    // Cross-origin media can be playable while disallowing JavaScript fetch.
    // Hand the API-provided URL to the browser without claiming it was saved.
    triggerBrowserDownload(url, fileNameFor(item, url))
    return 'opened'
  }

  if (!response.ok) throw new Error(`Media download request failed (${response.status})`)
  const contentType = response.headers.get('content-type') ?? ''
  const blob = await response.blob()
  await assertActualMedia(blob, response.url || url, contentType || blob.type)

  const objectUrl = URL.createObjectURL(blob)
  triggerBrowserDownload(objectUrl, fileNameFor(item, response.url || url, contentType || blob.type))
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
  return 'saved'
}
