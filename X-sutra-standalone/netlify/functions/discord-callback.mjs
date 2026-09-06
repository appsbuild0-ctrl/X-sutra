/**
 * /api/discord/callback — finishes the Discord web login.
 *
 * The app POSTs the `code` from Discord's redirect (plus the origin it sent
 * the user from). We exchange the code for an access token and read the
 * profile, then hand both back. The app stores them and the user stays
 * logged in — no login screen on the next visit.
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
  const code = String(body.code || '').slice(0, 512)
  const origin = normalizeOrigin(body.origin)
  if (!code || !origin) return json(400, { ok: false, error: 'code and origin are required.' })

  try {
    const token = await exchangeToken('authorization_code', { code, redirect_uri: origin })
    const profile = await fetchProfile(token.accessToken)
    return json(200, { ok: true, profile, accessToken: token.accessToken, refreshToken: token.refreshToken, expiresAt: token.expiresAt })
  } catch (error) {
    return json(error.status || 502, { ok: false, error: error instanceof Error ? error.message : 'Discord login failed.' })
  }
}
