import teleproto from 'teleproto'
import { computeCheck } from 'teleproto/Password.js'
import { authState, saveAuth, upsertChannels } from './database.mjs'
import { decryptSecret, encryptSecret, signOwnerToken, validateSecurityEnv } from './security.mjs'

const { TelegramClient, Api, sessions: { StringSession } } = teleproto
const credentials = () => ({ apiId: Number(process.env.TELEGRAM_API_ID), apiHash: process.env.TELEGRAM_API_HASH })

// Status is cached per container so opening the console does not open a fresh
// MTProto connection every time, and so a transient network failure cannot look
// like "logged out — please login again".
const STATUS_TTL_MS = 5 * 60 * 1000
let statusCache = { at: 0, value: null }
export function resetStatusCache() { statusCache = { at: 0, value: null } }

function validateTelegramEnv() {
  validateSecurityEnv(['TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_PHONE', 'ADMIN_TELEGRAM_USER_ID', 'DATABASE_URL'])
  if (!Number.isSafeInteger(Number(process.env.TELEGRAM_API_ID))) throw Object.assign(new Error('TELEGRAM_API_ID is invalid.'), { statusCode: 503 })
}

async function clientFrom(encrypted = '') {
  validateTelegramEnv()
  const session = new StringSession(encrypted ? decryptSecret(encrypted) : '')
  const client = new TelegramClient(session, credentials().apiId, credentials().apiHash, { connectionRetries: 3, autoReconnect: false })
  await client.connect()
  return client
}

/**
 * Telegram rotates auth keys during a live session. Writing the refreshed
 * session string back is what keeps the one-time login valid for months;
 * without it the stored copy goes stale and the owner is asked to log in again.
 */
async function persistSession(client) {
  await saveAuth({ encrypted_session: encryptSecret(client.session.save()) })
}

export async function connectionStatus({ fresh = false } = {}) {
  if (!fresh && statusCache.value && Date.now() - statusCache.at < STATUS_TTL_MS) return statusCache.value
  const state = await authState()
  if (!state?.encrypted_session || state.status !== 'authorized') {
    const value = { connected: false, status: state?.status || 'not_configured', telegramUserId: state?.telegram_user_id || '', authorizedAt: state?.updated_at || null }
    statusCache = { at: Date.now(), value }
    return value
  }
  try {
    const client = await clientFrom(state.encrypted_session)
    try {
      const connected = await client.isUserAuthorized()
      if (connected) await persistSession(client)
      const value = { connected, status: state.status, telegramUserId: state.telegram_user_id || '', authorizedAt: state.updated_at || null }
      statusCache = { at: Date.now(), value }
      return value
    } finally { await client.disconnect() }
  } catch {
    // Keep the last known good answer instead of forcing a re-login on a blip.
    if (statusCache.value?.connected) return statusCache.value
    return { connected: false, status: 'check_failed', telegramUserId: state.telegram_user_id || '', authorizedAt: state.updated_at || null }
  }
}

/**
 * Telegram RPC errors carry the real reason in `errorMessage`
 * (PHONE_CODE_INVALID, FLOOD_WAIT_X, …). Reporting it verbatim is the whole
 * point: "Telegram authorization failed." gives the owner nothing to act on.
 */
const TELEGRAM_ERROR_HINTS = {
  PHONE_CODE_INVALID: 'the code was rejected — retype it from your Telegram app',
  PHONE_CODE_EMPTY: 'the code reached Telegram empty',
  PHONE_CODE_EXPIRED: 'the code expired — request a new one',
  PHONE_CODE_HASH_EMPTY: 'the code hash is missing — request a new code',
  PHONE_NUMBER_INVALID: 'TELEGRAM_PHONE on the server is not a number Telegram accepts',
  PHONE_NUMBER_UNOCCUPIED: 'no Telegram account is registered on TELEGRAM_PHONE',
  PHONE_NUMBER_BANNED: 'Telegram has banned this phone number',
  PHONE_NUMBER_OCCUPIED: 'this phone number is already registered elsewhere',
  PASSWORD_HASH_INVALID: 'the 2FA password is wrong',
  SESSION_PASSWORD_NEEDED: 'this account needs its 2FA password',
  SESSION_REVOKED: 'Telegram revoked this login session',
  AUTH_KEY_UNREGISTERED: 'the stored session key is no longer registered on Telegram',
  AUTH_KEY_DUPLICATED: 'Telegram rejected a duplicated session key',
  USER_DEACTIVATED: 'this Telegram account is deactivated',
  USER_DEACTIVATED_BAN: 'this Telegram account is deactivated or banned',
  USER_PRIVACY_RESTRICTED: 'Telegram privacy settings blocked this login'
}

function telegramFailure(error, fallback = 'Telegram authorization failed') {
  const code = String(error?.errorMessage || error?.errorCode || '').trim()
  // Our own typed errors (missing config → 503, owner mismatch → 403) are
  // already actionable — pass them through untouched.
  if (!code && error?.statusCode) return error
  const detail = code || String(error?.message || '').trim()
  const hint = TELEGRAM_ERROR_HINTS[code]
  const message = detail
    ? hint
      ? `${fallback}: ${detail} — ${hint}.`
      : `${fallback}: ${detail}.`
    : `${fallback} (Telegram returned no error detail).`
  return Object.assign(new Error(message), { statusCode: Number(error?.statusCode) || 400, telegramError: detail })
}

function normalizePhone(value) { return String(value || '').replace(/[^\d+]/g, '') }

/**
 * The owner phone is server configuration only — the browser never supplies it,
 * so there is no way to aim a login code at somebody else's account.
 */
function configuredPhone() {
  const phone = normalizePhone(process.env.TELEGRAM_PHONE)
  if (!phone) throw Object.assign(new Error('TELEGRAM_PHONE is not set on the server — add the owner phone number in the Vercel/Netlify environment variables.'), { statusCode: 503 })
  return phone
}

/** Partial phone for display: "+91••••••21". Never the full number. */
export function maskPhone(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const digits = raw.replace(/\D/g, '')
  if (digits.length <= 4) return `${raw.charAt(0)}•••${digits.slice(-1)}`
  const head = raw.startsWith('+') ? `+${digits.slice(0, 2)}` : digits.slice(0, 2)
  return `${head}${'•'.repeat(Math.max(4, digits.length - 4))}${digits.slice(-2)}`
}

export function telegramConfiguration() {
  const names = ['TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_PHONE', 'ADMIN_TELEGRAM_USER_ID', 'DATABASE_URL', 'SESSION_ENCRYPTION_KEY', 'AUTH_JWT_SECRET']
  const missing = names.filter((name) => !process.env[name]?.trim())
  return { configured: missing.length === 0, missing, phoneHint: maskPhone(process.env.TELEGRAM_PHONE) }
}

export async function sendOtp() {
  validateTelegramEnv()
  const phone = configuredPhone()
  // The stored MTProto session is the login. If it still authorizes, no new
  // code is sent — a one-time Telegram login must never ask for another OTP.
  const existing = await connectionStatus({ fresh: true })
  if (existing.connected) return { ok: true, status: 'already_authorized', ...(await signOwnerToken(existing.telegramUserId)) }
  const state = await authState()
  let client
  try {
    client = await clientFrom(state?.encrypted_session)
  } catch (error) {
    // If SESSION_ENCRYPTION_KEY was changed, the old database session cannot
    // be decrypted. Do not block the owner from logging in again: discard only
    // the unusable encrypted session and start a clean Telegram session.
    if (!state?.encrypted_session) throw telegramFailure(error)
    await saveAuth({ encrypted_session: encryptSecret(''), phone_code_hash: null, status: 'pending', telegram_user_id: null })
    resetStatusCache()
    client = await clientFrom('')
  }
  try {
    const sent = await client.sendCode(credentials(), phone, false)
    await saveAuth({ encrypted_session: encryptSecret(client.session.save()), phone_code_hash: sent.phoneCodeHash, status: 'otp_sent' })
    resetStatusCache()
    return { ok: true, status: 'otp_sent', delivery: sent.isCodeViaApp ? 'telegram_app' : 'phone', phoneHint: maskPhone(phone) }
  } catch (error) {
    throw telegramFailure(error)
  } finally { await client.disconnect() }
}

async function finish(client, user) {
  const userId = String(user?.id || '')
  if (userId !== String(process.env.ADMIN_TELEGRAM_USER_ID)) throw Object.assign(new Error(`Authorized Telegram identity is not the configured owner (Telegram user ${userId || 'unknown'} ≠ ADMIN_TELEGRAM_USER_ID ${process.env.ADMIN_TELEGRAM_USER_ID || 'not set'}).`), { statusCode: 403 })
  await saveAuth({ encrypted_session: encryptSecret(client.session.save()), phone_code_hash: null, status: 'authorized', telegram_user_id: userId })
  resetStatusCache()
  // Hand back the owner session token once: this device stays logged in.
  return { ok: true, status: 'authorized', ...(await signOwnerToken(userId)) }
}

export async function verifyOtp(code) {
  const state = await authState()
  if (!state?.encrypted_session || !state.phone_code_hash) throw Object.assign(new Error('Request a new OTP first.'), { statusCode: 409 })
  const client = await clientFrom(state.encrypted_session)
  try {
    const result = await client.invoke(new Api.auth.SignIn({ phoneNumber: configuredPhone(), phoneCodeHash: state.phone_code_hash, phoneCode: String(code).trim() }))
    return await finish(client, result.user)
  } catch (error) {
    if (error?.errorMessage === 'SESSION_PASSWORD_NEEDED') { await saveAuth({ status: '2fa_required' }); return { ok: true, status: '2fa_required' } }
    // Our own errors (owner mismatch → 403, config → 503) keep their status and
    // message; anything coming back from Telegram is reported verbatim.
    if (error?.statusCode) throw error
    throw telegramFailure(error)
  } finally { await client.disconnect() }
}

export async function verifyTwoFactor(password) {
  const state = await authState()
  if (!state?.encrypted_session || state.status !== '2fa_required') throw Object.assign(new Error('2FA is not pending.'), { statusCode: 409 })
  const client = await clientFrom(state.encrypted_session)
  try {
    const pwd = await client.invoke(new Api.account.GetPassword())
    const check = await computeCheck(pwd, String(password))
    const result = await client.invoke(new Api.auth.CheckPassword({ password: check }))
    return await finish(client, result.user)
  } catch (error) {
    if (error?.statusCode) throw error
    throw telegramFailure(error, 'Telegram 2FA check failed')
  } finally { await client.disconnect() }
}

// ---------------------------------------------------------------------------
// Channel discovery: turn the owner's Telegram dialogs into source rows.
// ---------------------------------------------------------------------------

// One sync reads the dialog list plus one history probe per channel, so the
// cap keeps a single serverless request well inside its time budget.
const MAX_SYNC_CHANNELS = 60

const entityId = (entity) => {
  const raw = entity?.id
  if (raw === null || raw === undefined) return ''
  return typeof raw?.toString === 'function' ? String(raw.toString()) : String(raw)
}

/**
 * Map Telegram dialogs to channel rows.
 *
 * Pure and exported on purpose: the filtering rules (skip private chats and
 * legacy basic groups, keep broadcast channels and supergroups, dedupe, cap)
 * can be tested with plain objects instead of a live MTProto connection.
 */
export function pickChannelRows(dialogs, limit = MAX_SYNC_CHANNELS) {
  const rows = []
  const seen = new Set()
  for (const dialog of Array.isArray(dialogs) ? dialogs : []) {
    const entity = dialog?.entity
    // Only Api.Channel carries a browsable source: broadcast channels and
    // supergroups. 'User' (private chat) and 'Chat' (basic group) are skipped.
    if (entity?.className !== 'Channel') continue
    const id = entityId(entity)
    if (!id || seen.has(id)) continue
    const title = String(dialog?.name || dialog?.title || entity?.title || 'Untitled source').trim().slice(0, 120) || 'Untitled source'
    seen.add(id)
    rows.push({ id, title, avatar: null, category: entity?.megagroup ? 'group' : 'channel' })
    if (rows.length >= limit) break
  }
  return rows
}

/**
 * Fill `xs_channels` from the owner's Telegram dialogs. Nothing else in the
 * backend writes that table, so without this the Premium "Telegram sources"
 * list can only ever be empty.
 *
 * `createClient` / `save` / `readState` / `persist` are injectable so the whole
 * flow is testable without Telegram or PostgreSQL (scripts/verify-channel-sync.mjs).
 */
export async function syncChannels({ createClient = clientFrom, save = upsertChannels, readState = authState, persist = persistSession } = {}) {
  const state = await readState()
  if (!state?.encrypted_session || state.status !== 'authorized') {
    throw Object.assign(new Error('Log in to Telegram first — the source list is read with the saved owner session.'), { statusCode: 409 })
  }
  const client = await createClient(state.encrypted_session)
  try {
    if (!(await client.isUserAuthorized())) {
      throw Object.assign(new Error('The saved Telegram session is no longer authorized. Log in again.'), { statusCode: 409 })
    }
    const dialogs = await client.getDialogs({})
    const rows = pickChannelRows(dialogs)
    const saved = await save(rows)
    // Telegram rotates auth keys during use; writing the session back keeps the
    // one-time login valid (same reason the OTP flow does it).
    await persist(client)
    resetStatusCache()
    return { ok: true, status: 'synced', scanned: Array.isArray(dialogs) ? dialogs.length : 0, channels: rows.length, saved }
  } finally {
    await client.disconnect()
  }
}
