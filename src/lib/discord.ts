// Client for the Discord-backed content API.
//
// The bot token, guild id and internal message ids never come through this
// module in a way the UI renders: public reads return only display fields, and
// admin calls are authorised by the same password the existing Premium admin
// uses (ADMIN_KEY) — verified server-side on every request.

import type { MediaItem } from '../types'
import { ADMIN_KEY } from './premium'

const ENDPOINT = '/api/discord/media'

export class DiscordError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DiscordError'
  }
}

export interface DiscordMedia {
  id: string
  title: string
  description: string
  kind: 'video' | 'image' | 'audio' | 'file'
  filename: string
  bytes: number
  url: string
  accessRole: 'public' | 'premium' | 'vip' | 'admin'
  status: string
  createdAt: string
  /** Admin-only fields (present on admin listings). */
  discordMessageId?: string
  discordChannelId?: string
  discordGuildId?: string
  mimeType?: string
}

export interface DiscordStatus {
  configured: boolean
  missing?: string[]
  api?: string
  bot?: string
  guild?: string
  channel?: string
  permissions?: string
  permissionDetail?: Record<string, boolean>
}

async function call<T extends object>(body?: Record<string, unknown>, useGet = false): Promise<T> {
  let response: Response
  try {
    response = await fetch(ENDPOINT, {
      method: useGet ? 'GET' : 'POST',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store'
    })
  } catch {
    throw new DiscordError('Backend is unreachable.')
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
  if (!response.ok) {
    throw new DiscordError(typeof data.error === 'string' ? data.error : `Backend error (HTTP ${response.status}).`)
  }
  return data as T
}

/** Public content list (display fields only). */
export function fetchDiscordMedia(): Promise<{ media: DiscordMedia[] }> {
  return call<{ media: DiscordMedia[] }>(undefined, true)
}

/** Admin health check — token is never returned. */
export function fetchDiscordStatus(): Promise<DiscordStatus> {
  return call<DiscordStatus>({ action: 'status', password: ADMIN_KEY })
}

export function fetchAdminDiscordMedia(): Promise<{ media: DiscordMedia[] }> {
  return call<{ media: DiscordMedia[] }>({ action: 'list', password: ADMIN_KEY })
}

export interface DiscordUploadMeta {
  title: string
  description?: string
  accessRole?: DiscordMedia['accessRole']
}

function toBase64(chunk: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new DiscordError('The file could not be read on this device.'))
    reader.onload = () => {
      const result = String(reader.result || '')
      resolve(result.includes(',') ? result.slice(result.indexOf(',') + 1) : result)
    }
    reader.readAsDataURL(chunk)
  })
}

/**
 * Upload: start → chunked transfer → finish. The backend posts to Discord and
 * only reports success once Discord returns a real message id.
 */
export async function uploadDiscordFile(file: File, meta: DiscordUploadMeta, onProgress?: (fraction: number) => void): Promise<DiscordMedia> {
  const started = await call<{ ok: true; id: string; chunkSize: number; chunks: number }>({
    action: 'start',
    password: ADMIN_KEY,
    size: file.size,
    filename: file.name,
    contentType: file.type
  })
  for (let index = 0; index < started.chunks; index += 1) {
    const slice = file.slice(index * started.chunkSize, (index + 1) * started.chunkSize)
    await call<{ ok: true }>({ action: 'chunk', password: ADMIN_KEY, id: started.id, index, data: await toBase64(slice) })
    onProgress?.((index + 1) / started.chunks)
  }
  const finished = await call<{ ok: true; media: DiscordMedia }>({
    action: 'finish',
    password: ADMIN_KEY,
    id: started.id,
    title: meta.title,
    description: meta.description,
    accessRole: meta.accessRole,
    filename: file.name,
    contentType: file.type
  })
  return finished.media
}

export async function deleteDiscordMedia(id: string): Promise<{ ok: true; alreadyDeleted: boolean }> {
  return call<{ ok: true; alreadyDeleted: boolean }>({ action: 'delete', password: ADMIN_KEY, id })
}

/** Map an upload onto the app's existing MediaItem shape for player/download. */
export function discordToMediaItem(media: DiscordMedia): MediaItem {
  const isVideo = media.kind === 'video'
  const isImage = media.kind === 'image'
  return {
    id: `xsd-${media.id}`,
    title: media.title,
    description: media.description,
    creator: 'X-Sutra',
    thumbnail: isImage ? media.url : '',
    thumbnailUrls: isImage ? [media.url] : [],
    videoUrl: isVideo ? media.url : undefined,
    sourceUrl: media.url,
    duration: 0,
    likes: 0,
    views: 0,
    width: 0,
    height: 0,
    createdAt: Number.isFinite(Date.parse(media.createdAt)) ? Date.parse(media.createdAt) : Date.now(),
    hasAudio: true,
    tags: media.kind ? [media.kind] : [],
    niches: []
  }
}
