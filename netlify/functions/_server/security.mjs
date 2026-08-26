import { createHash, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto'
import { jwtVerify, SignJWT } from 'jose'

// ADMIN_SETUP_SECRET is no longer required: the console does a plain OTP
// login. It is still accepted as an optional CLI bootstrap if configured.
const REQUIRED = ['SESSION_ENCRYPTION_KEY', 'AUTH_JWT_SECRET']

// Owner console session: issued once (after the Telegram login) so the admin
// never has to unlock the console or repeat the OTP again on the same device.
const OWNER_ISSUER = 'x-sutra'
const OWNER_AUDIENCE = 'x-sutra-telegram-console'
const OWNER_SCOPE = 'telegram-owner'
const OWNER_TTL_DAYS = Number(process.env.OWNER_SESSION_DAYS) > 0 ? Number(process.env.OWNER_SESSION_DAYS) : 180

export function validateSecurityEnv(extra = []) {
  const missing = [...REQUIRED, ...extra].filter((name) => !process.env[name]?.trim())
  if (missing.length) {
    const error = new Error(`Server configuration incomplete: ${missing.join(', ')}`)
    error.statusCode = 503
    throw error
  }
}

export function json(statusCode, body, headers = {}) {
  return { statusCode, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }, body: JSON.stringify(body) }
}

export function bearer(event) {
  const header = event.headers?.authorization || event.headers?.Authorization || ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

export async function requireRole(event, allowed = ['premium', 'vip', 'admin']) {
  validateSecurityEnv()
  const token = bearer(event)
  if (!token) throw Object.assign(new Error('Authentication required.'), { statusCode: 401 })
  try {
    const secret = new TextEncoder().encode(process.env.AUTH_JWT_SECRET)
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'], issuer: 'x-sutra' })
    if (!payload.sub || !allowed.includes(String(payload.role))) throw Object.assign(new Error('Premium access required.'), { statusCode: 403 })
    return { id: String(payload.sub), role: String(payload.role) }
  } catch (error) {
    if (error.statusCode) throw error
    throw Object.assign(new Error('Invalid or expired session.'), { statusCode: 401 })
  }
}

export function requireBootstrap(event) {
  validateSecurityEnv()
  const supplied = String(event.headers?.['x-admin-setup-secret'] || '')
  const expected = process.env.ADMIN_SETUP_SECRET
  const a = Buffer.from(supplied)
  const b = Buffer.from(expected)
  if (!supplied || a.length !== b.length || !timingSafeEqual(a, b)) throw Object.assign(new Error('Unauthorized.'), { statusCode: 401 })
}

/**
 * Sign a long-lived owner session token. It is returned exactly once — right
 * after a successful Telegram login (or after the first bootstrap unlock) — and
 * lets the owner console reconnect on later visits without a new OTP. Rotating
 * AUTH_JWT_SECRET invalidates every issued token.
 */
export async function signOwnerToken(telegramUserId = '') {
  validateSecurityEnv()
  const secret = new TextEncoder().encode(process.env.AUTH_JWT_SECRET)
  const issuedAt = Math.floor(Date.now() / 1000)
  const expiresAt = issuedAt + OWNER_TTL_DAYS * 86400
  const ownerToken = await new SignJWT({ role: 'admin', scope: OWNER_SCOPE, tid: String(telegramUserId) })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('telegram-owner')
    .setIssuer(OWNER_ISSUER)
    .setAudience(OWNER_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(secret)
  return { ownerToken, expiresAt: new Date(expiresAt * 1000).toISOString(), expiresInDays: OWNER_TTL_DAYS }
}

export async function verifyOwnerToken(token) {
  validateSecurityEnv()
  if (!token) throw Object.assign(new Error('Owner session required.'), { statusCode: 401 })
  try {
    const secret = new TextEncoder().encode(process.env.AUTH_JWT_SECRET)
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'], issuer: OWNER_ISSUER, audience: OWNER_AUDIENCE })
    if (payload.scope !== OWNER_SCOPE || payload.sub !== 'telegram-owner') throw new Error('scope')
    return payload
  } catch (error) {
    if (error?.statusCode) throw error
    throw Object.assign(new Error('Owner session expired. Unlock the console once more.'), { statusCode: 401 })
  }
}

/**
 * Owner gate for the Telegram console: either the bootstrap secret (very first
 * login only) or a previously issued owner session token (every later visit).
 */
export async function requireOwner(event) {
  const token = bearer(event)
  if (token) {
    const payload = await verifyOwnerToken(token)
    return { via: 'token', telegramUserId: String(payload.tid || '') }
  }
  requireBootstrap(event)
  return { via: 'secret', telegramUserId: String(process.env.ADMIN_TELEGRAM_USER_ID || '') }
}

function key() { return createHash('sha256').update(process.env.SESSION_ENCRYPTION_KEY).digest() }
export function encryptSecret(value) {
  validateSecurityEnv()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`
}
export function decryptSecret(value) {
  validateSecurityEnv()
  const [iv, tag, data] = String(value).split('.').map((part) => Buffer.from(part, 'base64url'))
  if (!iv || !tag || !data) throw new Error('Encrypted session is invalid.')
  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
}

export function safeError(error) {
  const status = Number(error?.statusCode) || 500
  const known = status >= 400 && status < 500
  return json(status, { error: known ? error.message : 'Backend operation failed.' })
}
