/**
 * /api/discord/refresh — silent token renewal for the Discord web login.
 *
 * Discord access tokens expire after an hour. The app calls this with the
 * stored refresh token before that happens, swaps in a fresh pair and never
 * shows the login screen again. If Discord rejects the refresh token (user
 * revoked it, or it aged out) the app clears the session and asks to log in
 * once — the normal, expected OAuth behaviour.
 */

import { exchangeToken, fetchProfile, isDiscordConfigured, json, normalizeOrigin } from './_discord-oauth.mjs'

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'POST only.' })
  if (!isDiscordConfigured()) {
    return json(501, { ok: false, error: 'Discord login is not configured on this server yet.' })
  }

  let body
  try {
    body = JSON.parse(event.body || '{}')
  } catch {
    return json(400, { ok: false, error: 'Invalid JSON body.' })
  }
  const refreshToken = String(body.refreshToken || '').slice(0, 1024)
  const origin = normalizeOrigin(body.origin)
  if (!refreshToken || !origin) return json(400, { ok: false, error: 'refreshToken and origin are required.' })

  try {
    const token = await exchangeToken('refresh_token', { refresh_token: refreshToken, redirect_uri: origin })
    const profile = await fetchProfile(token.accessToken)
    return json(200, { ok: true, profile, accessToken: token.accessToken, refreshToken: token.refreshToken, expiresAt: token.expiresAt })
  } catch (error) {
    return json(error.status || 502, { ok: false, error: error instanceof Error ? error.message : 'Discord token refresh failed.' })
  }
}
