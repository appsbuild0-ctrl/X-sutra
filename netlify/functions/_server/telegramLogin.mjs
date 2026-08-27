// Telegram Login Widget verification — the official web login flow described at
// https://core.telegram.org/widgets/login
//
// The widget (telegram.org/js/telegram-widget.js) posts the logged-in user's
// public fields plus a `hash`. That hash is HMAC-SHA256 over the sorted
// `key=value` fields, keyed with SHA-256(bot_token). Recomputing it here is what
// proves the payload really came from Telegram:
//
//   * the bot token never leaves the server (only TELEGRAM_BOT_TOKEN env),
//   * no MTProto session, API_ID, API_HASH, OTP or password is ever involved,
//   * a client cannot forge or reuse somebody else's Telegram id, because it
//     cannot produce a valid hash without the token.
//
// Everything in this module is pure (no database, no network) except
// getBotUsername(), which asks the Bot API for the public @username the widget
// needs — so no extra environment variable has to be invented for it.

import { createHmac, createHash, timingSafeEqual } from 'node:crypto'

const WIDGET_FIELDS = ['id', 'first_name', 'last_name', 'username', 'photo_url', 'auth_date', 'hash']

export function botToken() {
  const token = String(process.env.TELEGRAM_BOT_TOKEN || '').trim()
  if (!token) throw Object.assign(new Error('TELEGRAM_BOT_TOKEN is not set on the server — create a bot with @BotFather and add the token in Vercel.'), { statusCode: 503 })
  return token
}

/**
 * Recompute the widget hash. Exported because the test suite uses it to build a
 * genuinely valid payload (and an invalid one) for the real handler.
 */
export function computeTelegramHash(fields, token = botToken()) {
  const secret = createHash('sha256').update(token, 'utf8').digest()
  const dataCheckString = Object.keys(fields)
    .filter((key) => key !== 'hash')
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join('\n')
  return createHmac('sha256', secret).update(dataCheckString, 'utf8').digest('hex')
}

const fail = (message, statusCode = 401) => Object.assign(new Error(message), { statusCode })

/**
 * Verify a widget payload. Returns the verified Telegram identity — the caller
 * must use THIS id (never a client-supplied one) as the user identifier.
 */
export function verifyTelegramWidgetAuth(payload, { token = botToken(), maxAgeSeconds = Number(process.env.TELEGRAM_AUTH_MAX_AGE) > 0 ? Number(process.env.TELEGRAM_AUTH_MAX_AGE) : 3600, now = Date.now() } = {}) {
  if (!payload || typeof payload !== 'object') throw fail('Telegram login payload is missing.')
  const supplied = String(payload.hash || '').trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(supplied)) throw fail('Telegram login payload has no valid hash.')

  const id = String(payload.id ?? '').trim()
  if (!/^\d{1,20}$/.test(id)) throw fail('Telegram login payload has no numeric user id.')

  const authDate = Number(payload.auth_date)
  if (!Number.isFinite(authDate) || authDate <= 0) throw fail('Telegram login payload has no auth_date.')
  const ageSeconds = Math.floor(now / 1000) - authDate
  if (ageSeconds < -60) throw fail('Telegram login timestamp is in the future.')
  if (ageSeconds > maxAgeSeconds) throw fail(`Telegram login is older than ${maxAgeSeconds}s — sign in again. (auth_date age: ${ageSeconds}s)`)

  // Only the documented widget fields take part in the signature; anything else
  // a client adds is ignored rather than trusted. Optional fields (username,
  // photo_url, last_name) are omitted by the widget when they do not exist, so
  // an empty value is treated the same way here — that is what keeps the
  // recomputed data-check-string identical to Telegram's.
  const fields = {}
  for (const key of WIDGET_FIELDS) {
    if (key === 'hash') continue
    const value = payload[key]
    if (value === undefined || value === null || value === '') continue
    fields[key] = String(value)
  }

  const expected = computeTelegramHash(fields, token)
  const a = Buffer.from(expected, 'hex')
  const b = Buffer.from(supplied, 'hex')
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw fail('Telegram hash mismatch — the login was not signed by Telegram for this bot.', 401)
  }

  return {
    id,
    firstName: String(payload.first_name || '').slice(0, 64),
    lastName: String(payload.last_name || '').slice(0, 64),
    username: String(payload.username || '').replace(/^@/, '').slice(0, 32),
    photoUrl: /^https:\/\/t\.me\/|^https:\/\/telegram\.org\//.test(String(payload.photo_url || '')) ? String(payload.photo_url).slice(0, 512) : '',
    authDate
  }
}

// ---------------------------------------------------------------------------
// The widget needs the bot's public @username. Reading it from the Bot API
// keeps TELEGRAM_BOT_USERNAME out of the environment list — the token already
// identifies the bot, and getMe is the documented way to ask for its name.
// ---------------------------------------------------------------------------

const USERNAME_TTL_MS = 10 * 60 * 1000
let botInfoCache = { at: 0, username: '', firstName: '' }

export function resetBotInfoCache() { botInfoCache = { at: 0, username: '', firstName: '' } }

export async function getBotInfo({ fetchImpl = fetch } = {}) {
  if (botInfoCache.username && Date.now() - botInfoCache.at < USERNAME_TTL_MS) return botInfoCache
  const token = botToken()
  let response
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${token}/getMe`)
  } catch (error) {
    throw Object.assign(new Error(`Telegram Bot API is unreachable (${error?.message || 'network error'}). Check TELEGRAM_BOT_TOKEN and outbound access.`), { statusCode: 502 })
  }
  const data = await response.json().catch(() => ({}))
  if (!response.ok || !data?.ok || !data?.result?.username) {
    // The Bot API states the reason (401 Unauthorized = wrong token); pass it on.
    throw Object.assign(new Error(`Telegram rejected TELEGRAM_BOT_TOKEN: ${data?.description || `HTTP ${response.status}`}`), { statusCode: 502 })
  }
  botInfoCache = { at: Date.now(), username: String(data.result.username), firstName: String(data.result.first_name || '') }
  return botInfoCache
}

/** Public, non-secret widget configuration for the login screen. */
export async function telegramLoginConfiguration(deps = {}) {
  try {
    const info = await getBotInfo(deps)
    return { enabled: true, botUsername: info.username, botName: info.firstName || info.username }
  } catch (error) {
    return { enabled: false, botUsername: '', botName: '', error: String(error?.message || 'Telegram login is unavailable.') }
  }
}
