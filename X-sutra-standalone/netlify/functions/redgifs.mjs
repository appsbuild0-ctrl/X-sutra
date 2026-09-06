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

// Short-lived cache for public GET responses. Warm function instances share
// the module scope, so revisits/retries reuse successful pages for 5 minutes.
const CACHE_TTL = 5 * 60 * 1000
const cache = new Map()

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

async function temporaryToken() {
  const response = await fetch(`${ORIGIN}/v2/auth/temporary`, { headers: { ...BASE_HEADERS } })
  if (!response.ok) throw new Error(`Temporary token request failed (${response.status})`)
  const data = await response.json()
  if (!data?.token) throw new Error('Temporary public token response was empty')
  return data.token
}

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Only GET requests are supported.' }, { Allow: 'GET' })

  const source = event.queryStringParameters?.src === 'getredgifs' ? 'getredgifs' : 'redgifs'
  const target = allowedPath(event.queryStringParameters?.path ?? '', source)
  if (!target) return json(400, { error: 'Unsupported public API path.' })

  const cacheKey = target.toString()
  const hit = cache.get(cacheKey)
  if (hit && Date.now() < hit.exp) return json(200, hit.body)

  try {
    // A fresh anonymous token is obtained in the same function invocation as
    // the API request, with the same request fingerprint (UA + Referer +
    // Origin) so the API returns the clean media URLs.
    let body = ''
    let status = 0
    for (let attempt = 0; attempt <= 2; attempt++) {
      const headers = source === 'getredgifs'
        ? { Accept: 'application/json', 'User-Agent': USER_AGENT }
        : { ...BASE_HEADERS, Authorization: `Bearer ${await temporaryToken()}` }
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
      body = await response.text()
      break
    }
    if (status === 200) cache.set(cacheKey, { body: JSON.parse(body), exp: Date.now() + CACHE_TTL })
    return json(status, body, {
      'Cache-Control': status === 200 ? 'public, max-age=45, s-maxage=45' : 'no-store'
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to retrieve public media data.'
    return json(502, { error: message }, { 'Cache-Control': 'no-store' })
  }
}
