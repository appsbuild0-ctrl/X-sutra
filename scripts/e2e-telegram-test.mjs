import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { createMockTelegram } from './mock-telegram.mjs'

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
)

let passed = 0
let failed = 0
function check(name, cond, detail = '') {
  if (cond) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failed += 1
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function startMock() {
  const mock = createMockTelegram()
  await new Promise((resolve) => mock.server.listen(0, '127.0.0.1', resolve))
  const { port } = mock.server.address()
  return { mock, port }
}

async function startBackend() {
  const { serveNode } = await import('../server/http-adapter.mjs')
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname.startsWith('/api/')) void serveNode(req, res)
    else {
      res.statusCode = 404
      res.end('not found')
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { server, port }
}

async function request(backendPort, method, path, { body, headers = {}, cookie } = {}) {
  const res = await fetch(`http://127.0.0.1:${backendPort}${path}`, {
    method,
    body,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers }
  })
  const text = await res.text()
  let json = null
  try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: res.status, headers: res.headers, text, json }
}

async function binaryRequest(backendPort, method, path, { headers = {}, cookie } = {}) {
  const res = await fetch(`http://127.0.0.1:${backendPort}${path}`, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...headers }
  })
  const buffer = Buffer.from(await res.arrayBuffer())
  return { status: res.status, headers: res.headers, buffer }
}

async function main() {
  const { mock, port: mockPort } = await startMock()
  process.env.TELEGRAM_API_BASE = `http://127.0.0.1:${mockPort}`
  process.env.TELEGRAM_BOT_TOKEN = 'testtoken-keep-secret'
  process.env.TELEGRAM_STORAGE_CHAT_ID = '-100999'
  process.env.ADMIN_PASSWORD = 'secret123'
  process.env.ADMIN_SESSION_SECRET = 'topsecret-session-key'
  process.env.XSUTRA_DATA_DIR = mkdtempSync(join(tmpdir(), 'xsutra-e2e-'))

  const { server: backend, port: backendPort } = await startBackend()

  try {
    console.log('\nTelegram-backed media backend — end-to-end test\n')

    // --- Admin auth -------------------------------------------------------
    console.log('Admin authentication')
    const noSession = await request(backendPort, 'GET', '/api/admin/session')
    check('session endpoint is public and reports not-admin', noSession.status === 200 && noSession.json.admin === false)

    const badLogin = await request(backendPort, 'POST', '/api/admin/login', {
      body: JSON.stringify({ password: 'wrong' }), headers: { 'Content-Type': 'application/json' }
    })
    check('wrong password is rejected (401)', badLogin.status === 401)

    const login = await request(backendPort, 'POST', '/api/admin/login', {
      body: JSON.stringify({ password: 'secret123' }), headers: { 'Content-Type': 'application/json' }
    })
    check('correct password signs in admin', login.status === 200 && login.json.admin === true)
    const cookie = login.headers.get('set-cookie') || ''
    check('admin session cookie is HttpOnly', /httponly/i.test(cookie), cookie)
    check('admin session token is never the Telegram token', !cookie.includes('testtoken'))

    const withSession = await request(backendPort, 'GET', '/api/admin/session', { cookie })
    check('session cookie is accepted', withSession.json.admin === true)

    // --- Unauthorized upload (normal user) --------------------------------
    console.log('\nAuthorization enforcement')
    const anonUpload = await request(backendPort, 'POST', '/api/media/upload', {
      body: new FormData(), headers: {}
    }).catch(() => null)
    // FormData with no file still must be 401 (admin required) before any processing.
    const anonRaw = await fetch(`http://127.0.0.1:${backendPort}/api/media/upload`, { method: 'POST', body: new FormData() })
    check('upload without admin session is blocked (401)', anonRaw.status === 401)

    // --- Image upload + stream + range ------------------------------------
    console.log('\nImage upload → store → stream')
    const imgForm = new FormData()
    imgForm.append('file', new File([TINY_PNG], 'pic.png', { type: 'image/png' }), 'pic.png')
    imgForm.append('title', 'Sunset')
    const imgUp = await request(backendPort, 'POST', '/api/media/upload', { body: imgForm, cookie })
    check('image upload returns 201', imgUp.status === 201, `status ${imgUp.status}`)
    check('uploaded item has mediaType image', imgUp.json?.mediaType === 'image')
    check('uploaded item stores size + filename', imgUp.json?.fileSize === TINY_PNG.length && imgUp.json?.fileName === 'pic.png')
    const imageId = imgUp.json?.id
    check('no Telegram token in upload response', !JSON.stringify(imgUp.json).includes('testtoken'))

    const imgList = await request(backendPort, 'GET', '/api/media')
    check('public list includes uploaded image', imgList.json?.items?.some((i) => i.id === imageId))
    check('public list exposes no Telegram token', !JSON.stringify(imgList.json).includes('testtoken'))

    const imgStream = await binaryRequest(backendPort, 'GET', `/api/media/${imageId}/stream`)
    check('image stream returns the exact bytes', imgStream.status === 200 && imgStream.buffer.equals(TINY_PNG))
    check('image stream sets image content-type', (imgStream.headers.get('content-type') || '').startsWith('image/png'))
    check('image stream allows ranges', (imgStream.headers.get('accept-ranges') || '') === 'bytes')

    const imgRange = await binaryRequest(backendPort, 'GET', `/api/media/${imageId}/stream`, { headers: { Range: 'bytes=0-4' } })
    check('image stream honors Range (206 + 5 bytes)', imgRange.status === 206 && imgRange.buffer.length === 5)

    // --- Video upload + stream + thumbnail ---------------------------------
    console.log('\nVideo upload → store → stream + thumbnail')
    const videoBytes = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b])
    const vidForm = new FormData()
    vidForm.append('file', new File([videoBytes], 'clip.mp4', { type: 'video/mp4' }), 'clip.mp4')
    const vidUp = await request(backendPort, 'POST', '/api/media/upload', { body: vidForm, cookie })
    check('video upload returns 201', vidUp.status === 201, `status ${vidUp.status}`)
    check('uploaded item has mediaType video', vidUp.json?.mediaType === 'video')
    const videoId = vidUp.json?.id

    const vidStream = await binaryRequest(backendPort, 'GET', `/api/media/${videoId}/stream`)
    check('video stream returns the exact bytes', vidStream.status === 200 && vidStream.buffer.equals(videoBytes))
    check('video stream sets video content-type', (vidStream.headers.get('content-type') || '').startsWith('video/mp4'))

    const vidThumb = await binaryRequest(backendPort, 'GET', `/api/media/${videoId}/thumbnail`)
    check('video thumbnail streams (200)', vidThumb.status === 200)
    check('video thumbnail is a real image (tiny png)', vidThumb.buffer.equals(TINY_PNG))

    // --- File upload + download -------------------------------------------
    console.log('\nFile upload → store → download')
    const docBytes = Buffer.from('Hello from X-sutra storage layer.', 'utf8')
    const docForm = new FormData()
    docForm.append('file', new File([docBytes], 'notes.txt', { type: 'text/plain' }), 'notes.txt')
    const docUp = await request(backendPort, 'POST', '/api/media/upload', { body: docForm, cookie })
    check('file upload returns 201', docUp.status === 201, `status ${docUp.status}`)
    check('uploaded item has mediaType file', docUp.json?.mediaType === 'file')
    check('file item exposes a download URL', typeof docUp.json?.fileUrl === 'string' && docUp.json.fileUrl.endsWith('/file'))
    const fileId = docUp.json?.id

    const docDownload = await binaryRequest(backendPort, 'GET', `/api/media/${fileId}/file`)
    check('file download returns exact bytes', docDownload.status === 200 && docDownload.buffer.equals(docBytes))
    check('file download is an attachment', /attachment/i.test(docDownload.headers.get('content-disposition') || ''))
    check('file download sets text content-type', (docDownload.headers.get('content-type') || '').startsWith('text/plain'))

    // --- File-size limit --------------------------------------------------
    console.log('\nValidation')
    const oversize = Buffer.alloc(11 * 1024 * 1024, 1) // 11 MB > 10 MB image limit
    const overForm = new FormData()
    overForm.append('file', new File([oversize], 'big.png', { type: 'image/png' }), 'big.png')
    const overUp = await request(backendPort, 'POST', '/api/media/upload', { body: overForm, cookie })
    check('oversized image is rejected (413)', overUp.status === 413, `status ${overUp.status}`)
    check('rejection message mentions the limit', /limit/i.test(overUp.json?.error || ''))

    const exeBytes = Buffer.from([0x1, 0x2, 0x3])
    const exeForm = new FormData()
    exeForm.append('file', new File([exeBytes], 'run.exe', { type: 'application/x-msdownload' }), 'run.exe')
    const exeUp = await request(backendPort, 'POST', '/api/media/upload', { body: exeForm, cookie })
    check('unsupported file type is rejected (415)', exeUp.status === 415, `status ${exeUp.status}`)

    // --- Delete (admin) + unauthorized delete -----------------------------
    console.log('\nDeletion')
    const anonDelete = await fetch(`http://127.0.0.1:${backendPort}/api/media/${imageId}`, { method: 'DELETE' })
    check('delete without admin session is blocked (401)', anonDelete.status === 401)

    const del = await request(backendPort, 'DELETE', `/api/media/${imageId}`, { cookie })
    check('admin delete succeeds (200)', del.status === 200)
    const afterList = await request(backendPort, 'GET', '/api/media')
    check('deleted image is gone from the list', !afterList.json?.items?.some((i) => i.id === imageId))

    // --- Logout -----------------------------------------------------------
    console.log('\nLogout')
    const logout = await request(backendPort, 'POST', '/api/admin/logout', { cookie })
    check('logout succeeds', logout.status === 200)
    check('logout clears the session cookie', /max-age=0/i.test(logout.headers.get('set-cookie') || ''))
    // A browser drops the cookie after the Max-Age=0 response, so subsequent
    // requests no longer carry it.
    const afterLogout = await request(backendPort, 'GET', '/api/admin/session')
    check('session invalid after logout', afterLogout.json?.admin === false)

    console.log(`\nResult: ${passed} passed, ${failed} failed`)
  } finally {
    backend.close()
    mock.server.close()
  }

  process.exit(failed === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error('Test crashed:', error)
  process.exit(1)
})
