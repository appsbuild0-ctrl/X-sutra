// /api/discord/media + /api/discord/status — Discord-backed content, real REST.
//
// GET  → published content (public shape: no guild/channel/message ids, no token)
// POST → admin-only (existing X-Sutra admin password): status / start / chunk /
//        finish(upload) / list / delete.
//
// The Discord message is created FIRST; the database mapping is written only
// after Discord returns a real message id. A Discord failure never leaves a
// "successful" row or a fake success message.

import { errorResponse, json } from './_server/security.mjs'
import { adminPassword } from './_premium-store.mjs'
import { deleteDiscordMessage, maxUploadBytes, uploadToDiscord, verifyDiscordSetup } from './_server/discord.mjs'
import {
  assembleChunks,
  clearChunks,
  getDiscordMedia,
  kindFor,
  listDiscordMedia,
  markDeleted,
  publicDiscordMedia,
  recordDiscordMedia,
  writeChunk
} from './_server/discordMedia.mjs'

/** Existing X-Sutra admin authentication (the same secret PremiumAdmin uses). */
function requireDiscordAdmin(event, body = {}) {
  const expected = adminPassword()
  const supplied = String(body.password ?? event.headers?.['x-admin-password'] ?? '')
  if (!expected || supplied !== expected) {
    throw Object.assign(new Error('Admin authentication required.'), { statusCode: 403 })
  }
}

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const rows = await listDiscordMedia()
      return json(200, { media: rows.map((row) => publicDiscordMedia(row)) })
    }
    if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' })

    const body = JSON.parse(event.body || '{}')
    const action = String(body.action || '')

    if (action === 'status') {
      requireDiscordAdmin(event, body)
      return json(200, await verifyDiscordSetup())
    }

    if (action === 'list') {
      requireDiscordAdmin(event, body)
      const rows = await listDiscordMedia({ includeDeleted: true })
      return json(200, { media: rows.map((row) => publicDiscordMedia(row, { admin: true })) })
    }

    if (action === 'start') {
      requireDiscordAdmin(event, body)
      const size = Number(body.size || 0)
      if (!Number.isFinite(size) || size <= 0) throw Object.assign(new Error('File size is required.'), { statusCode: 400 })
      if (size > maxUploadBytes()) throw Object.assign(new Error(`File is ${(size / 1048576).toFixed(1)} MB — Discord allows up to ${Math.floor(maxUploadBytes() / 1048576)} MB.`), { statusCode: 413 })
      const chunkSize = 3 * 1024 * 1024
      return json(200, { ok: true, id: `up${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, chunkSize, chunks: Math.ceil(size / chunkSize) })
    }

    if (action === 'chunk') {
      requireDiscordAdmin(event, body)
      const received = await writeChunk(body.id, Number(body.index), Buffer.from(String(body.data || ''), 'base64'))
      return json(200, { ok: true, received })
    }

    if (action === 'finish') {
      requireDiscordAdmin(event, body)
      const bytes = body.data !== undefined
        ? Buffer.from(String(body.data || ''), 'base64') // single-request small file
        : await assembleChunks(body.id)
      if (!bytes.length) throw Object.assign(new Error('No file data received.'), { statusCode: 400 })
      if (bytes.length > maxUploadBytes()) {
        await clearChunks(body.id).catch(() => {})
        throw Object.assign(new Error(`File is ${(bytes.length / 1048576).toFixed(1)} MB — Discord allows up to ${Math.floor(maxUploadBytes() / 1048576)} MB.`), { statusCode: 413 })
      }

      // 1) Real Discord upload. If this throws, nothing is recorded and the
      //    error is surfaced — no fake success, no partial row.
      const sent = await uploadToDiscord({
        bytes,
        filename: body.filename,
        contentType: body.contentType,
        title: body.title
      })
      // 2) Only after success, store the mapping.
      const row = await recordDiscordMedia({
        title: body.title,
        description: body.description,
        filename: body.filename,
        bytes: bytes.length,
        mimeType: body.contentType,
        kind: kindFor(body.contentType),
        guildId: sent.guildId,
        channelId: sent.channelId,
        messageId: sent.messageId,
        attachmentUrl: sent.attachmentUrl,
        accessRole: body.accessRole
      })
      await clearChunks(body.id).catch(() => {})
      return json(200, { ok: true, media: publicDiscordMedia(row, { admin: true }) })
    }

    if (action === 'delete') {
      requireDiscordAdmin(event, body)
      const row = await getDiscordMedia(body.id)
      if (!row) throw Object.assign(new Error('That upload does not exist.'), { statusCode: 404 })
      // Real Discord deletion; a 404 (already deleted) is handled gracefully.
      const result = await deleteDiscordMessage(String(row.discord_message_id))
      await markDeleted(body.id)
      return json(200, { ok: true, alreadyDeleted: result.alreadyDeleted })
    }

    return json(400, { error: 'Unknown action.' })
  } catch (error) {
    return errorResponse(error)
  }
}
