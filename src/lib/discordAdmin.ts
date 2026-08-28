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
  filename: string
  mimeType: string
  width: number
  height: number
  bytes: number
  authorName: string
  createdAt: string
  expiresAt: number
  targetChannelName: string
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
  status?: unknown
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

// ─── Discord as the Premium media source ───

export interface DiscordMappingInput {
  discordChannelId: string
  channelId: string
  name?: string
  kinds?: string[]
}

export interface DiscordMappingStatus extends DiscordMappingInput {
  channelName: string
  cursor: string
  lastSyncAt: string
  imported: number
  media: number
}

export interface DiscordSyncError {
  at: string
  channel?: string
  message: string
}

export interface DiscordSyncStatus {
  configured: { botToken: boolean; guildId: boolean; defaultChannelId: string; storeAttachments: boolean }
  autoSync: boolean
  intervalMs: number
  perChannel: number
  kinds: string[]
  mode: 'link' | 'store'
  mappings: DiscordMappingStatus[]
  lastSyncAt: string
  lastResult: { at: string; scanned: number; imported: number; skipped: number; failed: number; partial: boolean; channels: DiscordSyncChannelResult[] } | null
  errors: DiscordSyncError[]
  totals: { media: number; images: number; videos: number }
}

export interface DiscordConfigInput {
  autoSync?: boolean
  intervalMs?: number
  perChannel?: number
  kinds?: string[]
  mode?: 'link' | 'store'
  mappings?: DiscordMappingInput[]
}

/** Every text channel of the configured guild, for the admin's picker. */
export function listDiscordChannels(password: string): Promise<{ channels: DiscordChannelInfo[] }> {
  return request<{ channels: DiscordChannelInfo[] }>(SYNC_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify({ password, action: 'list_channels' })
  })
}

/** Mapping + auto-sync + last sync + error log. */
export function fetchDiscordStatus(password: string): Promise<DiscordSyncStatus> {
  return request<DiscordSyncStatus>(SYNC_ENDPOINT, { headers: { authorization: `Bearer ${password}` } })
}

/** Save the channel → Premium section mapping and the auto-sync settings. */
export function saveDiscordConfig(password: string, config: DiscordConfigInput): Promise<{ config: DiscordSyncStatus; status: DiscordSyncStatus }> {
  return request<{ config: DiscordSyncStatus; status: DiscordSyncStatus }>(SYNC_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify({ password, action: 'config', config })
  })
}

/**
 * "Sync Now". Incremental by default (only messages newer than the stored
 * cursor); `full` re-reads the whole configured depth. A serverless request has
 * a time budget, so the answer can be `partial` with the channels it did not
 * reach — those are requested again automatically.
 */
export async function syncDiscordNow(
  password: string,
  options: { channelIds?: string[]; full?: boolean } = {},
  onProgress?: (result: DiscordSyncResult, round: number) => void
): Promise<DiscordSyncResult> {
  const totals: DiscordSyncResult = {
    ok: true, scanned: 0, attachments: 0, imported: 0, skipped: 0, failed: 0,
    partial: false, nextChannelIds: [], database: 'skipped', channels: [], status: null
  }
  let pending = [...new Set((options.channelIds || []).map(String).filter(Boolean))]
  for (let round = 1; round <= 20; round += 1) {
    const result = await request<DiscordSyncResult>(SYNC_ENDPOINT, {
      method: 'POST',
      body: JSON.stringify({ password, action: 'sync', channelIds: pending.length ? pending : undefined, full: options.full === true })
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
    totals.status = result.status ?? totals.status
    onProgress?.({ ...totals }, round)
    const next = (result.nextChannelIds || []).filter((id) => pending.includes(id))
    // No progress means stop instead of looping forever.
    if (!result.partial || (pending.length > 0 && next.length === pending.length)) break
    if (!pending.length && !result.partial) break
    pending = next
  }
  return totals
}

/** Media already imported, with the section each item landed in. */
export function fetchDiscordImported(password: string, channelId?: string): Promise<{ media: DiscordImportedMedia[]; status: DiscordSyncStatus }> {
  return request<{ media: DiscordImportedMedia[]; status: DiscordSyncStatus }>(SYNC_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify({ password, action: 'imported', channelId: channelId || '' })
  })
}
