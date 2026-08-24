import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
// @ts-expect-error server backend module is plain Node ESM without type declarations
import { serveNode } from './server/http-adapter.mjs'

const ORIGIN = 'https://api.redgifs.com'
const USER_AGENT = 'Mozilla/5.0 (compatible; X-sutra/1.0; public-media-client)'

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
    const tokenResponse = await fetch(`${ORIGIN}/v2/auth/temporary`, { headers: { Accept: 'application/json', 'User-Agent': USER_AGENT } })
    if (!tokenResponse.ok) throw new Error(`Temporary token request failed (${tokenResponse.status})`)
    const { token } = await tokenResponse.json() as { token?: string }
    if (!token) throw new Error('Temporary token response was empty')

    const apiResponse = await fetch(target, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'User-Agent': USER_AGENT }
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

/**
 * Mounts the secure Telegram-backed media backend (/api/media and /api/admin)
 * during local development. The same handlers run in production via the
 * Netlify Function, so behaviour is identical. A pathless middleware is used
 * (rather than `middlewares.use('/api/media', …)`) so that `req.url` is NOT
 * rewritten before reach the handler, which routes on the full path.
 */
function secureMediaProxy(): Plugin {
  return {
    name: 'x-sutra-secure-media-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url || ''
        if (url.startsWith('/api/media') || url.startsWith('/api/admin')) {
          void serveNode(req, res)
        } else {
          next()
        }
      })
    }
  }
}

export default defineConfig({
  plugins: [react(), publicMediaProxy(), secureMediaProxy()],
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
