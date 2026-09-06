/**
 * /api/discord/health — GET
 *
 * Returns Discord bot connection health status.
 * Bot token is NEVER exposed in the response.
 */

import { healthCheck, requireAdmin } from './_server/discord.mjs'

export const handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed.' }) }
  }

  try {
    // Optional: require admin auth for health check
    const authHeader = event.headers?.authorization || ''
    const token = authHeader.replace(/^Bearer\s+/i, '').trim()
    if (token) {
      try {
        requireAdmin(token)
      } catch {
        // Health check is read-only; allow unauthenticated access
      }
    }

    const status = await healthCheck()
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(status)
    }
  } catch (error) {
    return {
      statusCode: error.status || 500,
      headers,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Health check failed.',
        overall: 'error'
      })
    }
  }
}
