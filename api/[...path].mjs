// X-sutra Vercel backend — single catch-all function.
// Handlers from netlify/functions/ (same code Netlify + Vercel both use).
import { handler as redgifs } from '../netlify/functions/redgifs.mjs'
import { handler as media } from '../netlify/functions/media.mjs'
import { handler as premium } from '../netlify/functions/premium.mjs'
import { handler as premiumScan } from '../netlify/functions/premium-scan.mjs'
import { handler as premiumFile } from '../netlify/functions/premium-file.mjs'
import { handler as hotpic } from '../netlify/functions/hotpic.mjs'
import { handler as discordLogin } from '../netlify/functions/discord-login.mjs'
import { handler as discordCallback } from '../netlify/functions/discord-callback.mjs'
import { handler as discordRefresh } from '../netlify/functions/discord-refresh.mjs'

const ROUTES = new Map([
  ['/api/redgifs', redgifs],
  ['/api/media', media],
  ['/api/premium', premium],
  ['/api/premium-scan', premiumScan],
  ['/api/premium-file', premiumFile],
  ['/api/hotpic', hotpic],
  ['/api/discord/login', discordLogin],
  ['/api/discord/callback', discordCallback],
  ['/api/discord/refresh', discordRefresh],
])

const HOTPIC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function flattenQuery(query = {}) {
  const flat = {}
  for (const [key, value] of Object.entries(query)) flat[key] = Array.isArray(value) ? value[0] : value
  return flat
}

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

async function proxyHotpicHtml(suffix, res) {
  try {
    const response = await fetch('https://hotpic.vip' + suffix, {
      headers: { Accept: 'text/html,application/xhtml+xml,*/*', 'User-Agent': HOTPIC_UA, Referer: 'https://hotpic.vip/' },
      redirect: 'follow'
    })
    res.writeHead(response.status, {
      'content-type': response.headers.get('content-type') || 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=60'
    })
    res.end(Buffer.from(await response.arrayBuffer()))
  } catch {
    res.writeHead(502, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'Hotpic proxy failed.' }))
  }
}

export default async function vercelCatchAll(req, res) {
  const url = req.url || '/'
  const path = url.split('?')[0].replace(/\/+$/, '') || '/'
  if (path.startsWith('/api/hotpic-html/')) return proxyHotpicHtml(url.slice('/api/hotpic-html'.length), res)
  const handler = ROUTES.get(path)
  if (!handler) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    return res.end(JSON.stringify({ error: 'Unknown API endpoint.' }))
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') req._rawBody = await readRawBody(req)
  send(res, await handler(toNetlifyEvent(req)))
}
