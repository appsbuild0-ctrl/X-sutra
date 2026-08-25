import teleproto from 'teleproto'
import { computeCheck } from 'teleproto/Password.js'
import { authState, saveAuth } from './database.mjs'
import { decryptSecret, encryptSecret, validateSecurityEnv } from './security.mjs'

const { TelegramClient, Api, sessions: { StringSession } } = teleproto
const credentials = () => ({ apiId: Number(process.env.TELEGRAM_API_ID), apiHash: process.env.TELEGRAM_API_HASH })

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

export async function connectionStatus() {
  const state = await authState()
  if (!state?.encrypted_session || state.status !== 'authorized') return { connected: false, status: state?.status || 'not_configured' }
  const client = await clientFrom(state.encrypted_session)
  try { return { connected: await client.isUserAuthorized(), status: state.status } } finally { await client.disconnect() }
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
  if (normalizePhone(requestedPhone) !== configuredPhone) throw Object.assign(new Error('This phone number is not authorized for the private source.'), { statusCode: 403 })
  const state = await authState()
  const client = await clientFrom(state?.encrypted_session)
  try {
    const sent = await client.sendCode(credentials(), configuredPhone, false)
    await saveAuth({ encrypted_session: encryptSecret(client.session.save()), phone_code_hash: sent.phoneCodeHash, status: 'otp_sent' })
    return { ok: true, status: 'otp_sent', delivery: sent.isCodeViaApp ? 'telegram_app' : 'phone' }
  } finally { await client.disconnect() }
}

async function finish(client, user) {
  const userId = String(user?.id || '')
  if (userId !== String(process.env.ADMIN_TELEGRAM_USER_ID)) throw Object.assign(new Error('Authorized Telegram identity is not the configured owner.'), { statusCode: 403 })
  await saveAuth({ encrypted_session: encryptSecret(client.session.save()), phone_code_hash: null, status: 'authorized', telegram_user_id: userId })
  return { ok: true, status: 'authorized' }
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
