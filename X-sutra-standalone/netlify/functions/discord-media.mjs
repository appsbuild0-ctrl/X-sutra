/**
 * /api/discord/media?id=<mediaId> — resolves one imported attachment to a
 * playable Discord CDN URL and 302s the browser straight to it.
 *
 * Nothing is copied into a second store: the browser streams images and videos
 * directly from Discord. Because Discord signs those links and they expire, the
 * cached signature is reused while it is valid and silently refreshed from the
 * Discord API (message re-read) the moment it is not — so an old card never
 * turns into a broken preview.
 *
 * Only attachments that are already in the Premium catalog can be resolved, so
 * this endpoint cannot be used to reach arbitrary Discord channels.
 */

import { readCatalog, writeCatalog } from './_premium-store.mjs'
import { DiscordError, resolveAttachment } from './_server/discord.mjs'

const MAX_REDIRECT_CACHE_S = 300

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
    body: JSON.stringify(body)
  }
}

export const handler = async (event) => {
  try {
    const method = event.httpMethod || 'GET'
    if (method !== 'GET' && method !== 'HEAD') return json(405, { error: 'GET and HEAD only.' })

    const params = event.queryStringParameters || {}
    const id = String(params.id || new URL(event.rawUrl || 'http://local/?id=').searchParams.get('id') || '').trim()
    if (!id) return json(400, { error: 'Missing media id.' })

    const catalog = await readCatalog()
    const entry = (catalog.media || []).find((item) => item.id === id && item.source === 'discord')
    // Not in the catalog → not a channel the admin mapped. Say nothing more.
    if (!entry) return json(404, { error: 'Media not found.' })

    let resolved
    try {
      resolved = await resolveAttachment(entry)
    } catch (error) {
      // An attachment that is gone for good must not leave a dead signed URL in
      // the catalog: forget it, so the next sync/refresh can re-read Discord.
      if (error instanceof DiscordError && error.code === 'ATTACHMENT_GONE' && entry.cdnUrl) {
        entry.cdnUrl = ''
        entry.cdnExpiresAt = 0
        await writeCatalog(catalog).catch(() => undefined)
      }
      throw error
    }

    if (resolved.refreshed) {
      // Persist the new signature so the next viewer does not hit Discord again.
      entry.cdnUrl = resolved.url
      entry.cdnExpiresAt = resolved.expiresAt
      await writeCatalog(catalog).catch(() => undefined)
    }

    const ttl = resolved.expiresAt
      ? Math.max(0, Math.min(MAX_REDIRECT_CACHE_S, Math.floor((resolved.expiresAt - Date.now()) / 1000) - 60))
      : 86400
    return {
      statusCode: 302,
      headers: {
        location: resolved.url,
        'cache-control': `private, max-age=${ttl}`,
        'content-type': 'application/json; charset=utf-8'
      },
      body: ''
    }
  } catch (error) {
    if (error instanceof DiscordError) {
      const status = error.code === 'ATTACHMENT_GONE' ? 410 : error.status || 502
      return json(status, { error: error.message })
    }
    return json(502, { error: 'Discord media is temporarily unavailable.' })
  }
}
