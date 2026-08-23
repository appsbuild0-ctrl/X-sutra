const ORIGIN = 'https://api.redgifs.com'
const USER_AGENT = 'Mozilla/5.0 (compatible; X-sutra/1.0; public-media-client)'

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
function allowedPath(path) {
  try {
    const url = new URL(path, ORIGIN)
    if (url.origin !== ORIGIN) return null
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
  const response = await fetch(`${ORIGIN}/v2/auth/temporary`, {
    headers: { Accept: 'application/json', 'User-Agent': USER_AGENT }
  })
  if (!response.ok) throw new Error(`Temporary token request failed (${response.status})`)
  const data = await response.json()
  if (!data?.token) throw new Error('Temporary token response was empty')
  return data.token
}

export const handler = async (event) => {
  if (event.httpMethod !== 'GET') return json(405, { error: 'Only GET requests are supported.' }, { Allow: 'GET' })

  const target = allowedPath(event.queryStringParameters?.path ?? '')
  if (!target) return json(400, { error: 'Unsupported public API path.' })

  try {
    // A fresh anonymous token is obtained in the same function invocation as
    // the API request. This keeps source-IP / user-agent token binding intact.
    const token = await temporaryToken()
    const response = await fetch(target, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        'User-Agent': USER_AGENT
      }
    })
    const body = await response.text()
    return json(response.status, body, {
      'Cache-Control': response.ok ? 'public, max-age=45, s-maxage=45' : 'no-store'
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to retrieve public media data.'
    return json(502, { error: message }, { 'Cache-Control': 'no-store' })
  }
}
