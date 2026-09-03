/**
 * /api/discord/login — starts the real Discord web login.
 *
 * The browser navigates here with its own `origin` and a random `state`
 * (both generated client-side, see src/lib/discordLogin.ts). We 302 to
 * Discord's authorize page; Discord answers back at `origin?code=...&state=...`
 * and the app turns that code into a session through /api/discord/callback.
 */

import { isDiscordConfigured, normalizeOrigin } from './_discord-oauth.mjs'

// `identify` is enough to render the profile; `offline_access` is what makes
// the login persistent: it yields a refresh token so the app can renew the
// access token silently and the user is never asked to log in again.
const SCOPES = 'identify offline_access'

function notConfiguredPage() {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Discord login not set up</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #100d0e; color: #f5ecec; font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
  .box { max-width: 420px; padding: 28px; text-align: center; border: 1px solid #2c2224; border-radius: 16px; background: #171214; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { font-size: 13px; line-height: 1.6; color: #b9a9ab; margin: 0 0 16px; }
  code { color: #ffd9a0; font-size: 12px; }
  button { background: #5865f2; color: #fff; border: 0; border-radius: 10px; padding: 10px 18px; font-size: 13px; font-weight: 600; cursor: pointer; }
</style></head>
<body><div class="box">
  <h1>Discord login is not set up on this server yet</h1>
  <p>Set <code>DISCORD_CLIENT_ID</code> and <code>DISCORD_CLIENT_SECRET</code> (Discord Developer Portal → your app → OAuth2) in the hosting provider's environment and redeploy.</p>
  <button type="button" onclick="history.back()">← Go back</button>
</div></body></html>`
  return { statusCode: 501, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }, body: html }
}

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers: { 'Content-Type': 'text/plain' }, body: 'GET only.' }
  }
  if (!isDiscordConfigured()) return notConfiguredPage()

  const query = event.queryStringParameters || {}
  const origin = normalizeOrigin(query.origin)
  const state = String(query.state || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64)
  if (!origin || !state) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'origin and state are required.' }) }
  }

  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: origin,
    response_type: 'code',
    scope: SCOPES,
    state
  })
  return {
    statusCode: 302,
    headers: { Location: `https://discord.com/oauth2/authorize?${params.toString()}`, 'Cache-Control': 'no-store' },
    body: ''
  }
}
