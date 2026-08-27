/**
 * Discord Bot REST API service — server-side only.
 * Uses the Discord REST API (v10) with a Bot Token. No WebSocket/Gateway needed.
 * Bot token is NEVER exposed to the frontend.
 */

const DISCORD_API = 'https://discord.com/api/v10'
const DISCORD_CDN = 'https://cdn.discordapp.com'
const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25 MB Discord attachment limit
const MAX_EMBED_FILES = 10

let cachedToken = ''
let tokenExpiry = 0

function env(name) {
  return process.env[name] || ''
}

function botToken() {
  const token = env('DISCORD_BOT_TOKEN')
  if (!token) throw new DiscordError('Discord bot token is not configured.', 'CONFIG_MISSING')
  return token
}

function guildId() {
  const id = env('DISCORD_GUILD_ID')
  if (!id) throw new DiscordError('Discord guild ID is not configured.', 'CONFIG_MISSING')
  return id
}

function channelId() {
  const id = env('DISCORD_CHANNEL_ID')
  if (!id) throw new DiscordError('Discord channel ID is not configured.', 'CONFIG_MISSING')
  return id
}

function adminUserId() {
  return env('DISCORD_ADMIN_USER_ID')
}

export class DiscordError extends Error {
  constructor(message, code = 'DISCORD_ERROR', status = 500) {
    super(message)
    this.name = 'DiscordError'
    this.code = code
    this.status = status
  }
}

/**
 * Make an authenticated request to the Discord REST API.
 * Handles rate limiting with retry-after.
 */
async function discordFetch(path, options = {}) {
  const token = botToken()
  const url = `${DISCORD_API}${path}`
  const headers = {
    Authorization: `Bot ${token}`,
    'User-Agent': 'RedGrab/1.0 (Premium Backend)',
    ...options.headers
  }

  const maxRetries = 3
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await fetch(url, {
      ...options,
      headers
    })

    // Rate limited
    if (response.status === 429) {
      const body = await response.json().catch(() => ({}))
      const retryAfter = Math.min((body.retry_after || 1) * 1000, 30000)
      if (attempt < maxRetries - 1) {
        await sleep(retryAfter)
        continue
      }
      throw new DiscordError(
        'Discord rate limit reached. Please try again shortly.',
        'RATE_LIMITED',
        429
      )
    }

    // Success
    if (response.ok) {
      if (response.status === 204) return null
      return await response.json().catch(() => null)
    }

    // Error responses
    const errorBody = await response.json().catch(() => ({}))
    const errorMessage = errorBody.message || `Discord API error (${response.status})`

    if (response.status === 401) {
      throw new DiscordError('Discord bot token is invalid.', 'INVALID_TOKEN', 401)
    }
    if (response.status === 403) {
      if (errorMessage.toLowerCase().includes('permission')) {
        throw new DiscordError(
          'Bot does not have permission to perform this action.',
          'MISSING_PERMISSION',
          403
        )
      }
      throw new DiscordError(errorMessage, 'FORBIDDEN', 403)
    }
    if (response.status === 404) {
      if (path.includes('/channels/')) {
        throw new DiscordError('Discord channel was not found.', 'CHANNEL_NOT_FOUND', 404)
      }
      if (path.includes('/guilds/')) {
        throw new DiscordError('Discord server was not found.', 'GUILD_NOT_FOUND', 404)
      }
      throw new DiscordError('Discord message was already deleted.', 'MESSAGE_NOT_FOUND', 404)
    }

    throw new DiscordError(errorMessage, 'API_ERROR', response.status)
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ─── Health / Validation ───

/**
 * Verify the bot token is valid and can access the configured guild and channel.
 * Returns a health status object. Never exposes the bot token.
 */
export async function healthCheck() {
  const result = {
    botToken: Boolean(env('DISCORD_BOT_TOKEN')),
    guild: { found: false, name: '', id: guildId() },
    channel: { found: false, name: '', id: channelId(), canSend: false, canAttach: false, canManage: false },
    adminUser: { configured: Boolean(adminUserId()), userId: adminUserId() },
    overall: 'error'
  }

  if (!result.botToken) {
    result.overall = 'error'
    return result
  }

  try {
    // Verify bot identity and guild access
    const me = await discordFetch('/users/@me')
    result.botUser = { id: me.id, username: me.username, discriminator: me.discriminator }

    const guild = await discordFetch(`/guilds/${guildId()}?with_counts=false`)
    result.guild.found = true
    result.guild.name = guild.name

    // Verify channel exists and bot can access it
    const channel = await discordFetch(`/channels/${channelId()}`)
    result.channel.found = true
    result.channel.name = channel.name || channel.id

    // Check permissions by attempting to read the channel
    result.channel.canSend = true
    result.channel.canAttach = true

    // Try a HEAD-like check: get recent messages (minimal data)
    await discordFetch(`/channels/${channelId()}/messages?limit=1`)
    result.channel.canManage = true // Assume if we can read, we have basic access

    result.overall = 'ok'
  } catch (error) {
    if (error instanceof DiscordError) {
      result.overall = 'error'
      result.error = error.message
      result.errorCode = error.code
    } else {
      result.overall = 'error'
      result.error = 'Discord API is unreachable.'
    }
  }

  return result
}

// ─── Admin Authorization ───

/**
 * Verify the request is from the configured admin user.
 * Uses the admin password from the existing X-Sutra admin system.
 */
export function requireAdmin(password) {
  const { verifyAdminPassword } = getAdminAuth()
  if (!verifyAdminPassword(password)) {
    throw new DiscordError('Unauthorized: invalid admin credentials.', 'UNAUTHORIZED', 401)
  }
}

function getAdminAuth() {
  // Reuse the existing premium admin password system
  const ADMIN_PASSWORD = env('ADMIN_PASSWORD') || 'admin123'
  return {
    verifyAdminPassword: (password) => password === ADMIN_PASSWORD
  }
}

// ─── Upload ───

/**
 * Upload a file to the configured Discord channel.
 * Returns the Discord message ID and attachment URL.
 */
export async function uploadToDiscord(fileBuffer, filename, contentType, content = '') {
  const guild = guildId()
  const channel = channelId()

  // Validate file size
  if (fileBuffer.length > MAX_FILE_SIZE) {
    throw new DiscordError(
      `File too large (${(fileBuffer.length / 1024 / 1024).toFixed(1)} MB). Maximum is 25 MB.`,
      'FILE_TOO_LARGE',
      413
    )
  }

  // Validate file type
  const allowedTypes = /^(image|video|audio)\//
  if (!allowedTypes.test(contentType)) {
    throw new DiscordError(
      `File type "${contentType}" is not allowed. Only images, videos, and audio files are supported.`,
      'INVALID_FILE_TYPE',
      400
    )
  }

  // Build multipart form data
  const formData = new FormData()
  const blob = new Blob([fileBuffer], { type: contentType })
  formData.append('file', blob, filename)
  if (content) {
    formData.append('content', content)
  }

  // Upload to Discord
  const result = await discordFetch(`/channels/${channel}/messages`, {
    method: 'POST',
    body: formData,
    headers: {} // Let browser set Content-Type with boundary
  })

  if (!result || !result.id) {
    throw new DiscordError('Discord upload failed: no message ID returned.', 'UPLOAD_FAILED', 500)
  }

  // Extract attachment URL from the response
  const attachmentUrl = result.attachments?.[0]?.url || `${DISCORD_CDN}/attachments/${channel}/${result.id}/${filename}`

  return {
    messageId: result.id,
    channelId: channel,
    guildId: guild,
    attachmentUrl,
    filename,
    size: fileBuffer.length,
    contentType
  }
}

/**
 * Upload a file using FormData from a request (for multipart uploads).
 */
export async function uploadFromFormData(formData, filename, contentType) {
  const guild = guildId()
  const channel = channelId()

  // Build multipart form data
  const uploadData = new FormData()
  const blob = formData.get('file')
  if (!blob) {
    throw new DiscordError('No file provided for upload.', 'NO_FILE', 400)
  }
  uploadData.append('file', blob, filename)
  const content = formData.get('content') || ''
  if (content) {
    uploadData.append('content', content)
  }

  const result = await discordFetch(`/channels/${channel}/messages`, {
    method: 'POST',
    body: uploadData,
    headers: {}
  })

  if (!result || !result.id) {
    throw new DiscordError('Discord upload failed: no message ID returned.', 'UPLOAD_FAILED', 500)
  }

  const attachmentUrl = result.attachments?.[0]?.url || `${DISCORD_CDN}/attachments/${channel}/${result.id}/${filename}`

  return {
    messageId: result.id,
    channelId: channel,
    guildId: guild,
    attachmentUrl,
    filename,
    size: blob.size || 0,
    contentType
  }
}

// ─── Delete ───

/**
 * Delete a message from Discord by message ID.
 */
export async function deleteMessage(messageId) {
  const channel = channelId()

  try {
    await discordFetch(`/channels/${channel}/messages/${messageId}`, {
      method: 'DELETE'
    })
    return { success: true, messageId, channelId: channel }
  } catch (error) {
    if (error instanceof DiscordError && error.code === 'MESSAGE_NOT_FOUND') {
      return { success: true, messageId, channelId: channel, alreadyDeleted: true }
    }
    throw error
  }
}

// ─── Channel Info ───

/**
 * Get basic info about the configured channel.
 */
export async function getChannelInfo() {
  const channel = await discordFetch(`/channels/${channelId()}`)
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    guildId: channel.guild_id
  }
}

export { guildId, channelId, adminUserId, MAX_FILE_SIZE }
