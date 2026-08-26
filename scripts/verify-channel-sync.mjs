// Verifies the Telegram channel import that fills xs_channels.
//
// Nothing else in the backend writes that table, so if this mapping or the sync
// flow breaks, the Premium "Telegram sources" list silently goes empty. The
// real functions from netlify/functions/_server/telegram.mjs are imported and
// run against fake Telegram dialogs / a fake database — no MTProto connection
// and no PostgreSQL are needed.
//
// Run: npm run check:channel-sync

import { pickChannelRows, syncChannels } from '../netlify/functions/_server/telegram.mjs'

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

const channel = (id, title, megagroup = false) => ({ entity: { className: 'Channel', id: { toString: () => String(id) }, title, megagroup } })
const user = (id, title) => ({ entity: { className: 'User', id: { toString: () => String(id) }, title } })
const basicGroup = (id, title) => ({ entity: { className: 'Chat', id: { toString: () => String(id) }, title } })

console.log('pickChannelRows — filtering and mapping')
const dialogs = [
  { name: 'Private Source 🔞', entity: channel(1001, 'ignored-entity-title').entity, isChannel: true },
  { name: 'Owner DM', entity: user(77, 'Owner DM').entity, isUser: true },
  { name: 'Old basic group', entity: basicGroup(55, 'Old basic group').entity, isGroup: true },
  { name: 'VIP Supergroup', entity: channel(2002, 'VIP Supergroup', true).entity, isChannel: true },
  { name: 'Private Source 🔞', entity: channel(1001, 'Private Source 🔞').entity, isChannel: true }, // duplicate id
  { entity: channel(3003, 'Untitled fallback').entity, isChannel: true }, // no dialog name/title
  { entity: undefined, isChannel: true } // dialog with no entity at all
]
check('keeps channels and supergroups only, dedupes, and prefers the dialog name', pickChannelRows(dialogs), [
  { id: '1001', title: 'Private Source 🔞', avatar: null, category: 'channel' },
  { id: '2002', title: 'VIP Supergroup', avatar: null, category: 'group' },
  { id: '3003', title: 'Untitled fallback', avatar: null, category: 'channel' }
])
check('caps the import at the requested limit', pickChannelRows(dialogs, 2).length, 2)
check('survives a non-array dialog list', pickChannelRows(undefined), [])

console.log('pickChannelRows — long titles are truncated to the column size')
check('title is cut at 120 characters', pickChannelRows([{ name: 'x'.repeat(200), entity: channel(9, 'x').entity }])[0].title.length, 120)

console.log('syncChannels — full flow with a fake Telegram client and database')
const fakeDialogs = [
  { name: 'A', entity: channel(1, 'A').entity, isChannel: true },
  { name: 'B', entity: channel(2, 'B', true).entity, isChannel: true },
  { name: 'DM', entity: user(3, 'DM').entity, isUser: true }
]

const makeFakeClient = ({ authorized = true } = {}) => {
  const client = {
    authorizedChecked: false,
    disconnected: false,
    isUserAuthorized: async () => { client.authorizedChecked = true; return authorized },
    getDialogs: async () => fakeDialogs,
    disconnect: async () => { client.disconnected = true },
    session: { save: () => 'refreshed-session' }
  }
  return client
}

const runSync = async ({ state = { encrypted_session: 'enc', status: 'authorized' }, authorized = true } = {}) => {
  const client = makeFakeClient({ authorized })
  let savedRows = null
  let persisted = null
  const result = await syncChannels({
    createClient: async () => client,
    readState: async () => state,
    save: async (rows) => { savedRows = rows; return rows.length },
    persist: async (c) => { persisted = c.session.save() }
  })
  return { result, client, savedRows, persisted }
}

const happy = await runSync()
check('returns the sync summary', happy.result, { ok: true, status: 'synced', scanned: 3, channels: 2, saved: 2 })
check('writes only the channel rows', happy.savedRows.map((row) => row.id), ['1', '2'])
check('writes the refreshed session back (keeps the one-time login alive)', happy.persisted, 'refreshed-session')
check('disconnects the client', happy.client.disconnected, true)

const notLoggedIn = await runSync({ state: { encrypted_session: 'enc', status: 'otp_sent' } }).catch((error) => ({ error }))
check('refuses to run before the owner has logged in (409)', notLoggedIn.error?.statusCode, 409)

const missingSession = await runSync({ state: null }).catch((error) => ({ error }))
check('refuses to run with no stored session (409)', missingSession.error?.statusCode, 409)

const revoked = await runSync({ authorized: false }).catch((error) => ({ error }))
check('reports a revoked Telegram session as 409 instead of an empty list', revoked.error?.statusCode, 409)

console.log('telegram-admin handler — the sync_channels action is owner-gated')

process.env.SESSION_ENCRYPTION_KEY = 'test-encryption-key'
process.env.AUTH_JWT_SECRET = 'test-jwt-secret'
delete process.env.ADMIN_SETUP_SECRET
delete process.env.DATABASE_URL

const { handler } = await import('../netlify/functions/telegram-admin.mjs')
const post = async (body, headers = {}) => {
  const response = await handler({ httpMethod: 'POST', headers, body: JSON.stringify(body) })
  return { status: response.statusCode, body: JSON.parse(response.body) }
}

check('anonymous sync request is rejected with 401', await post({ action: 'sync_channels' }), { status: 401, body: { error: 'Owner session required.' } })
check('unknown actions still 400', await post({ action: 'nope' }), { status: 400, body: { error: 'Unknown action.' } })

const { SignJWT } = await import('jose')
const ownerToken = await new SignJWT({ role: 'admin', scope: 'telegram-owner', tid: '42' })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject('telegram-owner')
  .setIssuer('x-sutra')
  .setAudience('x-sutra-telegram-console')
  .setIssuedAt()
  .setExpirationTime('1h')
  .sign(new TextEncoder().encode(process.env.AUTH_JWT_SECRET))

// With a valid owner token the request must reach the database layer — a missing
// DATABASE_URL is the first thing it complains about, which proves the action is
// wired to syncChannels() rather than falling through to "Unknown action".
const asOwner = await post({ action: 'sync_channels' }, { authorization: `Bearer ${ownerToken}` })
check('owner token routes into syncChannels (fails at the DB boundary without DATABASE_URL)', asOwner, { status: 503, body: { error: 'Server configuration incomplete: DATABASE_URL' } })

const forged = await post({ action: 'sync_channels' }, { authorization: 'Bearer not-a-real-token' })
check('a forged token is rejected', forged.status, 401)

if (failures) {
  console.error(`\n${failures} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll channel-import checks passed.')