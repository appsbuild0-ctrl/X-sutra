const ORIGIN = 'https://api.redgifs.com'
const GRG_ORIGIN = 'https://getredgifs.com'
// Same request fingerprint as the user's previously working backend proxy:
// a plain Chrome UA plus redgifs.com Referer/Origin headers. This combination
// is what makes the API hand back clean (non-watermarked) media URLs.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
const BASE_HEADERS = {
  Accept: 'application/json',
  'User-Agent': USER_AGENT,
  Referer: 'https://www.redgifs.com/',
  Origin: 'https://www.redgifs.com'
}

// Response cache for public GETs. Warm function instances share the module
// scope, so revisits reuse successful pages for 5 minutes — and for up to 2
// hours AFTER expiry a stale copy can still answer when the upstream rate
// limit is rejecting everything (shared egress IPs hit RedGifs' per-IP 429).
const CACHE_TTL = 5 * 60 * 1000
const STALE_TTL = 2 * 60 * 60 * 1000
const cache = new Map()

// Reuse the anonymous token across warm invocations instead of asking for a
// new one per request — token calls count against the same shared-IP budget.
let cachedToken = ''
let tokenExpiry = 0

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function json(statusCode, body, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=45, s-maxage=45',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders
    },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  }
}

/** Only proxy public read endpoints required by X-sutra. */
function allowedPath(path, source) {
  try {
    const base = source === 'getredgifs' ? GRG_ORIGIN : ORIGIN
    const url = new URL(path, base)
    if (url.origin !== base) return null
    if (source === 'getredgifs') {
      // Public no-login source: only its /api read endpoints.
      return url.pathname.startsWith('/api/') ? url : null
    }
    const pathname = url.pathname
    const allowed = [
      '/v2/gifs/',
      '/v2/feeds/',
      '/v2/creators/',
      '/v2/users/',
      '/v2/niches/',
      '/v2/search/',
      '/v2/recommend/',
      '/v1/users/'
    ]
    if (!allowed.some((prefix) => pathname.startsWith(prefix))) return null
    return url
  } catch {
    return null
  }
}

async function temporaryToken(force = false) {
  if (!force && cachedToken && Date.now() < tokenExpiry) return cachedToken
  const response = await fetch(`${ORIGIN}/v2/auth/temporary`, { headers: { ...BASE_HEADERS } })
  if (!response.ok) throw new Error(`Temporary token request failed (${response.status})`)
  const data = await response.json()
  if (!data?.token) throw new Error('Temporary public token response was empty')
  cachedToken = data.token
  tokenExpiry = Date.now() + 40 * 60 * 1000
  return cachedToken
}

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Only GET requests are supported.' }, { Allow: 'GET' })

  const source = event.queryStringParameters?.src === 'getredgifs' ? 'getredgifs' : 'redgifs'
  const target = allowedPath(event.queryStringParameters?.path ?? '', source)
  if (!target) return json(400, { error: 'Unsupported public API path.' })

  const cacheKey = target.toString()
  const hit = cache.get(cacheKey)
  if (hit && Date.now() < hit.exp) return json(200, hit.body)

  // When the upstream flat-out refuses (rate limit, outage), an expired cache
  // copy is still far better than an error screen.
  const stale = () => (hit && Date.now() < hit.staleExp ? json(200, hit.body, { 'X-Cache': 'stale' }) : null)

  try {
    // Anonymous token (cached on the instance) + the same request fingerprint
    // (UA + Referer + Origin) so the API returns the clean media URLs.
    let body = ''
    let status = 0
    for (let attempt = 0; attempt <= 2; attempt++) {
      const headers = source === 'getredgifs'
        ? { Accept: 'application/json', 'User-Agent': USER_AGENT }
        : { ...BASE_HEADERS, Authorization: `Bearer ${await temporaryToken(attempt > 0 && status === 401)}` }
      const response = await fetch(target, { headers })
      status = response.status
      if (status === 429 && attempt < 2) {
        let delay = 2000 * (attempt + 1)
        try {
          const rateBody = await response.json()
          delay = Math.max(delay, Math.min((rateBody?.error?.delay ?? 2.5) * 1000, 8000))
        } catch { /* keep the default delay */ }
        await sleep(delay)
        continue
      }
      if (status === 401 && attempt < 2) {
        await sleep(400)
        continue
      }
      body = await response.text()
      break
    }
    if (status === 200) cache.set(cacheKey, { body: JSON.parse(body), exp: Date.now() + CACHE_TTL, staleExp: Date.now() + STALE_TTL })
    else {
      const fallback = stale()
      if (fallback) return fallback
    }
    return json(status, body, {
      'Cache-Control': status === 200 ? 'public, max-age=45, s-maxage=45' : 'no-store'
    })
  } catch (error) {
    const fallback = stale()
    if (fallback) return fallback
    const message = error instanceof Error ? error.message : 'Unable to retrieve public media data.'
    return json(502, { error: message }, { 'Cache-Control': 'no-store' })
  }
}
