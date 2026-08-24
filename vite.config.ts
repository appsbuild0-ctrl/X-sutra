import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const ORIGIN = 'https://api.redgifs.com'
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
// Same fingerprint as the working backend proxy: redgifs.com Referer/Origin
// is what returns clean (non-watermarked) media URLs from the API.
const BASE_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  'User-Agent': USER_AGENT,
  Referer: 'https://www.redgifs.com/',
  Origin: 'https://www.redgifs.com'
}

function allowedTarget(rawPath: string): URL | null {
  try {
    const url = new URL(rawPath, ORIGIN)
    if (url.origin !== ORIGIN) return null
    const allowed = ['/v2/gifs/', '/v2/feeds/', '/v2/creators/', '/v2/users/', '/v2/niches/', '/v2/search/', '/v2/recommend/', '/v1/users/']
    return allowed.some((prefix) => url.pathname.startsWith(prefix)) ? url : null
  } catch {
    return null
  }
}

async function servePublicMedia(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const requestUrl = new URL(req.url ?? '/', 'http://localhost')
  // Development supports both the function-style ?path= URL and the static
  // Netlify Drop rewrite URL (/api/redgifs/v2/...).
  const target = allowedTarget(requestUrl.searchParams.get('path') ?? requestUrl.pathname)
  if (!target) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: 'Unsupported public API path.' }))
    return
  }

  try {
    const tokenResponse = await fetch(`${ORIGIN}/v2/auth/temporary`, { headers: { ...BASE_HEADERS } })
    if (!tokenResponse.ok) throw new Error(`Temporary token request failed (${tokenResponse.status})`)
    const { token } = await tokenResponse.json() as { token?: string }
    if (!token) throw new Error('Temporary token response was empty')

    const apiResponse = await fetch(target, {
      headers: { ...BASE_HEADERS, Authorization: `Bearer ${token}` }
    })
    const body = await apiResponse.text()
    res.statusCode = apiResponse.status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', apiResponse.ok ? 'public, max-age=45' : 'no-store')
    res.end(body)
  } catch (error) {
    res.statusCode = 502
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Unable to retrieve public media data.' }))
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function premiumDevApi(): Plugin {
  return {
    name: 'x-sutra-premium-dev-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const path = req.url?.split('?')[0] ?? ''
        if (path !== '/api/premium' && path !== '/api/premium-scan' && path !== '/api/premium-file') return next()
        process.env.PREMIUM_LOCAL_FILE ||= '.premium-data.json'
        process.env.PREMIUM_MEDIA_DIR ||= '.premium-media'
        try {
          const body = req.method === 'POST' ? await readBody(req) : ''
          const requestUrl = new URL(req.url ?? '/', 'http://localhost')
          const event = { httpMethod: req.method, body, headers: req.headers, queryStringParameters: Object.fromEntries(requestUrl.searchParams), rawUrl: requestUrl.href }
          const handlerPath = path === '/api/premium-scan' ? './netlify/functions/premium-scan.mjs' : path === '/api/premium-file' ? './netlify/functions/premium-file.mjs' : './netlify/functions/premium.mjs'
          const mod = await import(/* @vite-ignore */ handlerPath) as { handler: (event: unknown) => Promise<{ statusCode: number; body?: string; headers?: Record<string, string>; isBase64Encoded?: boolean }> }
          const result = await mod.handler(event)
          res.statusCode = result.statusCode
          for (const [key, value] of Object.entries(result.headers ?? { 'Content-Type': 'application/json; charset=utf-8' })) res.setHeader(key, value)
          res.end(result.isBase64Encoded && result.body ? Buffer.from(result.body, 'base64') : result.body ?? '')
        } catch (error) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: error instanceof Error ? error.message : 'Premium API failed' }))
        }
      })
    }
  }
}

function publicMediaProxy(): Plugin {
  return {
    name: 'x-sutra-public-media-proxy',
    configureServer(server) {
      server.middlewares.use('/api/redgifs', (req, res) => {
        void servePublicMedia(req, res)
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), publicMediaProxy(), premiumDevApi()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    strictPort: true,
    allowedHosts: true
  }
})
