import { createServer } from 'node:http'
import { serveNode } from './http-adapter.mjs'

/**
 * Standalone secure backend. In the X-sutra app this logic is also mounted by
 * the Vite dev plugin and the Netlify Function, so the same code runs
 * everywhere. Run with: node server/index.mjs  (set env vars first)
 */
const PORT = Number(process.env.PORT || 8787)

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname.startsWith('/api/')) {
    void serveNode(req, res)
    return
  }
  res.statusCode = 404
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ error: 'Not found' }))
})

server.listen(PORT, () => {
  console.log(`[x-sutra backend] listening on http://localhost:${PORT}`)
})
