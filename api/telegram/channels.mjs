// /api/telegram/channels — Vercel filesystem route.
// Plain Vercel Functions do not route multi-segment paths to the [...path]
// catch-all, so this dedicated function serves the nested endpoint directly.
// Handler stays shared with Netlify (netlify/functions/telegram-channels.mjs).
import { handler as telegramChannels } from '../../netlify/functions/telegram-channels.mjs'

function flattenQuery(query = {}) {
  const flat = {}
  for (const [key, value] of Object.entries(query)) flat[key] = Array.isArray(value) ? value[0] : value
  return flat
}

function toNetlifyEvent(req) {
  return {
    httpMethod: req.method,
    headers: req.headers || {},
    queryStringParameters: flattenQuery(req.query),
    body: req._rawBody,
    isBase64Encoded: false
  }
}

function send(res, result) {
  if (!result) return res.end()
  res.writeHead(result.statusCode || 200, { ...(result.headers || {}), ...(result.multiValueHeaders || {}) })
  if (result.isBase64Encoded && typeof result.body === 'string') res.end(Buffer.from(result.body, 'base64'))
  else res.end(result.body ?? '')
}

export default async function vercelTelegramChannels(req, res) {
  try {
    send(res, await telegramChannels(toNetlifyEvent(req)))
  } catch (error) {
    // Never mask the real cause: the console shows this string to the owner.
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: `Backend: ${error?.message || 'operation failed.'}` }))
  }
}
