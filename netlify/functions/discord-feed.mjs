/**
 * /api/discord/feed — the Premium media feed sourced from Discord.
 *
 * This is what makes "post to Discord → it appears in X-Sutra" work without a
 * manual refresh: on every read the endpoint checks whether any mapped channel
 * is due for a sync (auto-sync interval) and, if so, pulls only the messages
 * newer than the stored cursor before answering. The client also polls this
 * endpoint, so new media shows up on its own.
 *
 * The response carries media only — no bot token, no guild details, no cursors,
 * no error log. Those stay in the admin endpoints.
 */

import { defaultDiscordConfig, readCatalog, writeCatalog } from './_premium-store.mjs'
import { DiscordError, importChannels } from './_server/discord.mjs'

const MAX_LIMIT = 60
const MAX_SYNC_ERRORS = 20

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    body: JSON.stringify(body)
  }
}

const isConfigured = () => Boolean(process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_GUILD_ID)

/**
 * Mapped channels whose last *attempt* is older than the auto-sync interval.
 * Attempts (not just successes) are what throttle this: otherwise a mapping that
 * points at a deleted Discord channel would hit the API on every single read.
 */
export function dueChannels(config, now = Date.now()) {
  const interval = Math.max(15000, Number(config?.intervalMs) || 60000)
  const cursors = config?.cursors || {}
  return (config?.mappings || [])
    .map((mapping) => String(mapping.discordChannelId))
    .filter((id) => {
      const at = Date.parse(cursors[id]?.lastAttemptAt || cursors[id]?.at || '')
      return !Number.isFinite(at) || now - at >= interval
    })
}

/** Media rows trimmed to what the Premium UI renders. */
export function feedItems(media, { channelId = '', limit = MAX_LIMIT, before = '' } = {}) {
  const cutoff = Date.parse(before || '')
  return (Array.isArray(media) ? media : [])
    .filter((item) => item?.source === 'discord')
    .filter((item) => !channelId || item.channelId === channelId)
    .filter((item) => !Number.isFinite(cutoff) || Date.parse(item.createdAt) < cutoff)
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
    .slice(0, Math.max(1, Math.min(MAX_LIMIT, Number(limit) || MAX_LIMIT)))
    .map((item) => ({
      id: item.id,
      type: item.type === 'video' ? 'video' : 'image',
      url: item.url,
      thumbnail: item.thumbnail || '',
      title: item.title || '',
      channelId: item.channelId,
      channelName: item.sourceChannelName || '',
      filename: item.filename || '',
      mimeType: item.mimeType || '',
      width: Number(item.width) || 0,
      height: Number(item.height) || 0,
      size: Number(item.size) || 0,
      authorName: item.authorName || '',
      createdAt: item.createdAt || ''
    }))
}

async function recordError(catalog, message) {
  const config = { ...defaultDiscordConfig(), ...(catalog.discord || {}) }
  config.errors = [{ at: new Date().toISOString(), message: String(message).slice(0, 200) }, ...(config.errors || [])].slice(0, MAX_SYNC_ERRORS)
  await writeCatalog({ ...catalog, discord: config }).catch(() => undefined)
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'GET') return json(405, { error: 'GET only.' })

    const params = event.queryStringParameters || {}
    const channelId = String(params.channelId || '').trim()
    const limit = Number(params.limit) || 30
    const before = String(params.before || '').trim()

    let catalog = await readCatalog()
    const config = { ...defaultDiscordConfig(), ...(catalog.discord || {}) }
    let synced = null
    let syncError = ''

    if (config.autoSync && config.mappings.length) {
      if (!isConfigured()) {
        syncError = 'Discord bot is not configured on the server.'
      } else {
        const due = dueChannels(config)
        if (due.length) {
          try {
            const summary = await importChannels({
              channelIds: due,
              perChannel: config.perChannel,
              kinds: config.kinds,
              mode: config.mode,
              mappings: config.mappings,
              cursors: config.cursors,
              incremental: true
            })
            // importChannels persisted the media; persist the new cursors too.
            catalog = await readCatalog()
            const next = { ...defaultDiscordConfig(), ...(catalog.discord || {}) }
            next.cursors = summary.cursors
            next.lastSyncAt = summary.syncedAt
            next.lastResult = {
              at: summary.syncedAt,
              scanned: summary.scanned,
              imported: summary.imported,
              skipped: summary.skipped,
              failed: summary.failed,
              partial: summary.partial,
              channels: summary.channels
            }
            const failures = summary.channels.filter((channel) => channel.error)
            if (failures.length) next.errors = failures.map((channel) => ({ at: summary.syncedAt, channel: channel.name, message: channel.error })).concat(next.errors || []).slice(0, MAX_SYNC_ERRORS)
            await writeCatalog({ ...catalog, discord: next })
            catalog = await readCatalog()
            synced = { at: summary.syncedAt, imported: summary.imported, skipped: summary.skipped, channels: due.length }
          } catch (error) {
            syncError = error instanceof DiscordError ? error.message : 'Discord sync failed.'
            await recordError(catalog, syncError)
          }
        }
      }
    }

    const items = feedItems(catalog.media, { channelId, limit, before })
    const sections = (config.mappings || [])
      .map((mapping) => {
        const channel = (catalog.channels || []).find((entry) => entry.id === mapping.channelId)
        return {
          channelId: mapping.channelId,
          name: channel?.name || mapping.name || '',
          type: channel?.type || 'mixed',
          discordChannelId: mapping.discordChannelId,
          kinds: mapping.kinds?.length ? mapping.kinds : ['image', 'video'],
          lastSyncAt: config.cursors?.[mapping.discordChannelId]?.at || '',
          count: (catalog.media || []).filter((item) => item.source === 'discord' && item.channelId === mapping.channelId).length
        }
      })
      .filter((section) => !channelId || section.channelId === channelId)

    return json(200, {
      media: items,
      sections,
      autoSync: config.autoSync !== false,
      intervalMs: Math.max(15000, Number(config.intervalMs) || 60000),
      mode: config.mode === 'store' ? 'store' : 'link',
      configured: isConfigured(),
      synced,
      syncError,
      oldest: items.length ? items[items.length - 1].createdAt : '',
      hasMore: items.length === Math.max(1, Math.min(MAX_LIMIT, limit))
    })
  } catch {
    return json(500, { error: 'Discord feed is unavailable.' })
  }
}
