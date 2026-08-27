/**
 * /api/discord/upload — POST
 *
 * Admin uploads a file to the configured Discord channel.
 * The file is sent as a multipart form or JSON with base64 data.
 * Returns the Discord message ID and attachment URL.
 * Bot token is NEVER exposed in the response.
 */

import { uploadToDiscord, requireAdmin, DiscordError } from './_server/discord.mjs'

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed.' }) }
  }

  try {
    // Require admin authorization
    const authHeader = event.headers?.authorization || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (!token) {
      return {
        statusCode: 401,
        headers,
        body: JSON.stringify({ error: 'Unauthorized: admin credentials required.' })
      }
    }
    requireAdmin(token)

    // Parse request body
    const body = JSON.parse(event.body || '{}')
    const { password, filename, contentType, data, content } = body

    // Also support password-based auth
    if (password) {
      requireAdmin(password)
    }

    if (!filename) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing filename.' }) }
    }
    if (!data) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing file data (base64).' }) }
    }

    // Validate filename (sanitize)
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
    const mime = contentType || guessMime(safeName)

    // Decode base64 data
    const buffer = Buffer.from(data, 'base64')

    // Upload to Discord
    const result = await uploadToDiscord(buffer, safeName, mime, content || '')

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        messageId: result.messageId,
        channelId: result.channelId,
        guildId: result.guildId,
        attachmentUrl: result.attachmentUrl,
        filename: result.filename,
        size: result.size,
        contentType: result.contentType
      })
    }
  } catch (error) {
    const status = error instanceof DiscordError ? error.status : 500
    return {
      statusCode: status,
      headers,
      body: JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : 'Discord upload failed.'
      })
    }
  }
}

function guessMime(filename) {
  const ext = filename.split('.').pop()?.toLowerCase() || ''
  const map = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    m4v: 'video/x-m4v',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    mp3: 'audio/mpeg',
    ogg: 'audio/ogg'
  }
  return map[ext] || 'application/octet-stream'
}
