// X-sutra Vercel backend — single catch-all function.
// Handlers netlify/functions/ se aate hain (same code Netlify + Vercel dono).
import { handler as redgifs } from '../netlify/functions/redgifs.mjs'
import { handler as media } from '../netlify/functions/media.mjs'
import { handler as premium } from '../netlify/functions/premium.mjs'
import { handler as premiumScan } from '../netlify/functions/premium-scan.mjs'
import { handler as premiumFile } from '../netlify/functions/premium-file.mjs'
import { handler as hotpic } from '../netlify/functions/hotpic.mjs'
import { handler as telegramChannels } from '../netlify/functions/telegram-channels.mjs'
import { handler as telegramAdmin } from '../netlify/functions/telegram-admin.mjs'
import { handler as authTelegram } from '../netlify/functions/auth-telegram.mjs'
import { handler as uploads } from '../netlify/functions/uploads.mjs'
import { handler as channels } from '../netlify/functions/channels.mjs'
import { handler as uploadFile } from '../netlify/functions/upload-file.mjs'
import { runHandler } from '../netlify/functions/_server/vercel.mjs'

const ROUTES = new Map([
  ['/api/redgifs', redgifs],
  ['/api/media', media],
  ['/api/premium', premium],
  ['/api/premium-scan', premiumScan],
  ['/api/premium-file', premiumFile],
  ['/api/hotpic', hotpic],
  ['/api/telegram/channels', telegramChannels],
  ['/api/internal/telegram-auth', telegramAdmin],
  ['/api/auth/telegram', authTelegram],
  ['/api/uploads', uploads],
  ['/api/channels', channels]
])

const HOTPIC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

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
  const path = (req.url || '/').split('?')[0].replace(/\/+$/, '') || '/'
  if (path.startsWith('/api/hotpic-html/')) return proxyHotpicHtml((req.url || '').slice('/api/hotpic-html'.length), res)
  // /api/uploads/<id> serves file bytes (Range aware) — its own handler.
  if (path.startsWith('/api/uploads/')) {
    const id = decodeURIComponent(path.slice('/api/uploads/'.length))
    return runHandler(uploadFile, req, res, { readBody: false, extra: { pathParameters: { id } } })
  }
  if (!ROUTES.has(path)) {
    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    return res.end(JSON.stringify({ error: 'Unknown API endpoint.' }))
  }
  await runHandler(ROUTES.get(path), req, res)
}
