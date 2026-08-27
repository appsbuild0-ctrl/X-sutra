/**
 * Client-side Discord admin service.
 * All API calls go through the backend — bot token is never exposed to the frontend.
 */

const HEALTH_ENDPOINT = '/api/discord/health'
const UPLOAD_ENDPOINT = '/api/discord/upload'
const DELETE_ENDPOINT = '/api/discord/delete'

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
 * File is converted to base64 and sent as JSON.
 */
export async function uploadToDiscord(file: File, password: string, content?: string): Promise<DiscordUploadResult> {
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
      content: content || ''
    })
  })
}

/**
 * Delete a Discord message by ID.
 */
export function deleteDiscordMessage(messageId: string, password: string): Promise<DiscordDeleteResult> {
  return request<DiscordDeleteResult>(DELETE_ENDPOINT, {
    method: 'POST',
    body: JSON.stringify({ password, messageId })
  })
}
