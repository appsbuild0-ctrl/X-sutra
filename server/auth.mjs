import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

export const ADMIN_COOKIE_NAME = 'xsutra_admin'

function sign(body, secret) {
  return createHmac('sha256', secret || '').update(body).digest('base64url')
}

/**
 * Constant-time check of the admin password. Returns false when no password is
 * configured (the operator must set ADMIN_PASSWORD before any upload is allowed).
 */
export function checkAdminPassword(input) {
  const expected = Buffer.from(process.env.ADMIN_PASSWORD ?? '')
  const given = Buffer.from(String(input ?? ''))
  if (expected.length === 0) return false
  if (given.length !== expected.length) {
    // Run a dummy compare so the early return is not trivially timing-distinguishable.
    timingSafeEqual(given, given)
    return false
  }
  return timingSafeEqual(given, expected)
}

export function createSessionToken(secret, ttlMs) {
  const payload = {
    sub: 'admin',
    iat: Date.now(),
    exp: Date.now() + ttlMs,
    n: randomBytes(10).toString('hex')
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = sign(body, secret)
  return `${body}.${sig}`
}

export function verifySessionToken(token, secret) {
  if (!token || !secret) return false
  const [body, sig] = String(token).split('.')
  if (!body || !sig) return false
  const expected = sign(body, secret)
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false
  let payload
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return false
  }
  if (!payload || payload.sub !== 'admin' || typeof payload.exp !== 'number') return false
  if (payload.exp < Date.now()) return false
  return true
}

export function sessionCookie(value, { maxAgeMs, clear = false } = {}) {
  const parts = [
    `${ADMIN_COOKIE_NAME}=${value}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/'
  ]
  if (process.env.NODE_ENV === 'production') parts.push('Secure')
  if (clear) parts.push('Max-Age=0')
  else parts.push(`Max-Age=${Math.max(0, Math.floor((maxAgeMs ?? 0) / 1000))}`)
  return parts.join('; ')
}

export function readCookie(req, name) {
  const header = req.headers?.cookie
  if (!header) return null
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return null
}
