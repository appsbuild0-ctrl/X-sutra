// Real Discord Bot API integration, server-side only.
//
// The bot token is read from DISCORD_BOT_TOKEN at call time and is NEVER returned
// to the client, written to a response, or stored. All calls are plain Discord
// REST requests made from the existing X-Sutra backend — no long-running
// WebSocket/gateway process and no separate bot hosting.
//
// Rate limits are honoured: on HTTP 429 we read `retry_after` and retry a bounded
// number of times; we never loop forever.

const API = 'https://discord.com/api/v10'

// Discord permission bits (BigInt).
const PERM = {
  ADMINISTRATOR: 0x8n,
  VIEW_CHANNEL: 0x400n,
  SEND_MESSAGES: 0x800n,
  EMBED_LINKS: 0x4000n,
  ATTACH_FILES: 0x8000n,
  MANAGE_MESSAGES: 0x2000n,
  READ_MESSAGE_HISTORY: 0x10000n
}

// Without a boosted server Discord caps attachments at 8 MiB.
export function maxUploadBytes() {
  const mb = Number(process.env.DISCORD_MAX_UPLOAD_MB)
  return Number.isFinite(mb) && mb > 0 ? Math.floor(mb * 1024 * 1024) : 8 * 1024 * 1024
}

export function discordConfig() {
  const token = String(process.env.DISCORD_BOT_TOKEN || '').trim()
  const guildId = String(process.env.DISCORD_GUILD_ID || '').trim()
  const channelId = String(process.env.DISCORD_CHANNEL_ID || '').trim()
  const adminUserId = String(process.env.DISCORD_ADMIN_USER_ID || '').trim()
  const missing = []
  if (!token) missing.push('DISCORD_BOT_TOKEN')
  if (!guildId) missing.push('DISCORD_GUILD_ID')
  if (!channelId) missing.push('DISCORD_CHANNEL_ID')
  if (!adminUserId) missing.push('DISCORD_ADMIN_USER_ID')
  return { token, guildId, channelId, adminUserId, missing, configured: missing.length === 0 }
}

const fail = (message, statusCode = 502) => Object.assign(new Error(message), { statusCode })

/** Map a Discord REST failure to a readable, non-secret message. */
function readable(status, data, path) {
  const code = Number(data?.code || 0)
  if (status === 401) return fail('Discord bot token is invalid.', 502)
  if (status === 429) return fail('Discord rate limit reached. Please try again shortly.', 429)
  if (status === 403 || code === 50013) {
    if (path.includes('/messages') && path.endsWith('/messages')) return fail('Bot does not have permission to send messages or upload files in the configured channel.', 502)
    return fail('Bot does not have permission for this action on Discord.', 502)
  }
  if (status === 404) {
    if (path.includes('/guilds/')) return fail('Discord server was not found (or the bot is not a member).', 502)
    if (path.includes('/channels/') && path.includes('/messages/')) return fail('Discord message was already deleted.', 404)
    if (path.includes('/channels/')) return fail('Discord channel was not found.', 502)
    return fail('Discord resource was not found.', 404)
  }
  if (status === 400 && code === 50035 && /files?/.test(JSON.stringify(data?.errors || {}))) return fail('Discord rejected the attachment (file type or size).', 400)
  return fail(`Discord upload failed (HTTP ${status}).`, 502)
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Core Discord REST call with auth header, timeout, and bounded 429 retries.
 * `form` (FormData) is sent as multipart; otherwise JSON.
 */
export async function discordRequest(method, path, { json, form, retries = 2, timeoutMs = 20000 } = {}) {
  const { token } = discordConfig()
  if (!token) throw fail('DISCORD_BOT_TOKEN is not set on the server.', 503)

  let attempt = 0
  for (;;) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      const headers = { Authorization: `Bot ${token}`, 'User-Agent': 'X-Sutra (discord-rest, +x-sutra)' }
      if (json !== undefined) headers['Content-Type'] = 'application/json'
      response = await fetch(API + path, {
        method,
        headers,
        body: form ? form : json !== undefined ? JSON.stringify(json) : undefined,
        signal: controller.signal
      })
    } catch (error) {
      clearTimeout(timer)
      if (error?.name === 'AbortError') throw fail('Discord request timed out.', 504)
      throw fail(`Discord is unreachable (${error?.message || 'network error'}).`, 502)
    }
    clearTimeout(timer)

    if (response.status === 429 && attempt < retries) {
      const data = await response.json().catch(() => ({}))
      const wait = Math.min(Number(data.retry_after ?? 1) * 1000, 5000)
      attempt += 1
      await sleep(wait)
      continue
    }

    const data = response.status === 204 ? {} : await response.json().catch(() => ({}))
    if (response.ok) return data
    throw readable(response.status, data, path)
  }
}

/** Compute the bot's effective permission bits in a channel. */
function computeChannelPerms(guild, member, channel) {
  const roles = new Map((guild.roles || []).map((role) => [role.id, BigInt(role.permissions || '0')]))
  let perms = roles.get(guild.id) || 0n // @everyone base
  for (const roleId of member.roles || []) perms |= roles.get(roleId) || 0n
  if (perms & PERM.ADMINISTRATOR) return perms | Object.values(PERM).reduce((a, b) => a | b, 0n)

  const overwrites = channel.permission_overwrites || []
  const denyEveryone = overwrites.find((o) => o.id === guild.id && o.type === 0)
  const allowEveryone = denyEveryone
  if (allowEveryone) perms = (perms & ~BigInt(allowEveryone.deny || '0')) | BigInt(allowEveryone.allow || '0')
  let roleAllow = 0n
  let roleDeny = 0n
  for (const o of overwrites) {
    if (o.type === 0 && (member.roles || []).includes(o.id)) {
      roleAllow |= BigInt(o.allow || '0')
      roleDeny |= BigInt(o.deny || '0')
    }
  }
  perms = (perms & ~roleDeny) | roleAllow
  const memberOw = overwrites.find((o) => o.id === member.user?.id && o.type === 1)
  if (memberOw) perms = (perms & ~BigInt(memberOw.deny || '0')) | BigInt(memberOw.allow || '0')
  return perms
}

/**
 * Health check used by the admin/debug status endpoint. It verifies the token,
 * guild membership, channel access and the permissions the integration needs.
 * Never includes the token.
 */
export async function verifyDiscordSetup() {
  const config = discordConfig()
  if (!config.configured) {
    return { configured: false, missing: config.missing, api: 'Unavailable', guild: 'Unavailable', channel: 'Unavailable', permissions: 'Unavailable' }
  }
  const me = await discordRequest('GET', '/users/@me') // throws "token is invalid" on 401
  const guild = await discordRequest('GET', `/guilds/${config.guildId}`).catch((error) => ({ error: error.message }))
  if (guild.error) return { configured: true, api: 'Connected', bot: me.username, guild: 'Not Found', guildError: guild.error, channel: 'Unavailable', permissions: 'Unavailable' }

  const channel = await discordRequest('GET', `/channels/${config.channelId}`).catch((error) => ({ error: error.message }))
  if (channel.error) return { configured: true, api: 'Connected', bot: me.username, guild: 'Found', channel: 'Not Found', channelError: channel.error, permissions: 'Unavailable' }
  if (String(channel.guild_id || '') !== String(config.guildId)) return { configured: true, api: 'Connected', bot: me.username, guild: 'Found', channel: 'Wrong Server', permissions: 'Unavailable' }

  const member = await discordRequest('GET', `/guilds/${config.guildId}/members/${me.id}`).catch(() => null)
  if (!member) return { configured: true, api: 'Connected', bot: me.username, guild: 'Found (bot not a member)', channel: 'Found', permissions: 'Unavailable' }

  const perms = computeChannelPerms(guild, member, channel)
  const needs = {
    viewChannel: Boolean(perms & PERM.VIEW_CHANNEL),
    sendMessages: Boolean(perms & PERM.SEND_MESSAGES),
    attachFiles: Boolean(perms & PERM.ATTACH_FILES),
    embedLinks: Boolean(perms & PERM.EMBED_LINKS),
    readMessageHistory: Boolean(perms & PERM.READ_MESSAGE_HISTORY),
    manageMessages: Boolean(perms & PERM.MANAGE_MESSAGES)
  }
  const okPerms = needs.viewChannel && needs.sendMessages && needs.attachFiles && needs.readMessageHistory
  return {
    configured: true,
    api: 'Connected',
    bot: me.username,
    guild: 'Found',
    channel: 'Found',
    permissions: okPerms ? 'OK' : 'Missing',
    permissionDetail: needs
  }
}

const safeFilename = (name) => String(name || 'upload').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80)

/**
 * Upload a file to the configured channel as a real Discord message. Returns the
 * created message with its id and attachment URL — the caller stores the mapping
 * only after this succeeds (never before).
 */
export async function uploadToDiscord({ bytes, filename, contentType, title }) {
  const config = discordConfig()
  if (!config.configured) throw fail(`Discord is not configured (missing: ${config.missing.join(', ')}).`, 503)
  if (bytes.length > maxUploadBytes()) throw fail(`File is ${(bytes.length / 1048576).toFixed(1)} MB — Discord allows up to ${Math.floor(maxUploadBytes() / 1048576)} MB.`, 413)

  const form = new FormData()
  form.append('payload_json', JSON.stringify({ content: String(title || filename).slice(0, 500) }))
  form.append('files[0]', new Blob([bytes], { type: contentType || 'application/octet-stream' }), safeFilename(filename))

  const message = await discordRequest('POST', `/channels/${config.channelId}/messages`, { form })
  const attachment = (message.attachments || [])[0] || {}
  return {
    messageId: String(message.id),
    attachmentUrl: String(attachment.url || ''),
    attachmentSize: Number(attachment.size || bytes.length),
    guildId: config.guildId,
    channelId: config.channelId
  }
}

/** Delete a Discord message; a 404 (already deleted) resolves gracefully. */
export async function deleteDiscordMessage(messageId) {
  const config = discordConfig()
  if (!config.configured) throw fail(`Discord is not configured (missing: ${config.missing.join(', ')}).`, 503)
  try {
    await discordRequest('DELETE', `/channels/${config.channelId}/messages/${messageId}`)
    return { ok: true, alreadyDeleted: false }
  } catch (error) {
    if (error.statusCode === 404) return { ok: true, alreadyDeleted: true }
    throw error
  }
}
