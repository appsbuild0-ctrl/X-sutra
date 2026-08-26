// Verifies the one-tap Telegram owner login end to end.
//
// The real netlify/functions/telegram-admin.mjs handler and the real Vercel
// function entries (api/internal/telegram-auth.mjs, api/telegram/channels.mjs,
// api/[...path].mjs) are driven here. `teleproto` and the PostgreSQL layer are
// swapped for in-memory fakes with module.registerHooks, so no Telegram account
// and no database are needed.
//
// Covers exactly what the console promises the owner:
//   1. the phone number comes from TELEGRAM_PHONE only — never from the client,
//   2. the only field the owner types is the OTP,
//   3. a correct OTP authorizes, saves the encrypted session and issues the
//      owner token in the same response,
//   4. that owner token imports the channels into xs_channels and the Premium
//      endpoint then serves them,
//   5. failures report the exact Telegram/backend error, not a generic message.
//
// Run: npm run check:telegram-login

import { registerHooks } from 'node:module'
import { Readable } from 'node:stream'

const FIXTURE = (name) => new URL(`./fixtures/${name}`, import.meta.url).href

// Swap the MTProto client and the database before anything imports them.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'teleproto') return { url: FIXTURE('fake-telegram.mjs'), format: 'module', shortCircuit: true }
    if (specifier === 'teleproto/Password.js') return { url: FIXTURE('fake-telegram-password.mjs'), format: 'module', shortCircuit: true }
    if (specifier.endsWith('/_server/database.mjs') || specifier === './database.mjs') return { url: FIXTURE('fake-database.mjs'), format: 'module', shortCircuit: true }
    return nextResolve(specifier, context)
  }
})

// Server environment as it would be configured in Vercel.
process.env.SESSION_ENCRYPTION_KEY = 'test-encryption-key-with-length'
process.env.AUTH_JWT_SECRET = 'test-jwt-secret-with-length'
process.env.TELEGRAM_API_ID = '1234567'
process.env.TELEGRAM_API_HASH = 'test-api-hash'
process.env.TELEGRAM_PHONE = '+91 98765 43210'
process.env.ADMIN_TELEGRAM_USER_ID = '4242'
// The PostgreSQL layer is faked (scripts/fixtures/fake-database.mjs), so this
// only has to be present for validateTelegramEnv(); it is never connected to.
process.env.DATABASE_URL = 'postgres://x-sutra:fake@localhost:5432/x_sutra_fake'
delete process.env.ADMIN_SETUP_SECRET

const { handler } = await import('../netlify/functions/telegram-admin.mjs')
const { requireOwner, signOwnerToken } = await import('../netlify/functions/_server/security.mjs')
const fakeDb = await import('./fixtures/fake-database.mjs')

let failures = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) {
    console.log(`  ok   ${label}`)
  } else {
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

const OWNER_PHONE = '+919876543210'
const sim = () => (globalThis.__telegramSim ??= {})
const resetSim = (patch = {}) => {
  globalThis.__telegramSim = { code: '12345', userId: '4242', dialogs: [], ...patch }
  fakeDb.__reset()
}
const unblockRateLimit = () => {
  for (const row of fakeDb.__store().rate.values()) row.last_at = Date.now() - 61_000
}

const post = async (body, headers = {}) => {
  const response = await handler({ httpMethod: 'POST', headers, body: JSON.stringify(body) })
  return { status: response.statusCode, body: JSON.parse(response.body) }
}
const get = async (headers = {}) => {
  const response = await handler({ httpMethod: 'GET', headers })
  return { status: response.statusCode, body: JSON.parse(response.body) }
}

const channel = (id, title, megagroup = false) => ({ name: title, entity: { className: 'Channel', id: { toString: () => String(id) }, title, megagroup }, isChannel: true })
const DIALOGS = [channel(1001, 'Private Source'), channel(2002, 'VIP Supergroup', true), { name: 'Owner DM', entity: { className: 'User', id: { toString: () => '77' } }, isUser: true }]

// ---------------------------------------------------------------------------
console.log('configuration — the owner phone is server-side and masked in responses')
resetSim()
{
  const status = await get()
  check('GET reports a fully configured server', status.body.configuration.configured, true)
  check('GET masks TELEGRAM_PHONE for display', status.body.configuration.phoneHint, '+91••••••••10')
  check('GET reports the source as not connected yet', status.body.connection.connected, false)
  ok('the full phone number is never returned', !JSON.stringify(status.body).includes('9876543210'), JSON.stringify(status.body))
}

// ---------------------------------------------------------------------------
console.log('send_otp — phone comes from TELEGRAM_PHONE, never from the request body')
{
  const sent = await post({ action: 'send_otp' })
  check('OTP request succeeds', sent.status, 200)
  check('status is otp_sent', sent.body.status, 'otp_sent')
  check('Telegram was asked for the server phone (normalized)', sim().sentPhones ?? null, [OWNER_PHONE])
  ok('the masked hint is included', sent.body.phoneHint === '+91••••••••10', JSON.stringify(sent.body))
  ok('no owner token is issued before the code is verified', !sent.body.ownerToken)
  ok('the full phone number is never returned', !JSON.stringify(sent.body).includes('9876543210'))

  unblockRateLimit()
  const spoofed = await post({ action: 'send_otp', phone: '+1 555 000 1111' })
  check('a client-supplied phone is accepted by the API…', spoofed.status, 200)
  check('…but Telegram still only ever sees TELEGRAM_PHONE', sim().sentPhones ?? null, [OWNER_PHONE, OWNER_PHONE])
  ok('the spoofed number is never dialled', !(sim().sentPhones ?? []).includes('+15550001111'))

  const throttled = await post({ action: 'send_otp' })
  check('a second code within a minute is rate limited', throttled, { status: 429, body: { error: 'A code was just sent. Wait a minute before requesting another.' } })
}

// ---------------------------------------------------------------------------
console.log('verify_otp — wrong code reports the exact Telegram error')
{
  const wrong = await post({ action: 'verify_otp', code: '000000' })
  check('wrong OTP is rejected with 400', wrong.status, 400)
  check('the Telegram error code is reported verbatim', wrong.body.telegramError, 'PHONE_CODE_INVALID')
  ok('the message contains the real Telegram error, not a generic failure', wrong.body.error.includes('PHONE_CODE_INVALID'), wrong.body.error)
  ok('the generic "Telegram authorization failed." string is gone', !wrong.body.error.includes('Telegram authorization failed.'), wrong.body.error)

  sim().wrongCodeError = 'PHONE_CODE_EXPIRED'
  const expired = await post({ action: 'verify_otp', code: '000000' })
  check('an expired code says so', expired.body.telegramError, 'PHONE_CODE_EXPIRED')
  ok('…and the message explains it', expired.body.error.includes('PHONE_CODE_EXPIRED') && expired.body.error.includes('expired'), expired.body.error)
  delete sim().wrongCodeError
}

// ---------------------------------------------------------------------------
console.log('verify_otp — correct code connects, saves the session and issues the owner token')
let ownerToken = ''
{
  const authorized = await post({ action: 'verify_otp', code: '12345' })
  check('OTP verification succeeds', authorized.status, 200)
  check('status is authorized', authorized.body.status, 'authorized')
  ok('an owner session token is returned', typeof authorized.body.ownerToken === 'string' && authorized.body.ownerToken.split('.').length === 3)
  check('the token lifetime is 180 days', authorized.body.expiresInDays, 180)
  ownerToken = authorized.body.ownerToken

  const stored = fakeDb.__store().auth
  check('the encrypted MTProto session is stored', stored.status, 'authorized')
  check('the owner Telegram id is stored', stored.telegram_user_id, '4242')
  ok('the stored session is encrypted, not a plain string', stored.encrypted_session && stored.encrypted_session !== 'fake-session-string')
  check('the OTP hash is cleared after login', stored.phone_code_hash, null)
  ok('the issued token unlocks the owner console', (await requireOwner({ headers: { authorization: `Bearer ${ownerToken}` } })).via === 'token')
}

// ---------------------------------------------------------------------------
console.log('sync_channels — the saved owner login imports the channels')
{
  sim().dialogs = DIALOGS
  const synced = await post({ action: 'sync_channels' }, { authorization: `Bearer ${ownerToken}` })
  check('import succeeds', synced.status, 200)
  check('import summary counts dialogs, channels and rows', synced.body, { ok: true, status: 'synced', scanned: 3, channels: 2, saved: 2 })
  check('both channels are written', [...fakeDb.__store().channels.keys()].sort(), ['1001', '2002'])

  const denied = await post({ action: 'sync_channels' })
  check('import without the owner token is refused', denied, { status: 401, body: { error: 'Owner session required.' } })
}

// ---------------------------------------------------------------------------
console.log('already authorized — the one-time login never asks for another code')
{
  const before = (sim().sentPhones ?? []).length
  unblockRateLimit()
  const again = await post({ action: 'send_otp' })
  check('send_otp reports the existing session', again.body.status, 'already_authorized')
  ok('a fresh owner token is handed back', typeof again.body.ownerToken === 'string' && again.body.ownerToken.length > 40)
  check('no new code was sent to Telegram', (sim().sentPhones ?? []).length, before)
}

// ---------------------------------------------------------------------------
console.log('2FA — one extra field, same exact error reporting')
{
  resetSim({ require2fa: true, dialogs: DIALOGS })
  await post({ action: 'send_otp' })
  const needs2fa = await post({ action: 'verify_otp', code: '12345' })
  check('Telegram 2FA is surfaced to the console', needs2fa, { status: 200, body: { ok: true, status: '2fa_required' } })
  check('the database waits in 2fa_required', fakeDb.__store().auth.status, '2fa_required')

  const wrongPassword = await post({ action: 'verify_2fa', password: 'nope' })
  check('a wrong 2FA password is a 400', wrongPassword.status, 400)
  ok('the real Telegram error is shown', wrongPassword.body.error.includes('PASSWORD_HASH_INVALID'), wrongPassword.body.error)

  const withPassword = await post({ action: 'verify_2fa', password: 'cloud-password' })
  check('the right 2FA password finishes the login', withPassword.body.status, 'authorized')
  ok('and issues the owner token', typeof withPassword.body.ownerToken === 'string' && withPassword.body.ownerToken.length > 40)
  check('the session is authorized', fakeDb.__store().auth.status, 'authorized')
}

// ---------------------------------------------------------------------------
console.log('wrong Telegram account — reported instead of swallowed')
{
  resetSim({ userId: '999' })
  await post({ action: 'send_otp' })
  const wrongOwner = await post({ action: 'verify_otp', code: '12345' })
  check('a non-owner account cannot finish the login', wrongOwner.status, 403)
  ok('the message names both ids', wrongOwner.body.error.includes('999') && wrongOwner.body.error.includes('4242'), wrongOwner.body.error)
  check('the session stays at otp_sent — it is never marked authorized', fakeDb.__store().auth?.status ?? null, 'otp_sent')
  ok('no owner token is handed to the wrong account', !wrongOwner.body.ownerToken)
}

// ---------------------------------------------------------------------------
console.log('missing configuration — actionable 503 instead of a generic failure')
{
  const savedPhone = process.env.TELEGRAM_PHONE
  delete process.env.TELEGRAM_PHONE
  const status = await get()
  check('GET lists the missing variable', status.body.configuration.missing, ['TELEGRAM_PHONE'])
  unblockRateLimit()
  const noPhone = await post({ action: 'send_otp' })
  check('send_otp fails with 503', noPhone.status, 503)
  ok('and says which variable to set', noPhone.body.error.includes('TELEGRAM_PHONE'), noPhone.body.error)
  process.env.TELEGRAM_PHONE = savedPhone
}

console.log('connection failure — the real cause is reported, not a generic failure')
{
  resetSim({ connectError: 'Could not connect to the Telegram DC (socket hang up)' })
  unblockRateLimit()
  const unreachable = await post({ action: 'send_otp' })
  check('an unreachable Telegram server surfaces as a server error', unreachable.status, 500)
  ok('the message names the real cause', unreachable.body.error.includes('Could not connect to the Telegram DC'), unreachable.body.error)
  ok('and not the generic "Backend operation failed."', !unreachable.body.error.includes('Backend operation failed.'), unreachable.body.error)
}

// ---------------------------------------------------------------------------
// The Vercel entry points are what actually runs in production. Drive them with
// Node-style req/res objects so the adapter code is covered too.
// ---------------------------------------------------------------------------
console.log('Vercel function entries — api/internal/telegram-auth.mjs and api/telegram/channels.mjs')

const vercelAuth = (await import('../api/internal/telegram-auth.mjs')).default
const vercelChannels = (await import('../api/telegram/channels.mjs')).default
const vercelCatchAll = (await import('../api/[...path].mjs')).default

const callVercel = async (entry, method, url, body, headers = {}) => {
  const payload = body === undefined ? undefined : JSON.stringify(body)
  const req = Object.assign(Readable.from(payload ? [Buffer.from(payload, 'utf8')] : []), {
    method,
    url,
    headers: { 'content-type': 'application/json', ...headers },
    query: Object.fromEntries(new URL(url, 'http://local.test').searchParams)
  })
  const res = {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(code, head) { this.statusCode = code; Object.assign(this.headers, head); return this },
    end(chunk) { this.body = chunk ? chunk.toString() : ''; return this }
  }
  await entry(req, res)
  return { status: res.statusCode, headers: res.headers, body: res.body ? JSON.parse(res.body) : null }
}

{
  resetSim({ dialogs: DIALOGS })
  const status = await callVercel(vercelAuth, 'GET', '/api/internal/telegram-auth')
  check('Vercel entry serves GET', status.status, 200)
  ok('Vercel entry reports the masked phone', status.body.configuration.phoneHint === '+91••••••••10', JSON.stringify(status.body.configuration))

  const sent = await callVercel(vercelAuth, 'POST', '/api/internal/telegram-auth', { action: 'send_otp' })
  check('Vercel entry streams the POST body into the handler', sent.body.status, 'otp_sent')

  const wrong = await callVercel(vercelAuth, 'POST', '/api/internal/telegram-auth', { action: 'verify_otp', code: '000000' })
  check('Vercel entry keeps the 400 status', wrong.status, 400)
  ok('Vercel entry keeps the exact Telegram error', wrong.body.error.includes('PHONE_CODE_INVALID') && wrong.body.telegramError === 'PHONE_CODE_INVALID', JSON.stringify(wrong.body))

  const authorized = await callVercel(vercelAuth, 'POST', '/api/internal/telegram-auth', { action: 'verify_otp', code: '12345' })
  check('Vercel entry authorizes the OTP', authorized.body.status, 'authorized')
  const token = authorized.body.ownerToken

  const synced = await callVercel(vercelAuth, 'POST', '/api/internal/telegram-auth', { action: 'sync_channels' }, { authorization: `Bearer ${token}` })
  check('Vercel entry imports the channels with that token', synced.body, { ok: true, status: 'synced', scanned: 3, channels: 2, saved: 2 })

  // The Premium list is served by the other Vercel entry with a normal admin JWT.
  const { SignJWT } = await import('jose')
  const adminJwt = await new SignJWT({ role: 'admin' }).setProtectedHeader({ alg: 'HS256' }).setSubject('owner').setIssuer('x-sutra').setExpirationTime('5m').sign(new TextEncoder().encode(process.env.AUTH_JWT_SECRET))
  const channels = await callVercel(vercelChannels, 'GET', '/api/telegram/channels', undefined, { authorization: `Bearer ${adminJwt}` })
  check('imported channels reach /api/telegram/channels', channels.body.channels.map((row) => row.id).sort(), ['1001', '2002'])

  const anonymous = await callVercel(vercelChannels, 'GET', '/api/telegram/channels')
  check('the channel list stays private without a token', anonymous.status, 401)

  const unknown = await callVercel(vercelAuth, 'POST', '/api/internal/telegram-auth', { action: 'nope' })
  check('unknown actions still 400 through the Vercel entry', { status: unknown.status, body: unknown.body }, { status: 400, body: { error: 'Unknown action.' } })

  const routed = await callVercel(vercelCatchAll, 'POST', '/api/internal/telegram-auth', { action: 'send_otp' })
  ok('the catch-all routes the Telegram endpoint too', routed.status === 429 || routed.body?.status === 'otp_sent', JSON.stringify(routed.body))
  const missing = await callVercel(vercelCatchAll, 'GET', '/api/does-not-exist')
  check('the catch-all 404s unknown paths', missing.status, 404)
}

// ---------------------------------------------------------------------------
console.log('client source — the console asks only for the OTP')
{
  const { readFile } = await import('node:fs/promises')
  const card = await readFile('src/components/TelegramAdminCard.tsx', 'utf8')
  const client = await readFile('src/lib/telegramAdmin.ts', 'utf8')
  const code = `${card}\n${client}`.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  ok('no phone number input is rendered', !/inputMode="tel"|setPhone\(|Owner phone, e\.g\./.test(code))
  ok('the client never sends a phone field', !/action: 'send_otp', phone/.test(code))
  ok('OTP is the only credential the owner types', /action: 'verify_otp', code/.test(code))
  ok('the panel closes itself after a successful login', /onConnected\?\.\(\)/.test(card))
  ok('channels are imported automatically after the OTP', /finishLogin[\s\S]*syncTelegramChannels\(\)/.test(card))
  ok('the owner token is still what gets saved on the device', /writeOwnerSession\(issued\.ownerToken, issued\.expiresAt\)/.test(client))
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll Telegram login checks passed.')
