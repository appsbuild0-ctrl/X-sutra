import { MAX_REQUEST_BODY } from './config.mjs'
import { handleApiRequest } from './api.mjs'

function lowerHeaders(headers) {
  const out = {}
  for (const [key, value] of Object.entries(headers || {})) out[key.toLowerCase()] = value
  return out
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    let aborted = false
    req.on('data', (chunk) => {
      if (aborted) return
      size += chunk.length
      if (size > maxBytes) {
        aborted = true
        reject(new Error('Payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (aborted) return
      resolve(Buffer.concat(chunks))
    })
    req.on('error', (err) => {
      if (!aborted) reject(err)
    })
  })
}

function sendNode(res, response) {
  res.statusCode = response.statusCode
  for (const [key, value] of Object.entries(response.headers)) res.setHeader(key, value)
  if (response.body instanceof Buffer) res.end(response.body)
  else res.end(response.body ?? '')
}

/**
 * Connect/Express-style middleware handler for `/api/media` and `/api/admin`.
 * Used by the Vite dev server plugin and the standalone Node backend.
 */
export async function serveNode(req, res) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const method = (req.method || 'GET').toUpperCase()
  let body = null
  if (method !== 'GET' && method !== 'HEAD') {
    try {
      body = await readBody(req, MAX_REQUEST_BODY)
    } catch {
      res.statusCode = 413
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Upload exceeds the maximum allowed size.' }))
      return
    }
  }
  const normalized = {
    method,
    pathname: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers: lowerHeaders(req.headers),
    body
  }
  try {
    const response = await handleApiRequest(normalized)
    sendNode(res, response)
  } catch (error) {
    console.error('[http-adapter]', error)
    if (!res.headersSent) {
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Unexpected server error.' }))
    }
  }
}
