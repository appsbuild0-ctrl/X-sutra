/**
 * /api/discord/sync — admin console for Discord as the Premium media source.
 *
 *   GET                        → configuration + sync status (admin)
 *   POST {action:list_channels}                       → the guild's text channels
 *   POST {action:config, config}                      → read/update mapping + auto-sync
 *   POST {action:sync, channelIds?, full?}            → "Sync Now"
 *   POST {action:status}                              → cursors, last result, error log
 *   POST {action:imported}                            → media already stored
 *
 * The bot token never leaves the server, and only channels the admin mapped can
 * ever be synced or served.
 */

import { defaultDiscordConfig, readCatalog, writeCatalog } from './_premium-store.mjs'
import { DiscordError, importChannels, listChannels, requireAdmin } from './_server/discord.mjs'

const HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Cache-Control': 'no-store',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
}

const MAX_SYNC_ERRORS = 20

const reply = (statusCode, body) => ({ statusCode, headers: HEADERS, body: JSON.stringify(body) })

function authenticate(event, body) {
  const header = String(event.headers?.authorization || event.headers?.Authorization || '')
  const token = header.replace(/^Bearer\s+/i, '').trim()
  if (token) requireAdmin(token)
  else requireAdmin(body?.password)
}

const isConfigured = () => Boolean(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_GUILD_ID)

/** Validate an incoming mapping list against the channels that really exist. */
export function normalizeMappings(rawMappings, channels) {
  const known = new Map((channels || []).map((channel) => [channel.id, channel]))
  const seen = new Set()
  const mappings = []
  for (const raw of Array.isArray(rawMappings) ? rawMappings : []) {
    const discordChannelId = String(raw?.discordChannelId || '').trim()
    if (!discordChannelId || seen.has(discordChannelId)) continue
    seen.add(discordChannelId)
    const channelId = String(raw?.channelId || '').trim()
    const channel = known.get(channelId)
    const kinds = (Array.isArray(raw?.kinds) ? raw.kinds : []).map(String).filter((kind) => kind === 'image' || kind === 'video')
    mappings.push({
      discordChannelId,
      // An unknown/empty target falls back to the channel's own Premium section.
      channelId: channel ? channelId : '',
      name: String(raw?.name || channel?.name || '').slice(0, 60),
      kinds: kinds.length ? kinds : ['image', 'video']
    })
  }
  return mappings
}

/** Write cursors + last result + error log back into the catalog config. */
export function applySyncResult(catalog, summary) {
  const config = { ...defaultDiscordConfig(), ...(catalog.discord || {}) }
  config.cursors = summary.cursors || config.cursors
  config.lastSyncAt = summary.syncedAt || new Date().toISOString()
  config.lastResult = {
    at: config.lastSyncAt,
    scanned: summary.scanned,
    imported: summary.imported,
    skipped: summary.skipped,
    failed: summary.failed,
    partial: summary.partial,
    channels: summary.channels || []
  }
  const failures = (summary.channels || []).filter((channel) => channel.error)
  if (failures.length) {
    config.errors = failures
      .map((channel) => ({ at: config.lastSyncAt, channel: channel.name, message: channel.error }))
      .concat(config.errors || [])
      .slice(0, MAX_SYNC_ERRORS)
  }
  return config
}

function statusPayload(catalog) {
  const config = { ...defaultDiscordConfig(), ...(catalog.discord || {}) }
  const channelNames = new Map((catalog.channels || []).map((channel) => [channel.id, channel.name]))
  return {
    configured: {
      botToken: Boolean(process.env.DISCORD_BOT_TOKEN),
      guildId: Boolean(process.env.DISCORD_GUILD_ID),
      defaultChannelId: process.env.DISCORD_CHANNEL_ID || '',
      storeAttachments: config.mode === 'store'
    },
    autoSync: config.autoSync !== false,
    intervalMs: config.intervalMs,
    perChannel: config.perChannel,
    kinds: config.kinds,
    mode: config.mode,
    mappings: config.mappings.map((mapping) => ({
      ...mapping,
      channelName: channelNames.get(mapping.channelId) || '',
      cursor: config.cursors?.[mapping.discordChannelId]?.cursor || '',
      lastSyncAt: config.cursors?.[mapping.discordChannelId]?.at || '',
      imported: config.cursors?.[mapping.discordChannelId]?.imported || 0,
      media: (catalog.media || []).filter((item) => item.source === 'discord' && item.channelId === mapping.channelId).length
    })),
    lastSyncAt: config.lastSyncAt,
    lastResult: config.lastResult,
    errors: config.errors || [],
    totals: {
      media: (catalog.media || []).filter((item) => item.source === 'discord').length,
      images: (catalog.media || []).filter((item) => item.source === 'discord' && item.type !== 'video').length,
      videos: (catalog.media || []).filter((item) => item.source === 'discord' && item.type === 'video').length
    }
  }
}

function importedFromCatalog(catalog) {
  const channelNames = new Map((catalog.channels || []).map((channel) => [channel.id, channel.name]))
  return (catalog.media || [])
    .filter((item) => item.source === 'discord')
    .map((item) => ({
      id: item.id,
      channelId: item.channelId,
      channelName: item.sourceChannelName || channelNames.get(item.channelId) || item.channelId,
      targetChannelName: channelNames.get(item.channelId) || '',
      sourceChannelId: item.sourceChannelId || '',
      messageId: item.sourceMessageId || '',
      attachmentId: item.sourceAttachmentId || '',
      kind: item.type === 'video' ? 'video' : 'image',
      title: item.title || '',
      url: item.url,
      filename: item.filename || '',
      mimeType: item.mimeType || '',
      width: item.width || 0,
      height: item.height || 0,
      bytes: item.size || 0,
      authorName: item.authorName || '',
      createdAt: item.createdAt || '',
      expiresAt: item.cdnExpiresAt || 0
    }))
}

export const handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: HEADERS, body: '' }

  try {
    if (event.httpMethod === 'GET') return reply(200, statusPayload(await readCatalog()))
    if (event.httpMethod !== 'POST') return reply(405, { error: 'Method not allowed.' })

    const body = JSON.parse(event.body || '{}')
    authenticate(event, body)
    const catalog = await readCatalog()
    const config = { ...defaultDiscordConfig(), ...(catalog.discord || {}) }

    if (body.action === 'list_channels') return reply(200, { channels: await listChannels() })

    if (body.action === 'config') {
      if (!body.config) return reply(200, { config })
      const patch = body.config
      const next = {
        ...config,
        autoSync: patch.autoSync != null ? patch.autoSync !== false : config.autoSync,
        intervalMs: patch.intervalMs != null ? Math.max(15000, Number(patch.intervalMs) || config.intervalMs) : config.intervalMs,
        perChannel: patch.perChannel != null ? Math.max(1, Math.min(100, Number(patch.perChannel) || config.perChannel)) : config.perChannel,
        kinds: Array.isArray(patch.kinds) && patch.kinds.length
          ? patch.kinds.map(String).filter((kind) => kind === 'image' || kind === 'video')
          : config.kinds,
        mode: patch.mode === 'store' ? 'store' : patch.mode === 'link' ? 'link' : config.mode,
        mappings: patch.mappings != null ? normalizeMappings(patch.mappings, catalog.channels) : config.mappings
      }
      if (!next.kinds.length) next.kinds = ['image', 'video']
      await writeCatalog({ ...catalog, discord: next })
      return reply(200, { config: next, status: statusPayload(await readCatalog()) })
    }

    if (body.action === 'sync') {
      const mappings = Array.isArray(body.mappings) ? normalizeMappings(body.mappings, catalog.channels) : config.mappings
      if (!mappings.length) return reply(400, { error: 'Map at least one Discord channel to a Premium section first.' })
      // Only channels the admin explicitly mapped can ever be synced — an
      // arbitrary channel id in the request body is rejected, not read.
      const mapped = new Set(mappings.map((mapping) => mapping.discordChannelId))
      const requested = (Array.isArray(body.channelIds) ? body.channelIds : []).map(String).filter(Boolean)
      const allowed = requested.filter((id) => mapped.has(id))
      if (requested.length && !allowed.length) {
        return reply(403, { error: 'That Discord channel is not configured for sync.' })
      }
      const channelIds = allowed.length ? allowed : [...mapped]
      const kinds = Array.isArray(body.kinds) && body.kinds.length ? body.kinds.map(String) : config.kinds

      let summary
      try {
        summary = await importChannels({
          channelIds,
          perChannel: body.perChannel || config.perChannel,
          kinds,
          mode: config.mode,
          mappings,
          cursors: config.cursors,
          incremental: body.full !== true
        })
      } catch (error) {
        const message = error instanceof DiscordError ? error.message : 'Discord sync failed.'
        const failed = { ...config, errors: [{ at: new Date().toISOString(), message }, ...(config.errors || [])].slice(0, MAX_SYNC_ERRORS) }
        await writeCatalog({ ...catalog, discord: failed })
        throw error
      }

      const fresh = await readCatalog()
      await writeCatalog({ ...fresh, discord: applySyncResult(fresh, summary) })
      return reply(200, { ...summary, status: statusPayload(await readCatalog()) })
    }

    if (body.action === 'status') return reply(200, statusPayload(await readCatalog()))

    if (body.action === 'imported') {
      const imported = importedFromCatalog(catalog)
      const channelId = String(body.channelId || '').trim()
      return reply(200, {
        media: channelId ? imported.filter((item) => item.channelId === channelId || item.sourceChannelId === channelId) : imported,
        status: statusPayload(catalog)
      })
    }

    return reply(400, { error: 'Unknown action.' })
  } catch (error) {
    if (error instanceof DiscordError) return reply(error.status || 500, { ok: false, error: error.message, code: error.code })
    const status = Number(error?.status) || 500
    return reply(status, { ok: false, error: error instanceof Error ? error.message : 'Discord sync failed.' })
  }
}
