import teleproto from 'teleproto'
import { computeCheck } from 'teleproto/Password.js'
import { authState, saveAuth } from './database.mjs'
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

function normalizePhone(value) { return String(value || '').replace(/[^\d+]/g, '') }

export function telegramConfiguration() {
  const names = ['TELEGRAM_API_ID', 'TELEGRAM_API_HASH', 'TELEGRAM_PHONE', 'ADMIN_TELEGRAM_USER_ID', 'DATABASE_URL', 'ADMIN_SETUP_SECRET', 'SESSION_ENCRYPTION_KEY', 'AUTH_JWT_SECRET']
  const missing = names.filter((name) => !process.env[name]?.trim())
  return { configured: missing.length === 0, missing }
}

export async function sendOtp(requestedPhone) {
  validateTelegramEnv()
  const configuredPhone = normalizePhone(process.env.TELEGRAM_PHONE)
  if (requestedPhone && normalizePhone(requestedPhone) !== configuredPhone) throw Object.assign(new Error('This phone number is not authorized for the private source.'), { statusCode: 403 })
  // The stored MTProto session is the login. If it still authorizes, no new
  // code is sent — a one-time Telegram login must never ask for another OTP.
  const existing = await connectionStatus({ fresh: true })
  if (existing.connected) return { ok: true, status: 'already_authorized', ...(await signOwnerToken(existing.telegramUserId)) }
  const state = await authState()
  const client = await clientFrom(state?.encrypted_session)
  try {
    const sent = await client.sendCode(credentials(), configuredPhone, false)
    await saveAuth({ encrypted_session: encryptSecret(client.session.save()), phone_code_hash: sent.phoneCodeHash, status: 'otp_sent' })
    resetStatusCache()
    return { ok: true, status: 'otp_sent', delivery: sent.isCodeViaApp ? 'telegram_app' : 'phone' }
  } finally { await client.disconnect() }
}

async function finish(client, user) {
  const userId = String(user?.id || '')
  if (userId !== String(process.env.ADMIN_TELEGRAM_USER_ID)) throw Object.assign(new Error('Authorized Telegram identity is not the configured owner.'), { statusCode: 403 })
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
    const result = await client.invoke(new Api.auth.SignIn({ phoneNumber: process.env.TELEGRAM_PHONE, phoneCodeHash: state.phone_code_hash, phoneCode: String(code).trim() }))
    return await finish(client, result.user)
  } catch (error) {
    if (error?.errorMessage === 'SESSION_PASSWORD_NEEDED') { await saveAuth({ status: '2fa_required' }); return { ok: true, status: '2fa_required' } }
    throw Object.assign(new Error(error?.errorMessage === 'PHONE_CODE_INVALID' ? 'Invalid OTP.' : error?.errorMessage === 'PHONE_CODE_EXPIRED' ? 'OTP expired. Request a new code.' : 'Telegram authorization failed.'), { statusCode: 400 })
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
  } catch { throw Object.assign(new Error('Invalid Telegram 2FA password.'), { statusCode: 400 }) }
  finally { await client.disconnect() }
}
