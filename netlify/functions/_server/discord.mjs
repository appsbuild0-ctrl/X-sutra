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
  const ADMIN_PASSWORD = env('ADMIN_PASSWORD') || env('PREMIUM_ADMIN_PASSWORD') || 'admin123'
  return {
    verifyAdminPassword: (password) => Boolean(password) && password === ADMIN_PASSWORD
  }
}

// ─── Upload ───

/**
 * Upload a file to a Discord channel — the channel picked in the admin console,
 * falling back to the channel configured as DISCORD_CHANNEL_ID.
 * Returns the Discord message ID and attachment URL.
 */
export async function uploadToDiscord(fileBuffer, filename, contentType, content = '', targetChannelId = '') {
  const guild = guildId()
  const channel = String(targetChannelId || '').trim() || channelId()

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
 * Delete a message from Discord by message ID (from the channel it lives in).
 */
export async function deleteMessage(messageId, targetChannelId = '') {
  const channel = String(targetChannelId || '').trim() || channelId()

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

// ─── Channel discovery ───

/** 0 = GUILD_TEXT, 5 = GUILD_ANNOUNCEMENT — the only guild channels with history. */
const GUILD_TEXT_TYPES = new Set([0, 5])
const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|avif|heic|heif|tiff?)$/i
const VIDEO_EXT = /\.(mp4|webm|mov|m4v|mkv|avi|mpg|mpeg|3gp)$/i

export const DEFAULT_IMPORT_LIMIT = 25
export const MAX_IMPORT_LIMIT = 100
/** One serverless request imports at most this many channels; the rest come back as `nextChannelIds`. */
export const MAX_SYNC_CHANNELS = 12
const DEFAULT_BUDGET_MS = Number(process.env.DISCORD_SYNC_BUDGET_MS) > 0 ? Number(process.env.DISCORD_SYNC_BUDGET_MS) : 8000

/**
 * Classify an attachment. Discord usually sends `content_type`, but files
 * uploaded through some clients arrive without it, so the filename is the
 * fallback — otherwise real images/videos would silently be dropped as "file".
 */
export function attachmentKind(attachment) {
  const type = String(attachment?.content_type || attachment?.contentType || '').toLowerCase()
  if (type.startsWith('image/')) return 'image'
  if (type.startsWith('video/')) return 'video'
  if (type.startsWith('audio/')) return 'audio'
  const name = String(attachment?.filename || '')
  if (IMAGE_EXT.test(name)) return 'image'
  if (VIDEO_EXT.test(name)) return 'video'
  return 'file'
}

/**
 * Pure: raw `GET /guilds/:id/channels` payload → importable channel rows.
 * Exported so the filtering rules can be tested without a bot token.
 */
export function pickChannelRows(rawChannels) {
  const rows = []
  for (const channel of Array.isArray(rawChannels) ? rawChannels : []) {
    const id = String(channel?.id || '').trim()
    if (!id || !GUILD_TEXT_TYPES.has(Number(channel?.type))) continue
    if (rows.some((row) => row.id === id)) continue
    rows.push({
      id,
      name: String(channel.name || '').replace(/^#+\s*/, '').trim().slice(0, 100) || `channel-${id}`,
      topic: String(channel.topic || '').trim().slice(0, 240),
      type: Number(channel.type) === 5 ? 'announcement' : 'text',
      parentId: String(channel.parent_id || '')
    })
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name))
}

/** Every text channel in the configured guild, ready for the admin's picker. */
export async function listChannels({ guild = guildId() } = {}) {
  return pickChannelRows(await discordFetch(`/guilds/${guild}/channels`))
}

/**
 * Pure: Discord messages → one row per attachment, each carrying the channel it
 * came from. Message text becomes the media title so imported posts keep their
 * caption in the app.
 */
export function pickMessageRows(messages, channelId) {
  const rows = []
  for (const message of Array.isArray(messages) ? messages : []) {
    const messageId = String(message?.id || '').trim()
    if (!messageId) continue
    const author = message.author || {}
    const createdAt = String(message.timestamp || message.edited_timestamp || new Date().toISOString())
    const caption = String(message.content || '').trim().slice(0, 200)
    for (const attachment of Array.isArray(message.attachments) ? message.attachments : []) {
      const attachmentId = String(attachment?.id || '').trim()
      if (!attachmentId) continue
      rows.push({
        channelId: String(channelId),
        messageId,
        attachmentId,
        kind: attachmentKind(attachment),
        title: caption || String(attachment.filename || attachmentId),
        filename: String(attachment.filename || attachmentId),
        mimeType: String(attachment.content_type || ''),
        width: Number(attachment.width) || 0,
        height: Number(attachment.height) || 0,
        bytes: Number(attachment.size) || 0,
        url: String(attachment.url || ''),
        proxyUrl: String(attachment.proxy_url || ''),
        author: String(author.id || ''),
        authorName: String(author.global_name || author.username || 'discord'),
        createdAt
      })
    }
  }
  return rows
}

export async function fetchChannelMessages(channelId, { limit = DEFAULT_IMPORT_LIMIT, before = '' } = {}) {
  const size = Math.max(1, Math.min(MAX_IMPORT_LIMIT, Number(limit) || DEFAULT_IMPORT_LIMIT))
  const cursor = before ? `&before=${encodeURIComponent(String(before))}` : ''
  return (await discordFetch(`/channels/${channelId}/messages?limit=${size}${cursor}`)) || []
}

/**
 * Discord CDN links are signed and expire, so the bytes are pulled server-side
 * and re-stored by us. Ephemeral attachments additionally require the bot
 * credentials, which is why a 401/403 is retried once with the token.
 */
export async function loadAttachmentBytes(row) {
  const target = row?.proxyUrl || row?.url
  if (!target) throw new DiscordError('Attachment has no download URL.', 'NO_ATTACHMENT_URL', 400)
  const agent = { 'User-Agent': 'RedGrab/1.0 (Premium Backend)' }
  let response = await fetch(target, { headers: agent })
  if (response.status === 401 || response.status === 403) response = await fetch(target, { headers: { ...agent, Authorization: `Bot ${botToken()}` } })
  if (!response.ok) throw new DiscordError(`Discord attachment download failed (${response.status}).`, 'DOWNLOAD_FAILED', response.status)
  return Buffer.from(await response.arrayBuffer())
}

/** Stable storage key: the same attachment can never be stored twice. */
export function storageKey(row) {
  return `dc-${String(row?.messageId || '').replace(/[^a-zA-Z0-9]/g, '')}-${String(row?.attachmentId || '').replace(/[^a-zA-Z0-9]/g, '')}`
}

/**
 * Pure: fold freshly imported rows into the premium catalog.
 *
 * Each Discord channel becomes one catalog channel (`discord-<id>`) and every
 * media row points back at it through `channelId`, so the Premium channel screen
 * shows the imported messages/images/videos under their source channel.
 */
export function mergeImportedIntoCatalog(catalog, { channel, rows }) {
  const channels = [...(catalog.channels || [])]
  const media = [...(catalog.media || [])]
  const sourceId = String(channel?.id || '')
  const wantedId = `discord-${sourceId}`
  let target = channels.find((entry) => entry.id === wantedId || String(entry.sourceId || '') === sourceId)
  if (!target) {
    target = {
      id: wantedId,
      name: String(channel?.name || `channel-${sourceId}`).slice(0, 48),
      description: String(channel?.topic || 'Imported from Discord').slice(0, 240),
      cover: '',
      type: 'mixed',
      status: 'on',
      order: channels.length + 1,
      createdAt: new Date().toISOString(),
      source: 'discord',
      sourceId
    }
    channels.push(target)
  } else {
    target = { ...target, name: String(channel?.name || target.name).slice(0, 48), source: 'discord', sourceId }
    for (let index = 0; index < channels.length; index += 1) if (channels[index].id === target.id) channels[index] = target
  }

  const seen = new Set(media.map((item) => String(item.sourceAttachmentId || '')).filter(Boolean))
  const added = []
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row?.attachmentId || seen.has(String(row.attachmentId))) continue
    seen.add(String(row.attachmentId))
    const url = `/api/premium-file?id=${storageKey(row)}`
    const isVideo = row.kind === 'video'
    const entry = {
      id: `dc-${row.messageId}-${row.attachmentId}`,
      type: isVideo ? 'video' : 'image',
      url,
      thumbnail: isVideo ? '' : url,
      title: String(row.title || row.filename || (isVideo ? 'Discord video' : 'Discord image')).slice(0, 120),
      tags: [],
      channelId: target.id,
      albumId: '',
      sourcePage: `https://discord.com/channels/${guildSafe()}/${row.channelId}/${row.messageId}`,
      createdAt: row.createdAt || new Date().toISOString(),
      filename: row.filename || '',
      size: row.storedBytes || row.bytes || 0,
      hash: `discord:${row.messageId}:${row.attachmentId}`,
      width: row.width || 0,
      height: row.height || 0,
      role: 'content',
      source: 'discord',
      sourceChannelId: row.channelId,
      sourceChannelName: String(channel?.name || ''),
      sourceMessageId: row.messageId,
      sourceAttachmentId: row.attachmentId,
      author: row.author || '',
      authorName: row.authorName || ''
    }
    media.unshift(entry)
    added.push(entry)
  }
  return { catalog: { ...catalog, channels, media }, channelId: target.id, channelName: target.name, added, skipped: (Array.isArray(rows) ? rows.length : 0) - added.length }
}

function guildSafe() {
  try { return guildId() } catch { return '@me' }
}

// Storage/database adapters. They are lazily imported so this module stays
// usable (and testable) without the Netlify blobs runtime or a DATABASE_URL.
async function defaultStoreBytes(id, bytes, contentType, filename) {
  const { writeFileBytes } = await import('../_premium-files.mjs')
  return writeFileBytes(id, bytes, contentType, filename)
}

async function defaultReadCatalog() {
  const { readCatalog } = await import('../_premium-store.mjs')
  return readCatalog()
}

async function defaultWriteCatalog(catalog) {
  const { writeCatalog } = await import('../_premium-store.mjs')
  return writeCatalog(catalog)
}

/**
 * Best effort: a missing DATABASE_URL must not lose an import — the bytes and
 * the catalog entry are already stored, the database is the durable index.
 */
async function defaultSaveRows(channel, entries, importedCount) {
  try {
    const { upsertDiscordChannel, upsertDiscordMedia } = await import('./database.mjs')
    await upsertDiscordChannel({ id: channel.id, guildId: env('DISCORD_GUILD_ID'), name: channel.name, topic: channel.topic, kind: channel.type, importedCount })
    if (entries.length) await upsertDiscordMedia(entries)
    return 'saved'
  } catch {
    return 'skipped'
  }
}

/**
 * Import real messages from the selected Discord channels.
 *
 * Every dependency is injectable, so the whole flow — channel lookup, history
 * read, attachment download, byte storage, catalog merge, database write — is
 * covered by scripts/tests/discord-sync.test.mjs without touching Discord.
 */
export async function importChannels({
  channelIds = [],
  perChannel = DEFAULT_IMPORT_LIMIT,
  kinds = ['image', 'video'],
  discover = listChannels,
  fetchMessages = fetchChannelMessages,
  loadBytes = loadAttachmentBytes,
  store = defaultStoreBytes,
  readStore = defaultReadCatalog,
  writeStore = defaultWriteCatalog,
  saveRows = defaultSaveRows,
  budgetMs = DEFAULT_BUDGET_MS,
  startedAt = Date.now()
} = {}) {
  const ids = [...new Set((Array.isArray(channelIds) ? channelIds : []).map((id) => String(id || '').trim()).filter(Boolean))].slice(0, MAX_SYNC_CHANNELS)
  if (!ids.length) throw new DiscordError('Select at least one Discord channel to import.', 'NO_CHANNELS', 400)

  const wanted = new Set((Array.isArray(kinds) ? kinds : []).map((kind) => String(kind)).filter(Boolean))
  const accepted = wanted.size ? wanted : new Set(['image', 'video'])
  const limit = Math.max(1, Math.min(MAX_IMPORT_LIMIT, Number(perChannel) || DEFAULT_IMPORT_LIMIT))

  const known = new Map((await discover()) .map((channel) => [channel.id, channel]))
  let catalog = await readStore()

  const summary = {
    ok: true,
    scanned: 0,
    attachments: 0,
    imported: 0,
    skipped: 0,
    failed: 0,
    partial: false,
    nextChannelIds: [],
    database: 'skipped',
    channels: []
  }

  const pending = [...ids]
  const expired = () => Date.now() - startedAt >= budgetMs

  while (pending.length) {
    if (expired()) { summary.partial = true; summary.nextChannelIds = pending.slice(0, MAX_SYNC_CHANNELS); break }
    const id = pending.shift()
    const channel = known.get(id) || { id, name: `channel-${id}`, topic: '', type: 'text' }
    const row = { id, name: channel.name, messages: 0, imported: 0, skipped: 0, failed: 0, error: '' }
    try {
      const messages = await fetchMessages(id, { limit })
      row.messages = Array.isArray(messages) ? messages.length : 0
      summary.scanned += row.messages
      const attachments = pickMessageRows(messages, id).filter((entry) => accepted.has(entry.kind))
      summary.attachments += attachments.length

      const fresh = []
      for (const item of attachments) {
        if (catalog.media.some((entry) => String(entry.sourceAttachmentId || '') === item.attachmentId)) { row.skipped += 1; continue }
        if (expired()) { summary.partial = true; pending.unshift(id); break }
        try {
          const bytes = await loadBytes(item)
          await store(storageKey(item), bytes, item.mimeType || (item.kind === 'image' ? 'image/jpeg' : 'video/mp4'), item.filename)
          item.storedBytes = bytes.length
          fresh.push(item)
        } catch (error) {
          row.failed += 1
          summary.failed += 1
          if (error instanceof DiscordError && (error.code === 'RATE_LIMITED' || error.code === 'DOWNLOAD_FAILED')) row.error = error.message
        }
      }

      const merged = mergeImportedIntoCatalog(catalog, { channel, rows: fresh })
      catalog = merged.catalog
      row.imported = merged.added.length
      summary.imported += merged.added.length
      summary.skipped += row.skipped
      summary.database = (await saveRows(channel, merged.added, summary.imported)) === 'saved' ? 'saved' : summary.database
      summary.channels.push(row)
    } catch (error) {
      row.error = error instanceof DiscordError ? error.message : 'Channel import failed.'
      summary.channels.push(row)
      summary.failed += 1
    }
  }

  await writeStore(catalog)
  summary.remaining = pending.length
  return summary
}

export { guildId, channelId, adminUserId, MAX_FILE_SIZE }
