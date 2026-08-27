// Shared security helpers for the X-Sutra backend.
//
// Telegram is gone. What remains: environment validation, JSON responses, exact
// error reporting, and the JWT role check used by the Premium API.

import { jwtVerify } from 'jose'

const REQUIRED = ['AUTH_JWT_SECRET']

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

/** Premium role gate (unchanged from the existing Premium API). */
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

/**
 * Report the real cause instead of a generic message: 4xx passes through
 * verbatim, 5xx is prefixed so a server fault is unmistakable. Never includes
 * secrets or stack traces.
 */
export function errorResponse(error) {
  const status = Number(error?.statusCode)
  if (status === 429 || status === 503) return json(status, { error: error.message })
  if (status >= 500 || !status) return json(500, { error: `Backend: ${error?.message || 'operation failed.'}` })
  return json(status, { error: error?.message || 'Backend operation failed.' })
}
