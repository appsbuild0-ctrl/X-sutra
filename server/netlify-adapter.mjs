import { MAX_REQUEST_BODY } from './config.mjs'
import { handleApiRequest } from './api.mjs'

function lowerHeaders(headers) {
  const out = {}
  for (const [key, value] of Object.entries(headers || {})) out[key.toLowerCase()] = value
  return out
}

/**
 * Netlify Functions handler. Deploy `netlify/functions/media.mjs` and add
 * redirects from /api/media and /api/admin to it. The original path is preserved
 * by the rewrite so routing works unchanged.
 */
export async function handler(event) {
  const method = (event.httpMethod || 'GET').toUpperCase()
  const pathname = event.path || '/'
  const query = event.queryStringParameters || {}
  const headers = lowerHeaders(event.headers || {})
  let body = null
  if (event.body && method !== 'GET' && method !== 'HEAD') {
    const raw = Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8')
    if (raw.length > MAX_REQUEST_BODY) {
      return {
        statusCode: 413,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Upload exceeds the maximum allowed size.' })
      }
    }
    body = raw
  }

  try {
    const response = await handleApiRequest({ method, pathname, query, headers, body })
    return {
      statusCode: response.statusCode,
      headers: response.headers,
      body: response.body instanceof Buffer ? response.body.toString('base64') : (response.body ?? ''),
      isBase64Encoded: response.body instanceof Buffer
    }
  } catch (error) {
    console.error('[netlify-adapter]', error)
    return {
      statusCode: 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Unexpected server error.' })
    }
  }
}
