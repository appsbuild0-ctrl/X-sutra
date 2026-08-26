// /api/internal/telegram-auth — Vercel filesystem route.
// Plain Vercel Functions do not route multi-segment paths to the [...path]
// catch-all, so this dedicated function serves the nested endpoint directly.
// Handler stays shared with Netlify (netlify/functions/telegram-admin.mjs).
import { handler as telegramAdmin } from '../../netlify/functions/telegram-admin.mjs'

async function readRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body.toString('utf8')
  if (typeof req.body === 'string') return req.body
  if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) return JSON.stringify(req.body)
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function toNetlifyEvent(req) {
  return {
    httpMethod: req.method,
    headers: req.headers || {},
    queryStringParameters: {},
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

export default async function vercelTelegramAuth(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') req._rawBody = await readRawBody(req)
    send(res, await telegramAdmin(toNetlifyEvent(req)))
  } catch {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'Backend operation failed.' }))
  }
}
