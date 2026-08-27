// End-to-end verification of the REAL Discord integration.
//
// The real netlify/functions/discord-media.mjs handler and netlify/functions/
// _server/discord.mjs run here. Only two seams are replaced, both standard test
// doubles (NOT part of production code):
//   * `postgres` -> an in-memory store (the real SQL statements are issued).
//   * `globalThis.fetch` -> a scripted Discord REST API.
//
// This proves the backend flow works: token/guild/channel/permission validation,
// admin authorisation, chunked upload, real message-id mapping, deletion
// (incl. already-deleted), oversize rejection, and bounded 429 retries.
//
// Run: npm run check:discord

import { registerHooks } from 'node:module'

// ---- in-memory postgres ----------------------------------------------------
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'postgres') return { url: new URL('./fixtures/fake-pg.mjs', import.meta.url).href, format: 'module', shortCircuit: true }
    return nextResolve(specifier, context)
  }
})

const GUILD = '1000000000000000001'
const CHANNEL = '1000000000000000002'
const ADMIN = '2000000000000000003'

process.env.AUTH_JWT_SECRET = 'test-jwt-secret-with-length'
process.env.DATABASE_URL = 'postgres://user:pass@example.neon.tech/x'
process.env.DISCORD_BOT_TOKEN = '1234567890:TEST-TOKEN'
process.env.DISCORD_GUILD_ID = GUILD
process.env.DISCORD_CHANNEL_ID = CHANNEL
process.env.DISCORD_ADMIN_USER_ID = ADMIN

// ---- scripted Discord REST API --------------------------------------------
const sim = (globalThis.__discordSim = {
  unauthorized: false,
  guildMissing: false,
  channelMissing: false,
  perms: '8', // @everyone administrator by default
  rateLimitOnce: false,
  deletedMessages: new Set(),
  messageCounter: 0
})

globalThis.fetch = async (input, init = {}) => {
  const url = String(typeof input === 'string' ? input : input.url)
  const path = url.replace('https://discord.com/api/v10', '')
  const method = (init.method || 'GET').toUpperCase()
  const auth = String(init.headers?.Authorization || '')
  const jsonBody = (status, body) => ({ ok: status < 300, status, json: async () => body })

  if (!auth.startsWith('Bot ')) return jsonBody(401, { code: 0, message: 'No auth' })
  if (sim.unauthorized) return jsonBody(401, { code: 0, message: '401: Unauthorized' })

  if (method === 'GET' && path === '/users/@me') return jsonBody(200, { id: 'bot1', username: 'x-sutra-bot' })
  if (method === 'GET' && path === `/guilds/${GUILD}`) {
    if (sim.guildMissing) return jsonBody(404, { code: 10004, message: 'Unknown Guild' })
    return jsonBody(200, { id: GUILD, roles: [{ id: GUILD, permissions: sim.perms }] })
  }
  if (method === 'GET' && path === `/channels/${CHANNEL}`) {
    if (sim.channelMissing) return jsonBody(404, { code: 10003, message: 'Unknown Channel' })
    return jsonBody(200, { id: CHANNEL, guild_id: GUILD, permission_overwrites: [] })
  }
  if (method === 'GET' && path === `/guilds/${GUILD}/members/bot1`) {
    return jsonBody(200, { roles: [], user: { id: 'bot1' } })
  }
  if (method === 'POST' && path === `/channels/${CHANNEL}/messages`) {
    if (sim.rateLimitOnce) {
      sim.rateLimitOnce = false
      return jsonBody(429, { retry_after: 0.05, message: 'Rate limited' })
    }
    sim.messageCounter += 1
    const id = `msg${sim.messageCounter}`
    return jsonBody(200, { id, attachments: [{ url: `https://cdn.discordapp.com/attachments/${CHANNEL}/${id}/file.mp4`, size: 1234 }] })
  }
  if (method === 'DELETE' && path.startsWith(`/channels/${CHANNEL}/messages/`)) {
    const id = path.split('/').pop()
    if (sim.deletedMessages.has(id)) return jsonBody(404, { code: 10008, message: 'Unknown Message' })
    sim.deletedMessages.add(id)
    return { ok: true, status: 204, json: async () => ({}) }
  }
  return jsonBody(404, { code: 0, message: `unhandled ${method} ${path}` })
}

const { handler } = await import('../netlify/functions/discord-media.mjs')
const fake = await import('./fixtures/fake-pg.mjs')

let failures = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual); const e = JSON.stringify(expected)
  if (a === e) console.log(`  ok   ${label}`)
  else { failures += 1; console.log(`  FAIL ${label}\n       expected ${e}\n       actual   ${a}`) }
}
const ok = (label, cond, detail = '') => {
  if (cond) console.log(`  ok   ${label}`)
  else { failures += 1; console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`) }
}

const call = async (body, useGet = false) => {
  const response = await handler({ httpMethod: useGet ? 'GET' : 'POST', headers: {}, body: body ? JSON.stringify(body) : undefined, queryStringParameters: {} })
  let data = null
  try { data = response.body ? JSON.parse(response.body) : null } catch { data = response.body }
  return { status: response.statusCode, body: data }
}
const admin = { password: 'admin123' } // matches adminPassword() default

fake.__reset()

console.log('health check — token, guild, channel, permissions')
{
  const status = await call({ action: 'status', ...admin })
  check('configured health reports Connected/Found/Found/OK', [status.body.api, status.body.guild, status.body.channel, status.body.permissions], ['Connected', 'Found', 'Found', 'OK'])
  ok('the bot token is NOT in the health response', !JSON.stringify(status.body).includes('TEST-TOKEN'))

  sim.perms = '0'
  const missing = await call({ action: 'status', ...admin })
  check('weak @everyone perms report Missing', missing.body.permissions, 'Missing')
  sim.perms = '8'

  sim.guildMissing = true
  const noGuild = await call({ action: 'status', ...admin })
  check('missing guild reported', noGuild.body.guild, 'Not Found')
  sim.guildMissing = false

  sim.channelMissing = true
  const noChannel = await call({ action: 'status', ...admin })
  check('missing channel reported', noChannel.body.channel, 'Not Found')
  sim.channelMissing = false

  sim.unauthorized = true
  const badToken = await call({ action: 'status', ...admin })
  ok('invalid token gives readable error', String(badToken.body.error).includes('Discord bot token is invalid.'), JSON.stringify(badToken.body))
  sim.unauthorized = false

  const anon = await call({ action: 'status' })
  check('status without admin password is rejected', anon.status, 403)
}

console.log('upload — chunked, real message id, DB mapping, no fake success')
let uploadedId = ''
let messageId = ''
{
  const anonUpload = await call({ action: 'start', size: 1000 })
  check('upload without admin password rejected', anonUpload.status, 403)

  const bytes = Buffer.alloc(5000)
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = i % 251
  const started = await call({ action: 'start', size: bytes.length, filename: 'demo.mp4', contentType: 'video/mp4', ...admin })
  check('start returns chunks=1 for a small file', started.body.chunks, 1)

  await call({ action: 'chunk', id: started.body.id, index: 0, data: bytes.toString('base64'), ...admin })
  const finished = await call({ action: 'finish', id: started.body.id, title: 'Demo clip', contentType: 'video/mp4', filename: 'demo.mp4', ...admin })
  check('finish succeeds', finished.status, 200)
  ok('a real Discord message id is returned', /^msg\d+$/.test(finished.body.media.discordMessageId), JSON.stringify(finished.body.media))
  ok('the Discord CDN url is stored', finished.body.media.url.includes('cdn.discordapp.com'), finished.body.media.url)
  uploadedId = finished.body.media.id
  messageId = finished.body.media.discordMessageId

  const row = fake.__store().media.find((r) => r.id === uploadedId)
  ok('the DB mapping stores the Discord message id', row && row.discord_message_id === messageId)

  const publicList = await call(undefined, true)
  const pub = publicList.body.media.find((m) => m.id === uploadedId)
  ok('public list hides internal ids', pub && !('discordMessageId' in pub) && !('discordGuildId' in pub), JSON.stringify(pub))

  const oversize = await call({ action: 'start', size: 20 * 1024 * 1024, ...admin })
  check('oversize (>8MB) rejected with 413', oversize.status, 413)
}

console.log('rate limit — bounded retry, then success')
{
  sim.rateLimitOnce = true
  const bytes = Buffer.alloc(1000, 7)
  const started = await call({ action: 'start', size: bytes.length, filename: 'rl.mp4', contentType: 'video/mp4', ...admin })
  await call({ action: 'chunk', id: started.body.id, index: 0, data: bytes.toString('base64'), ...admin })
  const finished = await call({ action: 'finish', id: started.body.id, title: 'RL clip', contentType: 'video/mp4', filename: 'rl.mp4', ...admin })
  check('a 429 is retried once and succeeds', finished.status, 200)
}

console.log('delete — real Discord delete + graceful already-deleted')
{
  const del = await call({ action: 'delete', id: uploadedId, ...admin })
  check('first delete removes the Discord message', [del.status, del.body.alreadyDeleted], [200, false])
  ok('DB row marked deleted', fake.__store().media.find((r) => r.id === uploadedId).status === 'deleted')

  const again = await call({ action: 'delete', id: uploadedId, ...admin })
  check('deleting an already-deleted message is graceful', [again.status, again.body.alreadyDeleted], [200, true])
}

if (failures) { console.error(`\n${failures} check(s) failed.`); process.exit(1) }
console.log('\nAll Discord integration checks passed.')
