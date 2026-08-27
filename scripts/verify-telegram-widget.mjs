// Verifies "Login with Telegram" + admin uploads end to end.
//
// The real netlify/functions/auth-telegram.mjs, uploads.mjs, upload-file.mjs
// handlers and the real Vercel entries in api/ are driven here. Only the
// PostgreSQL driver is replaced (scripts/fixtures/fake-neon.mjs), so the real
// schema, role checks, chunk bookkeeping and byte-range maths all run.
//
// The bot token below is a throwaway value for signature maths only — it is not
// a real bot, and production code reads TELEGRAM_BOT_TOKEN from the environment.
//
// Run: npm run check:telegram-widget

import { registerHooks } from 'node:module'
import { Readable } from 'node:stream'

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'postgres') return { url: new URL('./fixtures/fake-neon.mjs', import.meta.url).href, format: 'module', shortCircuit: true }
    return nextResolve(specifier, context)
  }
})

const TEST_BOT_TOKEN = '0000000000:TEST-ONLY-not-a-real-bot-token'
process.env.SESSION_ENCRYPTION_KEY = 'test-encryption-key-with-length'
process.env.AUTH_JWT_SECRET = 'test-jwt-secret-with-length'
process.env.DATABASE_URL = 'postgres://user:pass@example.neon.tech/x_sutra?sslmode=require'
process.env.TELEGRAM_BOT_TOKEN = TEST_BOT_TOKEN
process.env.TELEGRAM_ADMIN_IDS = '4242'

// getMe is answered locally so no outbound call is needed (and so the failure
// path can be exercised deterministically).
let botApiResponse = { ok: true, status: 200, body: { ok: true, result: { username: 'x_sutra_bot', first_name: 'X-Sutra' } } }
const fetchCalls = []
globalThis.fetch = async (url) => {
  fetchCalls.push(String(url))
  return { ok: botApiResponse.ok, status: botApiResponse.status, json: async () => botApiResponse.body }
}

const { computeTelegramHash, resetBotInfoCache, verifyTelegramWidgetAuth } = await import('../netlify/functions/_server/telegramLogin.mjs')
const { signOwnerToken, verifyUserToken, requireOwner } = await import('../netlify/functions/_server/security.mjs')
const { requireAdminUser } = await import('../netlify/functions/_server/users.mjs')
const { CHUNK_BYTES, SERVE_BYTES } = await import('../netlify/functions/_server/uploads.mjs')
const { handler: authHandler } = await import('../netlify/functions/auth-telegram.mjs')
const { handler: uploadsHandler } = await import('../netlify/functions/uploads.mjs')
const { handler: fileHandler } = await import('../netlify/functions/upload-file.mjs')
const { handler: channelsHandler } = await import('../netlify/functions/channels.mjs')
const fakeNeon = await import('./fixtures/fake-neon.mjs')

let failures = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) console.log(`  ok   ${label}`)
  else {
    failures += 1
    console.log(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`)
  }
}
const ok = (label, condition, detail = '') => {
  if (condition) console.log(`  ok   ${label}`)
  else {
    failures += 1
    console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`)
  }
}

const OWNER_ID = '4242'
const USER_ID = '900001'

// Builds a payload exactly the way the widget does: optional fields that do not
// exist are omitted, not sent empty.
const widgetPayload = (over = {}) => {
  const raw = {
    id: OWNER_ID,
    first_name: 'Owner',
    last_name: 'X',
    username: 'x_sutra_owner',
    photo_url: 'https://t.me/i/userpic/320/owner.jpg',
    auth_date: String(Math.floor(Date.now() / 1000)),
    ...over
  }
  const fields = Object.fromEntries(Object.entries(raw).filter(([, value]) => value !== '' && value !== undefined && value !== null))
  return { ...fields, hash: computeTelegramHash(fields) }
}

const call = async (handler, body, headers = {}) => {
  const response = await handler({ httpMethod: body ? 'POST' : 'GET', headers, body: body ? JSON.stringify(body) : undefined, queryStringParameters: {} })
  const text = response.body ?? ''
  let parsed = null
  try { parsed = text ? JSON.parse(text) : null } catch { parsed = text }
  return { status: response.statusCode, body: parsed, headers: response.headers || {}, isBase64Encoded: Boolean(response.isBase64Encoded), raw: text }
}
const auth = (token) => ({ authorization: `Bearer ${token}` })

fakeNeon.__reset()

// ---------------------------------------------------------------------------
console.log('Telegram Login Widget signature verification')
{
  const identity = verifyTelegramWidgetAuth(widgetPayload())
  check('a valid widget payload yields the verified identity', { id: identity.id, username: identity.username, firstName: identity.firstName }, { id: OWNER_ID, username: 'x_sutra_owner', firstName: 'Owner' })

  const forgedId = widgetPayload()
  forgedId.id = '999'
  let error = null
  try { verifyTelegramWidgetAuth(forgedId) } catch (caught) { error = caught }
  check('changing the user id invalidates the signature', error?.statusCode, 401)
  ok('…and the reason is explicit', String(error?.message).includes('hash mismatch'), String(error?.message))

  const otherBot = { ...widgetPayload() }
  otherBot.hash = computeTelegramHash(otherBot, '0000000000:SOME-OTHER-BOT-TOKEN')
  let wrongBot = null
  try { verifyTelegramWidgetAuth(otherBot) } catch (caught) { wrongBot = caught }
  check('a payload signed by another bot is rejected', wrongBot?.statusCode, 401)

  const stale = widgetPayload({ auth_date: String(Math.floor(Date.now() / 1000) - 7200) })
  let tooOld = null
  try { verifyTelegramWidgetAuth(stale) } catch (caught) { tooOld = caught }
  check('an old login is rejected', tooOld?.statusCode, 401)
  ok('…with the age in the message', String(tooOld?.message).includes('older than'), String(tooOld?.message))

  const future = widgetPayload({ auth_date: String(Math.floor(Date.now() / 1000) + 600) })
  let ahead = null
  try { verifyTelegramWidgetAuth(future) } catch (caught) { ahead = caught }
  check('a future timestamp is rejected', ahead?.statusCode, 401)

  // A client may append junk to a genuine payload; only the signed, documented
  // fields are used, so an injected id/role can never be picked up.
  const injected = verifyTelegramWidgetAuth({ ...widgetPayload(), id2: '777', role: 'admin', status: 'on' })
  check('the signed id wins over anything appended', injected.id, OWNER_ID)
  ok('appended role/status/id2 are not trusted', !('role' in injected) && !('status' in injected) && !('id2' in injected), JSON.stringify(injected))
  ok('no hash is echoed back to callers', !('hash' in injected))

  // A payload whose signature covers extra fields is not a Telegram payload.
  const overSigned = widgetPayload({ role: 'admin' })
  let extra = null
  try { verifyTelegramWidgetAuth(overSigned) } catch (caught) { extra = caught }
  check('a payload signed over extra fields is rejected', extra?.statusCode, 401)
}

// ---------------------------------------------------------------------------
console.log('GET /api/auth/telegram — public widget config, never the token')
{
  resetBotInfoCache()
  const config = await call(authHandler)
  check('the bot username is published for the widget', config.body, { enabled: true, botUsername: 'x_sutra_bot', botName: 'X-Sutra' })
  ok('the bot token is NOT in the response', !JSON.stringify(config.body).includes(TEST_BOT_TOKEN) && !config.raw.includes(TEST_BOT_TOKEN))
  ok('getMe was called on the Bot API', fetchCalls.some((url) => url.endsWith('/getMe')), JSON.stringify(fetchCalls))

  resetBotInfoCache()
  botApiResponse = { ok: false, status: 401, body: { ok: false, description: 'Unauthorized' } }
  const broken = await call(authHandler)
  check('a bad token is reported, not hidden', broken.body.enabled, false)
  ok('…with Telegram’s own reason', String(broken.body.error).includes('Unauthorized'), String(broken.body.error))
  botApiResponse = { ok: true, status: 200, body: { ok: true, result: { username: 'x_sutra_bot', first_name: 'X-Sutra' } } }
  resetBotInfoCache()
}

// ---------------------------------------------------------------------------
console.log('POST login — account is created from the verified id only')
let adminToken = ''
let userToken = ''
{
  const login = await call(authHandler, { action: 'login', auth: widgetPayload() })
  check('login succeeds', login.status, 200)
  check('the account uses the Telegram id', login.body.user.telegramId, OWNER_ID)
  check('TELEGRAM_ADMIN_IDS makes this id an admin', login.body.user.role, 'admin')
  ok('a signed session token is returned', String(login.body.token || '').split('.').length === 3)
  check('the session lasts 30 days by default', login.body.expiresInDays, 30)
  adminToken = login.body.token

  const plain = await call(authHandler, { action: 'login', auth: widgetPayload({ id: USER_ID, first_name: 'Member', username: '' }) })
  check('a non-admin id becomes a normal user', plain.body.user.role, 'normal')
  check('the display name is built from the Telegram profile', plain.body.user.name, 'Member X')
  userToken = plain.body.token

  const forged = await call(authHandler, { action: 'login', auth: { ...widgetPayload(), id: '777' } })
  check('a forged id is rejected with 401', forged.status, 401)
  ok('…and the message says why', String(forged.body.error).includes('hash mismatch'), String(forged.body.error))
  ok('no token is issued for a forged login', !forged.body.token)

  const noPayload = await call(authHandler, { action: 'login' })
  check('login without a payload is a 401', noPayload.status, 401)
}

// ---------------------------------------------------------------------------
console.log('sessions — the owner console token and the app token stay separate')
{
  const session = await call(authHandler, { action: 'session' }, auth(adminToken))
  check('session returns the account', session.body.user.role, 'admin')

  const ownerToken = (await signOwnerToken(OWNER_ID)).ownerToken
  const crossUse = await call(authHandler, { action: 'session' }, auth(ownerToken))
  check('a private-source owner token cannot be used as an app session', crossUse.status, 401)
  const reverse = await requireOwner({ headers: auth(adminToken) }).catch((error) => ({ statusCode: error.statusCode }))
  check('an app session cannot unlock the private-source console', reverse.statusCode, 401)
  await verifyUserToken(adminToken)
  ok('the app token itself verifies', true)

  const junk = await call(authHandler, { action: 'session' }, auth('not-a-jwt'))
  check('a junk token is a 401', junk.status, 401)
}

// ---------------------------------------------------------------------------
console.log('authorization — admin only, and re-checked against the database')
{
  const asUser = await call(uploadsHandler, { action: 'start', contentType: 'video/mp4', size: 1000, filename: 'a.mp4' }, auth(userToken))
  check('a normal user cannot upload', asUser.status, 403)
  ok('…and is told exactly that', String(asUser.body.error).includes('Only an admin'), String(asUser.body.error))

  const anonymous = await call(uploadsHandler, { action: 'start', contentType: 'video/mp4', size: 1000 })
  check('an anonymous upload is a 401', anonymous.status, 401)

  const asUserAdminAction = await call(authHandler, { action: 'listAdmins' }, auth(userToken))
  check('a normal user cannot read the admin list', asUserAdminAction.status, 403)

  const gate = await requireAdminUser({ headers: auth(adminToken) })
  check('the admin session passes the server-side gate', gate.role, 'admin')
}

// ---------------------------------------------------------------------------
console.log('admin management — Telegram ids, roles, disable')
{
  const listed = await call(authHandler, { action: 'listAdmins' }, auth(adminToken))
  check('TELEGRAM_ADMIN_IDS is listed as an admin', listed.body.admins.map((row) => row.telegramId), [OWNER_ID])

  const added = await call(authHandler, { action: 'addAdmin', telegramId: '555000', label: 'editor' }, auth(adminToken))
  check('a second admin can be added', added.body.admins.map((row) => row.telegramId), [OWNER_ID, '555000'])

  const promoted = await call(authHandler, { action: 'login', auth: widgetPayload({ id: '555000', first_name: 'Editor' }) })
  check('the new admin id logs in as admin', promoted.body.user.role, 'admin')

  const removed = await call(authHandler, { action: 'removeAdmin', telegramId: '555000' }, auth(adminToken))
  check('and can be removed again', removed.body.admins.map((row) => row.telegramId), [OWNER_ID])

  const demoted = await call(authHandler, { action: 'session' }, auth(promoted.body.token))
  check('the removed admin is demoted on the next request', demoted.body.user.role, 'normal')

  const envSeed = await call(authHandler, { action: 'removeAdmin', telegramId: OWNER_ID }, auth(adminToken))
  check('the env-seeded admin cannot be deleted from the database', envSeed.status, 400)

  const badId = await call(authHandler, { action: 'addAdmin', telegramId: '@someone' }, auth(adminToken))
  check('a non-numeric id is refused', badId.status, 400)

  const role = await call(authHandler, { action: 'setUserRole', telegramId: USER_ID, role: 'vip' }, auth(adminToken))
  check('an admin can grant VIP', role.body.user.role, 'vip')
  const disabled = await call(authHandler, { action: 'setUserStatus', telegramId: USER_ID, status: 'off' }, auth(adminToken))
  check('an admin can disable an account', disabled.body.user.status, 'off')
  const blocked = await call(authHandler, { action: 'session' }, auth(userToken))
  check('a disabled account loses its session', blocked.status, 403)
  await call(authHandler, { action: 'setUserStatus', telegramId: USER_ID, status: 'on' }, auth(adminToken))
  await call(authHandler, { action: 'setUserRole', telegramId: USER_ID, role: 'normal' }, auth(adminToken))
}

// ---------------------------------------------------------------------------
console.log('logout — server-side, not just client-side')
{
  const throwaway = await call(authHandler, { action: 'login', auth: widgetPayload({ id: '700002', first_name: 'Temp' }) })
  const before = await call(authHandler, { action: 'session' }, auth(throwaway.body.token))
  check('the session works before logout', before.status, 200)
  const out = await call(authHandler, { action: 'logout' }, auth(throwaway.body.token))
  check('logout succeeds', out.body, { ok: true })
  const after = await call(authHandler, { action: 'session' }, auth(throwaway.body.token))
  check('the same token is rejected after logout', after.status, 401)
}

// ---------------------------------------------------------------------------
console.log('uploads — chunked into PostgreSQL by an admin only')
const fileSize = CHUNK_BYTES + 1234
const fileBytes = Buffer.alloc(fileSize)
for (let index = 0; index < fileSize; index += 1) fileBytes[index] = index % 251
let uploadId = ''
{
  const badType = await call(uploadsHandler, { action: 'start', contentType: 'application/x-msdownload', size: 1000 }, auth(adminToken))
  check('an unsupported file type is refused', badType.status, 400)

  const tooBig = await call(uploadsHandler, { action: 'start', contentType: 'video/mp4', size: 500 * 1024 * 1024 }, auth(adminToken))
  check('an oversized file is refused with 413', tooBig.status, 413)

  const started = await call(uploadsHandler, {
    action: 'start',
    contentType: 'video/mp4',
    filename: 'demo clip.mp4',
    size: fileSize,
    title: 'Demo clip',
    category: 'Trailers'
  }, auth(adminToken))
  check('the upload is split into 3MB chunks', started.body, { ok: true, id: started.body.id, kind: 'video', chunks: 2, chunkSize: CHUNK_BYTES, url: `/api/uploads/${started.body.id}` })
  uploadId = started.body.id

  const early = await call(uploadsHandler, { action: 'finish', id: uploadId }, auth(adminToken))
  check('finishing before the chunks arrive is refused', early.status, 400)
  ok('…and says how many are missing', String(early.body.error).includes('0 of 2'), String(early.body.error))

  const outOfRange = await call(uploadsHandler, { action: 'chunk', id: uploadId, index: 5, data: fileBytes.subarray(0, 10).toString('base64') }, auth(adminToken))
  check('a chunk outside the range is refused', outOfRange.status, 400)

  for (let index = 0; index < 2; index += 1) {
    const slice = fileBytes.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES)
    const sent = await call(uploadsHandler, { action: 'chunk', id: uploadId, index, data: slice.toString('base64') }, auth(adminToken))
    check(`chunk ${index} is stored`, { received: sent.body.received, expected: sent.body.expected }, { received: index + 1, expected: 2 })
  }

  const finished = await call(uploadsHandler, { action: 'finish', id: uploadId, title: 'Demo clip', category: 'Trailers' }, auth(adminToken))
  check('finishing marks the upload ready', { status: finished.body.upload.status, bytes: finished.body.upload.bytes }, { status: 'ready', bytes: fileSize })
  check('the byte count in the database matches the file', Number(fakeNeon.__store().uploads[0].bytes), fileSize)

  const userUpload = await call(uploadsHandler, { action: 'start', contentType: 'video/mp4', size: 1000 }, auth(userToken))
  check('a normal user still cannot start an upload', userUpload.status, 403)
}

// ---------------------------------------------------------------------------
console.log('serving — real Range support so the existing player keeps working')
{
  const whole = await call(fileHandler, null, {})
  check('the file endpoint needs an id', whole.status, 400)

  const viaQuery = await fileHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: { id: uploadId } })
  const decoded = Buffer.from(viaQuery.body, 'base64')
  check('a range-less request is served as a bounded partial', viaQuery.statusCode, 206)
  check('the partial is capped to one serve window', decoded.length, Math.min(SERVE_BYTES, fileSize))
  check('Content-Range advertises the real size', viaQuery.headers['content-range'], `bytes 0-${decoded.length - 1}/${fileSize}`)
  ok('the bytes are the original file bytes', decoded.equals(fileBytes.subarray(0, decoded.length)))

  const ranged = await fileHandler({ httpMethod: 'GET', headers: { range: `bytes=${CHUNK_BYTES - 5}-${CHUNK_BYTES + 4}` }, queryStringParameters: { id: uploadId } })
  const rangedBytes = Buffer.from(ranged.body, 'base64')
  check('a range across the chunk boundary is stitched correctly', rangedBytes.length, 10)
  ok('…and matches the source file exactly', rangedBytes.equals(fileBytes.subarray(CHUNK_BYTES - 5, CHUNK_BYTES + 5)))
  check('the response is a 206 with the right Content-Range', [ranged.statusCode, ranged.headers['content-range']], [206, `bytes ${CHUNK_BYTES - 5}-${CHUNK_BYTES + 4}/${fileSize}`])

  const tail = await fileHandler({ httpMethod: 'GET', headers: { range: `bytes=-100` }, queryStringParameters: { id: uploadId } })
  ok('a suffix range returns the last bytes', Buffer.from(tail.body, 'base64').equals(fileBytes.subarray(fileSize - 100)))

  const invalid = await fileHandler({ httpMethod: 'GET', headers: { range: `bytes=${fileSize + 10}-` }, queryStringParameters: { id: uploadId } })
  check('an unsatisfiable range is a 416', invalid.statusCode, 416)

  const missing = await fileHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: { id: 'upnope' } })
  check('an unknown id is a 404', missing.statusCode, 404)
}

// ---------------------------------------------------------------------------
console.log('visibility — access roles are enforced on the file, not just the UI')
{
  const madePrivate = await call(uploadsHandler, { action: 'update', id: uploadId, accessRole: 'vip', title: 'Demo clip (VIP)' }, auth(adminToken))
  check('an admin can restrict an upload to VIP', madePrivate.body.upload.accessRole, 'vip')

  const anonymous = await fileHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: { id: uploadId } })
  check('anonymous access to a VIP upload is a 403', anonymous.statusCode, 403)

  const vipUser = await call(authHandler, { action: 'login', auth: widgetPayload({ id: '800003', first_name: 'Vip' }) })
  await call(authHandler, { action: 'setUserRole', telegramId: '800003', role: 'vip' }, auth(adminToken))
  const vipAgain = await call(authHandler, { action: 'login', auth: widgetPayload({ id: '800003', first_name: 'Vip' }) })
  const vipToken = vipAgain.body.token

  const normalRead = await fileHandler({ httpMethod: 'GET', headers: auth(userToken), queryStringParameters: { id: uploadId } })
  check('a normal user is refused the VIP file', normalRead.statusCode, 403)
  const vipRead = await fileHandler({ httpMethod: 'GET', headers: auth(vipToken), queryStringParameters: { id: uploadId } })
  check('a VIP user gets it', vipRead.statusCode, 206)
  ok('a VIP user has no upload rights', (await call(uploadsHandler, { action: 'start', contentType: 'video/mp4', size: 10 }, auth(vipToken))).status === 403)
  ok('(login sanity)', vipUser.status === 200)

  await call(uploadsHandler, { action: 'update', id: uploadId, accessRole: 'public' }, auth(adminToken))
}

// ---------------------------------------------------------------------------
console.log('listing — the frontend sees metadata only, never file bytes')
{
  const publicList = await call(uploadsHandler)
  check('a published upload is listed without a token', publicList.body.uploads.map((row) => row.id), [uploadId])
  check('its category is listed for the picker', publicList.body.categories, [{ category: 'Trailers', total: 1 }])
  ok('no file bytes are in the listing', !JSON.stringify(publicList.body).includes(fileBytes.subarray(0, 64).toString('base64')))
  ok('the listing exposes a playable URL', publicList.body.uploads[0].url === `/api/uploads/${uploadId}`)

  const renamed = await call(uploadsHandler, { action: 'update', id: uploadId, title: 'Renamed clip', category: 'Music' }, auth(adminToken))
  check('title and category are editable', [renamed.body.upload.title, renamed.body.upload.category], ['Renamed clip', 'Music'])

  const deleted = await call(uploadsHandler, { action: 'delete', id: uploadId }, auth(adminToken))
  check('an admin can delete an upload', deleted.body, { ok: true, id: uploadId })
  check('it disappears from the listing', (await call(uploadsHandler)).body.uploads.length, 0)
  const gone = await fileHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: { id: uploadId } })
  check('and its file is gone (chunks cascaded)', gone.statusCode, 404)
  check('the chunk rows were removed too', fakeNeon.__store().chunks.length, 0)
}

// ---------------------------------------------------------------------------
console.log('Vercel entries — api/auth/telegram.mjs, api/uploads.mjs, api/uploads/[id].mjs')
{
  const vercelAuth = (await import('../api/auth/telegram.mjs')).default
  const vercelUploads = (await import('../api/uploads.mjs')).default
  const vercelFile = (await import('../api/uploads/[id].mjs')).default
  const vercelCatchAll = (await import('../api/[...path].mjs')).default

  const invoke = async (entry, method, url, body, headers = {}, query = {}) => {
    const payload = body === undefined ? undefined : JSON.stringify(body)
    const req = Object.assign(Readable.from(payload ? [Buffer.from(payload, 'utf8')] : []), {
      method,
      url,
      headers: { 'content-type': 'application/json', ...headers },
      // Vercel puts dynamic route segments in req.query alongside the URL query.
      query: { ...Object.fromEntries(new URL(url, 'http://local.test').searchParams), ...query }
    })
    const res = {
      statusCode: 0,
      headers: {},
      chunks: [],
      writeHead(code, head) { this.statusCode = code; Object.assign(this.headers, head); return this },
      end(chunk) { if (chunk) this.chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); return this }
    }
    await entry(req, res)
    const raw = Buffer.concat(res.chunks)
    return { status: res.statusCode, headers: res.headers, raw }
  }

  const login = await invoke(vercelAuth, 'POST', '/api/auth/telegram', { action: 'login', auth: widgetPayload() })
  const loginBody = JSON.parse(login.raw.toString())
  check('the Vercel entry completes a Telegram login', [login.status, loginBody.user.role], [200, 'admin'])
  const token = loginBody.token

  const started = await invoke(vercelUploads, 'POST', '/api/uploads', {
    action: 'start', contentType: 'video/mp4', filename: 'vercel.mp4', size: 4096, title: 'Vercel clip', category: 'Trailers'
  }, auth(token))
  const startedBody = JSON.parse(started.raw.toString())
  check('the Vercel entry starts an upload', [started.status, startedBody.chunks], [200, 1])

  const chunk = await invoke(vercelUploads, 'POST', '/api/uploads', { action: 'chunk', id: startedBody.id, index: 0, data: fileBytes.subarray(0, 4096).toString('base64') }, auth(token))
  check('the Vercel entry accepts a chunk', JSON.parse(chunk.raw.toString()).received, 1)
  const finished = await invoke(vercelUploads, 'POST', '/api/uploads', { action: 'finish', id: startedBody.id }, auth(token))
  check('the Vercel entry finalises it', JSON.parse(finished.raw.toString()).upload.status, 'ready')

  const streamed = await invoke(vercelFile, 'GET', `/api/uploads/${startedBody.id}`, undefined, { range: 'bytes=0-99' }, { id: startedBody.id })
  check('the file entry returns a 206', [streamed.status, streamed.headers['content-range']], [206, 'bytes 0-99/4096'])
  ok('the streamed bytes are the original file bytes', streamed.raw.equals(fileBytes.subarray(0, 100)))

  const routed = await invoke(vercelCatchAll, 'GET', `/api/uploads/${startedBody.id}`, undefined, { range: 'bytes=0-9' })
  check('the catch-all also serves upload files', routed.status, 206)
  const routedAuth = await invoke(vercelCatchAll, 'GET', '/api/auth/telegram')
  check('the catch-all also serves the login config', JSON.parse(routedAuth.raw.toString()).botUsername, 'x_sutra_bot')
  const unknown = await invoke(vercelCatchAll, 'GET', '/api/nope')
  check('unknown API paths still 404', unknown.status, 404)
  const channelsRoute = await invoke(vercelCatchAll, 'GET', '/api/channels')
  check('the catch-all serves /api/channels with the built-in source', JSON.parse(channelsRoute.raw.toString()).channels.map((row) => row.id), ['-1004400682253'])
}

// ---------------------------------------------------------------------------
console.log('channels — built-in source is seeded; admin creates/deletes')
{
  const publicList = await call(channelsHandler)
  check('the built-in channel is seeded automatically', publicList.body.channels.map((row) => row.id), ['-1004400682253'])
  check('and shows a default name', publicList.body.channels[0].title, 'Telegram Source')

  const anonCreate = await call(channelsHandler, { action: 'create', id: '-1001', title: 'X' })
  check('anonymous create is refused', anonCreate.status, 401)
  const memberCreate = await call(channelsHandler, { action: 'create', id: '-1001', title: 'X' }, auth(userToken))
  check('a normal user cannot create channels', memberCreate.status, 403)

  const created = await call(channelsHandler, { action: 'create', id: '-100222333444', title: 'My Second Channel', category: 'vip' }, auth(adminToken))
  check('an admin adds a channel', created.body.channels.length, 2)
  const renamed = await call(channelsHandler, { action: 'update', id: '-100222333444', title: 'Renamed Channel' }, auth(adminToken))
  check('and renames it', renamed.body.channel.title, 'Renamed Channel')
  const badId = await call(channelsHandler, { action: 'create', id: 'notanid' }, auth(adminToken))
  check('a non-numeric id is refused', badId.status, 400)
  const removed = await call(channelsHandler, { action: 'delete', id: '-100222333444' }, auth(adminToken))
  check('and deletes it', removed.body, { ok: true, id: '-100222333444' })
  check('leaving only the built-in channel', (await call(channelsHandler, { action: 'list' }, auth(adminToken))).body.channels.length, 1)
}

console.log('bootstrap — with zero admins, the first Telegram login becomes the owner')
{
  const savedSeed = process.env.TELEGRAM_ADMIN_IDS
  delete process.env.TELEGRAM_ADMIN_IDS
  fakeNeon.__reset() // re-seeds from env -> no admins anywhere

  const first = await call(authHandler, { action: 'login', auth: widgetPayload({ id: '111222', first_name: 'Pioneer' }) })
  check('the first real login is promoted to admin', first.body.user.role, 'admin')

  const second = await call(authHandler, { action: 'login', auth: widgetPayload({ id: '333444', first_name: 'Late' }) })
  check('the door shuts — the next login is a normal user', second.body.user.role, 'normal')

  const third = await call(authHandler, { action: 'login', auth: widgetPayload({ id: '555666', first_name: 'Third' }) })
  check('and stays closed for everyone after', third.body.user.role, 'normal')

  const promotedCanManage = await call(authHandler, { action: 'listAdmins' }, auth(first.body.token))
  check('the bootstrapped admin can now manage the admin list', promotedCanManage.status, 200)

  process.env.TELEGRAM_ADMIN_IDS = savedSeed
  fakeNeon.__reset()
}

console.log('client source — the bot token never reaches the browser')
{
  const { readFile, readdir } = await import('node:fs/promises')
  const walk = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true })
    const files = []
    for (const entry of entries) {
      const full = `${dir}/${entry.name}`
      if (entry.isDirectory()) files.push(...await walk(full))
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full)
    }
    return files
  }
  const sources = await walk('src')
  const leaked = []
  const readsToken = /process\.env\s*\.\s*TELEGRAM_BOT_TOKEN|process\.env\s*\[\s*['"]TELEGRAM_BOT_TOKEN|import\.meta\.env\.[A-Z_]*TELEGRAM_BOT_TOKEN/
  const exposesEnv = /VITE_TELEGRAM/
  for (const file of sources) {
    const text = await readFile(file, 'utf8')
    if (readsToken.test(text) || exposesEnv.test(text)) leaked.push(file)
  }
  check('no frontend file reads TELEGRAM_BOT_TOKEN from the environment', leaked, [])
  const loginScreen = await readFile('src/screens/LoginScreen.tsx', 'utf8')
  ok('the login screen renders the Telegram button', /TelegramLoginButton/.test(loginScreen))
  const clientSource = await readFile('src/lib/telegramLogin.ts', 'utf8')
  ok('the widget is loaded from telegram.org', /telegram\.org\/js\/telegram-widget\.js/.test(clientSource))
  const client = await readFile('src/lib/telegramLogin.ts', 'utf8')
  ok('the client never asks for a password or OTP', !/password|otp/i.test(client.replace(/\/\/.*$/gm, '')))
  ok('only the signed JWT is stored on the device', /x-sutra\.user\.session\.v1/.test(client))
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll Telegram login + upload checks passed.')
