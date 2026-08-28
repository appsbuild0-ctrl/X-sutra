import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

const workDir = await mkdtemp(join(tmpdir(), 'x-sutra-retry-'))
process.env.PREMIUM_LOCAL_FILE = join(workDir, 'catalog.json')
process.env.PREMIUM_MEDIA_DIR = join(workDir, 'media')
process.env.DISCORD_BOT_TOKEN = 'test-bot-token'
process.env.DISCORD_GUILD_ID = '111'

const { handler: syncHandler } = await import('../../netlify/functions/discord-sync.mjs')
const { handler: premium } = await import('../../netlify/functions/premium.mjs')
const { handler: mediaHandler } = await import('../../netlify/functions/discord-media.mjs')
const { writeCatalog, readCatalog } = await import('../../netlify/functions/_premium-store.mjs')

const ADMIN = 'admin123'

/** A CDN that fails the first download of an attachment, then works — a temporary outage. */
const state = {
  cdnFailures: new Set(['a1']),
  messages: [{
    id: 'm1', content: 'Two shots', timestamp: '2026-08-28T10:00:00.000Z',
    author: { id: 'u1', username: 'me', global_name: 'Me' },
    attachments: [
      { id: 'a1', filename: 'flaky.jpg', content_type: 'image/jpeg', size: 10, width: 100, height: 200, url: 'https://cdn.discordapp.com/attachments/900/flaky.jpg' },
      { id: 'a2', filename: 'fine.png', content_type: 'image/png', size: 20, width: 300, height: 400, url: 'https://cdn.discordapp.com/attachments/900/fine.png' }
    ]
  }]
}

const jsonResponse = (status, body) => ({ ok: status < 400, status, json: async () => body, arrayBuffer: async () => new Uint8Array([1, 2, 3]) })

globalThis.fetch = async (url) => {
  const target = String(url)
  if (target.includes('/guilds/111/channels')) return jsonResponse(200, [{ id: '900', name: 'premium-media', type: 0, topic: '' }])
  if (/\/channels\/900\/messages\/m1$/.test(target)) {
    // The attachment list can change: drop a1 to simulate a deleted attachment.
    const attachments = state.messages[0].attachments.filter((a) => !a.deleted)
    return jsonResponse(200, { ...state.messages[0], attachments })
  }
  if (/\/channels\/900\/messages\?/.test(target)) {
    const messages = state.messages.map((message) => ({ ...message, attachments: message.attachments.filter((a) => !a.deleted) }))
    return jsonResponse(200, [...messages].reverse())
  }
  if (target.includes('cdn.discordapp.com')) {
    const id = target.includes('flaky') ? 'a1' : 'a2'
    if (state.cdnFailures.has(id)) return jsonResponse(500, { message: 'temporary' })
    return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new Uint8Array([9, 9, 9]) }
  }
  return jsonResponse(404, { message: 'not found' })
}

const post = async (handler, body) => {
  const result = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body) })
  return { status: result.statusCode, body: JSON.parse(result.body) }
}
const catalog = async () => JSON.parse(await readFile(process.env.PREMIUM_LOCAL_FILE, 'utf8'))

after(async () => { await rm(workDir, { recursive: true, force: true }) })

describe('temporary failures are retried, not lost', () => {
  it('queues a failed download on the cursor and recovers it on the next sync', async () => {
    const created = await premium({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ password: ADMIN, action: 'createChannel', name: 'Premium Images', type: 'images', status: 'on', order: 1 }) })
    const channelId = JSON.parse(created.body).channels[0].id
    await post(syncHandler, { password: ADMIN, action: 'config', config: { autoSync: false, mode: 'store', mappings: [{ discordChannelId: '900', channelId, name: 'premium-media' }] } })

    // First sync: one attachment downloads, the other hits a temporary 500.
    const first = await post(syncHandler, { password: ADMIN, action: 'sync', channelIds: ['900'], full: true })
    assert.equal(first.body.imported, 1)
    assert.equal(first.body.failed, 1)
    assert.equal(first.body.recovered, 0)

    const stored = await catalog()
    const queued = stored.discord.cursors['900'].failed
    assert.equal(queued.length, 1)
    assert.equal(queued[0].attachmentId, 'a1')
    assert.equal(queued[0].attempts, 1)

    // The CDN recovers; the next sync must pick the failed attachment back up.
    state.cdnFailures.clear()
    const second = await post(syncHandler, { password: ADMIN, action: 'sync', channelIds: ['900'] })
    assert.equal(second.body.recovered, 1)
    assert.equal(second.body.failed, 0)

    const after = await catalog()
    assert.equal(after.media.filter((item) => item.source === 'discord').length, 2)
    assert.equal(after.discord.cursors['900'].failed.length, 0)
    assert.ok(after.media.some((item) => item.filename === 'flaky.jpg'))
  })

  it('stops retrying an attachment that Discord no longer has', async () => {
    const stored = await catalog()
    stored.discord.cursors['900'].failed = [{ messageId: 'm1', attachmentId: 'a1', filename: 'flaky.jpg', title: 'Two shots', authorName: 'Me', attempts: 1, error: 'gone', at: new Date().toISOString() }]
    stored.media = stored.media.filter((item) => item.filename !== 'flaky.jpg')
    await writeCatalog(stored)

    state.messages[0].attachments.find((a) => a.id === 'a1').deleted = true
    const result = await post(syncHandler, { password: ADMIN, action: 'sync', channelIds: ['900'] })
    assert.equal(result.body.retries, 1)
    assert.equal(result.body.recovered, 0)
    const after = await catalog()
    assert.equal(after.discord.cursors['900'].failed.length, 0, 'a deleted attachment leaves the retry queue')
    assert.equal(after.media.some((item) => item.filename === 'flaky.jpg'), false)
  })
})

describe('expired Discord URLs are never kept', () => {
  it('refreshes a stale signature and stores the new one', async () => {
    const stored = await catalog()
    const entry = stored.media.find((item) => item.sourceAttachmentId === 'a2')
    assert.ok(entry, 'the surviving attachment is in the catalog')
    entry.cdnUrl = 'https://cdn.discordapp.com/attachments/900/old.jpg?ex=00000001&is=old&hm=x'
    entry.cdnExpiresAt = Date.now() - 1000
    await writeCatalog(stored)

    const result = await mediaHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: { id: entry.id } })
    assert.equal(result.statusCode, 302)
    assert.ok(!result.headers.location.includes('is=old'))
    const after = await catalog()
    const refreshed = after.media.find((item) => item.id === entry.id)
    assert.equal(refreshed.cdnUrl, result.headers.location)
    assert.ok(refreshed.cdnExpiresAt === 0 || refreshed.cdnExpiresAt > Date.now())
  })

  it('forgets the stored URL when the attachment is gone from Discord', async () => {
    const stored = await catalog()
    const entry = stored.media.find((item) => item.sourceAttachmentId === 'a2')
    entry.cdnUrl = 'https://cdn.discordapp.com/attachments/900/dead.jpg?ex=00000001&is=dead&hm=x'
    entry.cdnExpiresAt = Date.now() - 1000
    entry.sourceAttachmentId = 'not-on-discord-anymore'
    await writeCatalog(stored)

    const result = await mediaHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: { id: entry.id } })
    assert.equal(result.statusCode, 410)
    const after = await catalog()
    const dead = after.media.find((item) => item.id === entry.id)
    assert.equal(dead.cdnUrl, '', 'the dead signed URL is dropped, not kept forever')
    assert.equal(dead.cdnExpiresAt, 0)
  })
})
