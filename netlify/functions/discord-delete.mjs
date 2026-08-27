/**
 * /api/discord/delete — POST
 *
 * Admin deletes a message from Discord by message ID.
 * Returns success status. Handles already-deleted messages gracefully.
 * Bot token is NEVER exposed in the response.
 */

import { deleteMessage, requireAdmin, DiscordError } from './_server/discord.mjs'

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
    const { password, messageId } = body

    // Also support password-based auth
    if (password) {
      requireAdmin(password)
    }

    if (!messageId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing messageId.' }) }
    }

    // Delete from Discord
    const result = await deleteMessage(messageId)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        messageId: result.messageId,
        channelId: result.channelId,
        alreadyDeleted: result.alreadyDeleted || false
      })
    }
  } catch (error) {
    const status = error instanceof DiscordError ? error.status : 500
    return {
      statusCode: status,
      headers,
      body: JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : 'Discord deletion failed.'
      })
    }
  }
}
