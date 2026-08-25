import { createHash, randomBytes, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto'
import { jwtVerify } from 'jose'

const REQUIRED = ['ADMIN_SETUP_SECRET', 'SESSION_ENCRYPTION_KEY', 'AUTH_JWT_SECRET']

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
