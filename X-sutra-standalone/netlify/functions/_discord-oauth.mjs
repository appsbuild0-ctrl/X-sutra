/**
 * Shared helpers for the Discord web login (OAuth2).
 *
 * This is a real Discord account login — the user signs in on discord.com and
 * we receive an authorization code. No bot, no guild, no channel mapping.
 *
 * The client secret only ever exists in these server-side functions; the
 * browser never sees it and never talks to discord.com directly.
 */

const TOKEN_URL = 'https://discord.com/api/v10/oauth2/token'
const ME_URL = 'https://discord.com/api/v10/users/@me'
const USER_AGENT = 'X-Sutra/1.0 (Discord web login)'

export function isDiscordConfigured() {
  return Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET)
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  }
}

/**
 * The redirect target is always the caller's own origin (root path). The app
 * is hash-routed, so Discord answers `origin?code=...&state=...` and the app
 * reads the query from `window.location.search`.
 */
export function normalizeOrigin(raw) {
  try {
    const url = new URL(String(raw || ''))
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    return url.origin
  } catch {
    return ''
  }
}

/**
 * Exchange a code (or refresh token) for a fresh access token.
 * Returns { accessToken, refreshToken, expiresAt } — expiresAt is absolute ms.
 */
export async function exchangeToken(grantType, fields) {
  if (!isDiscordConfigured()) {
    const error = new Error('DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET are not configured.')
    error.status = 501
    throw error
  }
  const body = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: grantType,
    ...fields
  })
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json', 'User-Agent': USER_AGENT },
    body: body.toString()
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.access_token) {
    const error = new Error(data.error_description || data.error || `Discord token exchange failed (${response.status}).`)
    error.status = response.status >= 400 && response.status < 500 ? 401 : 502
    throw error
  }
  return {
    accessToken: String(data.access_token),
    refreshToken: data.refresh_token ? String(data.refresh_token) : null,
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000
  }
}

/** Fetch the logged-in Discord profile with a fresh access token. */
export async function fetchProfile(accessToken) {
  const response = await fetch(ME_URL, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'User-Agent': USER_AGENT }
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data.id) {
    const error = new Error(data.message || `Discord profile fetch failed (${response.status}).`)
    error.status = response.status >= 400 && response.status < 500 ? 401 : 502
    throw error
  }
  return toPublicProfile(data)
}

/** Only what the UI needs — no email, no verification flags, no tokens. */
export function toPublicProfile(me) {
  const id = String(me.id || '')
  const username = String(me.username || '')
  const globalName = me.global_name ? String(me.global_name) : ''
  const avatar = me.avatar ? String(me.avatar) : null
  const avatarUrl = avatar
    ? (avatar.startsWith('a_')
      ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.gif`
      : `https://cdn.discordapp.com/avatars/${id}/${avatar}.png`)
    : null
  return {
    id,
    username,
    globalName,
    displayName: globalName || username,
    avatar,
    avatarUrl
  }
}
