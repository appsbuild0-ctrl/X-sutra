import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createMockTelegram } from './mock-telegram.mjs'

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

const repo = dirname(dirname(fileURLToPath(import.meta.url)))
let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) { passed += 1; console.log(`  ✓ ${name}`) }
  else { failed += 1; console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  // 1) Mock Telegram
  const mock = createMockTelegram()
  await new Promise((res) => mock.server.listen(0, '127.0.0.1', res))
  const mockPort = mock.server.address().port

  // 2) Env for the dev server (server-side only; never reaches the browser)
  process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${mockPort}`
  process.env.TELEGRAM_BOT_TOKEN = 'devtoken-secret'
  process.env.TELEGRAM_STORAGE_CHAT_ID = '-100999'
  process.env.ADMIN_PASSWORD = 'devpass'
  process.env.ADMIN_SESSION_SECRET = 'devsession'
  process.env.XSUTRA_DATA_DIR = mkdtempSync(join(tmpdir(), 'xsutra-live-'))
  process.env.NODE_ENV = 'development'

  // 3) Start the real Vite dev server (the path the user runs with `npm run dev`)
  const vite = spawn(join(repo, 'node_modules', '.bin', 'vite'), ['--port', '5179', '--strictPort'], {
    cwd: repo,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let viteLog = ''
  vite.stdout.on('data', (d) => { viteLog += d.toString() })
  vite.stderr.on('data', (d) => { viteLog += d.toString() })

  const base = 'http://127.0.0.1:5179'
  let ready = false
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${base}/api/media`)
      if (r.ok) { ready = true; break }
    } catch { /* not up yet */ }
    await sleep(500)
  }
  if (!ready) {
    console.error('Vite dev server did not start:\n', viteLog.slice(-800))
    vite.kill('SIGTERM'); mock.server.close(); process.exit(1)
  }

  try {
    console.log('\nLive Vite dev server — media API integration\n')

    // Public list works without auth (proves the /api/media dev middleware is mounted)
    const list0 = await (await fetch(`${base}/api/media`)).json()
    check('public media list is reachable via dev server (200)', Array.isArray(list0.items))

    // Admin login
    const loginRes = await fetch(`${base}/api/admin/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'devpass' })
    })
    check('admin login via dev server (200)', loginRes.status === 200)
    const cookie = loginRes.headers.get('set-cookie') || ''
    check('admin cookie is HttpOnly', /httponly/i.test(cookie))

    // Upload a real image through the dev server
    const fd = new FormData()
    fd.append('file', new File([TINY_PNG], 'logo.png', { type: 'image/png' }), 'logo.png')
    fd.append('title', 'Live test')
    const upRes = await fetch(`${base}/api/media/upload`, { method: 'POST', body: fd, headers: { Cookie: cookie } })
    check('upload through dev server (201)', upRes.status === 201, `status ${upRes.status}`)
    const upJson = await upRes.json()
    const id = upJson.id
    check('upload response has no Telegram token', !JSON.stringify(upJson).includes('devtoken-secret'))

    // Stream returns exact bytes
    const streamRes = await fetch(`${base}/api/media/${id}/stream`)
    const streamBuf = Buffer.from(await streamRes.arrayBuffer())
    check('stream returns exact bytes via dev server', streamRes.status === 200 && streamBuf.equals(TINY_PNG))

    // Delete via dev server
    const delRes = await fetch(`${base}/api/media/${id}`, { method: 'DELETE', headers: { Cookie: cookie } })
    check('delete via dev server (200)', delRes.status === 200)

    // Unauthorized upload blocked
    const anon = await fetch(`${base}/api/media/upload`, { method: 'POST', body: new FormData() })
    check('unauthorized upload blocked (401)', anon.status === 401)

    console.log(`\nResult: ${passed} passed, ${failed} failed`)
  } finally {
    vite.kill('SIGTERM')
    mock.server.close()
  }
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => { console.error(e); process.exit(1) })
