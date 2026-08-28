/**
 * Client-side Discord admin service.
 * All API calls go through the backend — bot token is never exposed to the frontend.
 */

const HEALTH_ENDPOINT = '/api/discord/health'
const UPLOAD_ENDPOINT = '/api/discord/upload'
const DELETE_ENDPOINT = '/api/discord/delete'
const SYNC_ENDPOINT = '/api/discord/sync'

export interface DiscordHealthStatus {
  botToken: boolean
  guild: { found: boolean; name: string; id: string }
  channel: { found: boolean; name: string; id: string; canSend: boolean; canAttach: boolean; canManage: boolean }
  adminUser: { configured: boolean; userId: string }
  overall: 'ok' | 'error'
  error?: string
  errorCode?: string
  botUser?: { id: string; username: string; discriminator: string }
}

export interface DiscordUploadResult {
  ok: boolean
  messageId?: string
  channelId?: string
  guildId?: string
  attachmentUrl?: string
  filename?: string
  size?: number
  contentType?: string
  error?: string
}

export interface DiscordDeleteResult {
  ok: boolean
  messageId?: string
  channelId?: string
  alreadyDeleted?: boolean
  error?: string
}

export interface DiscordChannelInfo {
  id: string
  name: string
  topic: string
  type: 'text' | 'announcement'
  parentId: string
}

export interface DiscordImportedMedia {
  id: string
  channelId: string
  channelName: string
  sourceChannelId: string
  messageId: string
  attachmentId: string
  kind: 'image' | 'video'
  title: string
  url: string
  width: number
  height: number
  bytes: number
  authorName: string
  createdAt: string
}

export interface DiscordSyncChannelResult {
  id: string
  name: string
  messages: number
  imported: number
  skipped: number
  failed: number
  error: string
}

export interface DiscordSyncResult {
  ok: boolean
  scanned: number
  attachments: number
  imported: number
  skipped: number
  failed: number
  partial: boolean
  nextChannelIds: string[]
  remaining?: number
  database: 'saved' | 'skipped'
  channels: DiscordSyncChannelResult[]
  error?: string
}

export class DiscordAdminError extends Error {}

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  try {
    const response = await fetch(endpoint, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(options.headers || {})
      },
      cache: 'no-store'
    })
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok) {
      throw new DiscordAdminError(typeof data.error === 'string' ? data.error : `Request failed (${response.status})`)
    }
    return data as T
  } catch (error) {
    if (error instanceof DiscordAdminError) throw error
    throw new DiscordAdminError('Discord backend is unreachable.')
  }
}

/**
 * Check Discord bot health status.
 */
export function fetchDiscordHealth(password?: string): Promise<DiscordHealthStatus> {
  const headers: Record<string, string> = {}
  if (password) headers.authorization = `Bearer ${password}`
  return request<DiscordHealthStatus>(HEALTH_ENDPOINT, { headers })
}

/**
 * Upload a file to Discord via the backend.
 * File is converted to base64 and sent as JSON. `channelId` is the channel picked
 * in the admin console; without it the server's DISCORD_CHANNEL_ID is used.
 */
export async function uploadToDiscord(file: File, password: string, content?: string, channelId?: string): Promise<DiscordUploadResult> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  const base64 = btoa(binary)

  return request<DiscordUploadResult>(UPLOAD_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify({
      password,
      filename: file.name,
      contentType: file.type || 'application/octet-stream',
      data: base64,
      content: content || '',
      channelId: channelId || ''
    })
  })
}

/**
 * Delete a Discord message by ID.
 */
export function deleteDiscordMessage(messageId: string, password: string, channelId?: string): Promise<DiscordDeleteResult> {
  return request<DiscordDeleteResult>(DELETE_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify({ password, messageId, channelId: channelId || '' })
  })
}

// ─── Real channel import ───

/** Every text channel of the configured guild, for the admin's picker. */
export function listDiscordChannels(password: string): Promise<{ channels: DiscordChannelInfo[] }> {
  return request<{ channels: DiscordChannelInfo[] }>(SYNC_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify({ password, action: 'list_channels' })
  })
}

/** What has already been imported (media stored with its channel). */
export function fetchDiscordImported(password: string, channelId?: string): Promise<{ media: DiscordImportedMedia[] }> {
  return request<{ media: DiscordImportedMedia[] }>(SYNC_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify({ password, action: 'imported', channelId: channelId || '' })
  })
}

/**
 * Import messages/images/videos from the selected channels.
 *
 * A serverless request has a time budget, so the backend can answer `partial`
 * with the channels it did not reach; those are requested again automatically
 * until the selection is exhausted.
 */
export async function syncDiscordChannels(
  password: string,
  options: { channelIds: string[]; perChannel: number; kinds: string[] },
  onProgress?: (result: DiscordSyncResult, round: number) => void
): Promise<DiscordSyncResult> {
  const totals: DiscordSyncResult = {
    ok: true, scanned: 0, attachments: 0, imported: 0, skipped: 0, failed: 0,
    partial: false, nextChannelIds: [], database: 'skipped', channels: []
  }
  let pending = [...new Set(options.channelIds.map(String).filter(Boolean))]
  for (let round = 1; round <= 20 && pending.length; round += 1) {
    const result = await request<DiscordSyncResult>(SYNC_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify({ password, action: 'sync', channelIds: pending, perChannel: options.perChannel, kinds: options.kinds })
    })
    totals.scanned += result.scanned || 0
    totals.attachments += result.attachments || 0
    totals.imported += result.imported || 0
    totals.skipped += result.skipped || 0
    totals.failed += result.failed || 0
    totals.channels.push(...(result.channels || []))
    totals.database = result.database === 'saved' ? 'saved' : totals.database
    totals.partial = Boolean(result.partial)
    totals.nextChannelIds = result.nextChannelIds || []
    onProgress?.({ ...totals }, round)
    const next = (result.nextChannelIds || []).filter((id) => pending.includes(id))
    // Same set again means no progress — stop instead of looping forever.
    if (!result.partial || next.length === pending.length) break
    pending = next
  }
  return totals
}
