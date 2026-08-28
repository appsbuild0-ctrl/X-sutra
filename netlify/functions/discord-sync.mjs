/**
 * /api/discord/sync — Discord channel discovery + real message/media import.
 *
 *   GET                      → configuration + what has been imported so far
 *   POST {action:list_channels}                     → the guild's text channels
 *   POST {action:sync, channelIds, perChannel, kinds} → import those channels
 *   POST {action:imported}                          → imported media rows
 *
 * The bot token never leaves the server. Imported attachment bytes are stored in
 * the premium file store (served back through /api/premium-file) and indexed in
 * PostgreSQL next to the channel they came from.
 */

import { readCatalog } from './_premium-store.mjs'
import { DiscordError, importChannels, listChannels, requireAdmin } from './_server/discord.mjs'

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
}

const reply = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) })

function authenticate(event, body) {
  const header = String(event.headers?.authorization || event.headers?.Authorization || '')
  const token = header.replace(/^Bearer\s+/i, '').trim()
  if (token) requireAdmin(token)
  else requireAdmin(body?.password)
}

function importedFromCatalog(catalog) {
  const channelNames = new Map((catalog.channels || []).map((channel) => [channel.id, channel.name]))
  return (catalog.media || [])
    .filter((item) => item.source === 'discord')
    .map((item) => ({
      id: item.id,
      channelId: item.channelId,
      channelName: item.sourceChannelName || channelNames.get(item.channelId) || item.channelId,
      catalogChannelName: channelNames.get(item.channelId) || '',
      sourceChannelId: item.sourceChannelId || '',
      messageId: item.sourceMessageId || '',
      attachmentId: item.sourceAttachmentId || '',
      kind: item.type === 'video' ? 'video' : 'image',
      title: item.title || '',
      url: item.url,
      width: item.width || 0,
      height: item.height || 0,
      bytes: item.size || 0,
      authorName: item.authorName || '',
      createdAt: item.createdAt || ''
    }))
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' }

  try {
    if (event.httpMethod === 'GET') {
      const catalog = await readCatalog()
      const imported = importedFromCatalog(catalog)
      let database = null
      try {
        const { discordImportedCount } = await import('./_server/database.mjs')
        database = await discordImportedCount()
      } catch { /* no DATABASE_URL — the catalog is still the source of truth */ }
      return reply(200, {
        configured: {
          botToken: Boolean(process.env.DISCORD_BOT_TOKEN),
          guildId: Boolean(process.env.DISCORD_GUILD_ID),
          defaultChannelId: process.env.DISCORD_CHANNEL_ID || ''
        },
        imported,
        totals: {
          media: imported.length,
          images: imported.filter((item) => item.kind === 'image').length,
          videos: imported.filter((item) => item.kind === 'video').length,
          channels: new Set(imported.map((item) => item.channelId)).size
        },
        database
      })
    }

    if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed.' })

    const body = JSON.parse(event.body || '{}')
    authenticate(event, body)

    if (body.action === 'list_channels') return reply(200, { channels: await listChannels() })

    if (body.action === 'sync') {
      const kinds = Array.isArray(body.kinds) && body.kinds.length ? body.kinds.map(String) : ['image', 'video']
      const result = await importChannels({
        channelIds: Array.isArray(body.channelIds) ? body.channelIds : [],
        perChannel: body.perChannel,
        kinds
      })
      return reply(200, result)
    }

    if (body.action === 'imported') {
      const catalog = await readCatalog()
      const imported = importedFromCatalog(catalog)
      const channelId = String(body.channelId || '').trim()
      return reply(200, { media: channelId ? imported.filter((item) => item.channelId === channelId || item.sourceChannelId === channelId) : imported })
    }

    return reply(400, { error: 'Unknown action.' })
  } catch (error) {
    if (error instanceof DiscordError) return reply(error.status || 500, { ok: false, error: error.message, code: error.code })
    const status = Number(error?.status) || 500
    return reply(status, { ok: false, error: error instanceof Error ? error.message : 'Discord sync failed.' })
  }
}
