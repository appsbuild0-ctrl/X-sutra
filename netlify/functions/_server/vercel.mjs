// Shared Vercel adapter.
//
// Every handler in netlify/functions/ speaks the Netlify event shape, and the
// Vercel entries in api/ are thin wrappers. This module holds that adapter once
// so each entry is three lines and errors are always reported with their real
// cause (the owner/admin console shows the string verbatim).

export function flattenQuery(query = {}) {
  const flat = {}
  for (const [key, value] of Object.entries(query)) flat[key] = Array.isArray(value) ? value[0] : value
  return flat
}

export async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')
  if (typeof req.body === 'string') return req.body
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) return JSON.stringify(req.body)
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

export function toNetlifyEvent(req, extra = {}) {
  return {
    httpMethod: req.method,
    headers: req.headers || {},
    queryStringParameters: flattenQuery(req.query),
    body: req._rawBody,
    isBase64Encoded: false,
    rawUrl: `https://${(req.headers && (req.headers.host || req.headers['x-forwarded-host'])) || 'local'}${req.url || '/'}`,
    ...extra
  }
}

export function send(res, result) {
  if (!result) return res.end()
  res.writeHead(result.statusCode || 200, { ...(result.headers || {}), ...(result.multiValueHeaders || {}) })
  if (result.isBase64Encoded && typeof result.body === 'string') res.end(Buffer.from(result.body, 'base64'))
  else res.end(result.body ?? '')
}

export async function runHandler(handler, req, res, { readBody = true, extra = {} } = {}) {
  try {
    if (readBody && req.method !== 'GET' && req.method !== 'HEAD') req._rawBody = await readRawBody(req)
    send(res, await handler(toNetlifyEvent(req, extra)))
  } catch (error) {
    // Never mask the real cause: the console shows this string to the user.
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: `Backend: ${error?.message || 'operation failed.'}` }))
  }
}
