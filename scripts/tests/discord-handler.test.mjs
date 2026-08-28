import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

// The handlers read their storage location from the environment at import time,
// so everything is pointed at a throwaway directory before they are loaded.
const workDir = await mkdtemp(join(tmpdir(), 'x-sutra-discord-'))
process.env.PREMIUM_LOCAL_FILE = join(workDir, 'catalog.json')
process.env.PREMIUM_MEDIA_DIR = join(workDir, 'media')
process.env.DISCORD_BOT_TOKEN = 'test-bot-token'
process.env.DISCORD_GUILD_ID = '111'
process.env.DISCORD_CHANNEL_ID = '900'

const { handler } = await import('../../netlify/functions/discord-sync.mjs')
const { handler: premium } = await import('../../netlify/functions/premium.mjs')
const { handler: premiumFile } = await import('../../netlify/functions/premium-file.mjs')
const { handler: discordUpload } = await import('../../netlify/functions/discord-upload.mjs')
const { normalizeMappings } = await import('../../netlify/functions/discord-sync.mjs')

const ADMIN = 'admin123'
const JPEG = Buffer.from('ffd8ffe000104a464946', 'hex')
const MP4 = Buffer.from('0000001866747970', 'hex')

/** Every Discord REST/CDN call the handlers can make, answered from fixtures. */
const requests = []
const channelsFixture = [
  { id: '900', name: 'general', type: 0, topic: 'Chat' },
  { id: '901', name: 'desi-media', type: 0, topic: 'Clips' },
  { id: '902', name: 'Voice Room', type: 2 }
]
const messageFixture = [
  {
    id: 'm1', content: 'Weekend set 🔥', timestamp: '2026-08-22T12:00:00.000Z',
    author: { id: 'u1', username: 'owner', global_name: 'Owner' },
    attachments: [
      { id: 'a1', filename: 'photo.jpg', content_type: 'image/jpeg', size: JPEG.length, width: 1440, height: 2560, url: 'https://cdn.discordapp.com/attachments/901/photo.jpg', proxy_url: 'https://media.discordapp.net/attachments/901/photo.jpg' },
      { id: 'a2', filename: 'clip.mp4', content_type: 'video/mp4', size: MP4.length, width: 720, height: 1280, url: 'https://cdn.discordapp.com/attachments/901/clip.mp4' }
    ]
  },
  {
    id: 'm2', content: '', timestamp: '2026-08-23T12:00:00.000Z',
    author: { id: 'u2', username: 'fan' },
    attachments: [{ id: 'a3', filename: 'wallpaper.png', size: JPEG.length, width: 1920, height: 1080, url: 'https://cdn.discordapp.com/attachments/901/wallpaper.png' }]
  },
  {
    id: 'm3', content: 'text only', timestamp: '2026-08-23T13:00:00.000Z',
    author: { id: 'u3', username: 'fan2' }, attachments: []
  }
]

const jsonResponse = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  arrayBuffer: async () => new Uint8Array(String(JSON.stringify(body)))
})

globalThis.fetch = async (url, options = {}) => {
  const target = String(url)
  requests.push({ url: target, method: options.method || 'GET' })
  if (target.startsWith('https://discord.com/api/v10/guilds/111/channels')) return jsonResponse(200, channelsFixture)
  if (target.includes('media.discordapp.net') || target.includes('cdn.discordapp.com')) {
    const bytes = target.endsWith('.mp4') ? MP4 : JPEG
    return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new Uint8Array(bytes) }
  }
  if ((options.method || 'GET') === 'POST' && target.includes('/messages')) {
    return jsonResponse(200, { id: 'sent', attachments: [{ url: 'https://cdn.discordapp.com/attachments/sent' }] })
  }
  const history = target.match(/^https:\/\/discord\.com\/api\/v10\/channels\/(\d+)\/messages/)
  if (history) {
    if (!channelsFixture.some((channel) => channel.id === history[1])) return jsonResponse(404, { message: 'Unknown Channel' })
    return jsonResponse(200, messageFixture)
  }
  return jsonResponse(404, { message: 'not found' })
}

const post = (body, headers = {}) => handler({ httpMethod: 'POST', headers, body: JSON.stringify(body) })
const parse = (result) => JSON.parse(result.body)

after(async () => { await rm(workDir, { recursive: true, force: true }) })

describe('/api/discord/sync', () => {
  it('reports configuration before anything is imported', async () => {
    const result = await handler({ httpMethod: 'GET', headers: {} })
    const body = parse(result)
    assert.equal(result.statusCode, 200)
    assert.equal(body.configured.botToken, true)
    assert.equal(body.configured.guildId, true)
    assert.equal(body.configured.storeAttachments, false)
    assert.deepEqual(body.mappings, [])
    assert.deepEqual(body.totals, { media: 0, images: 0, videos: 0 })
    assert.equal(JSON.stringify(body).includes(process.env.DISCORD_BOT_TOKEN), false)
  })

  it('refuses every action without admin credentials', async () => {
    const result = await post({ action: 'list_channels' })
    assert.equal(result.statusCode, 401)
    assert.match(parse(result).error, /Unauthorized/)
  })

  it('lists only the guild text channels', async () => {
    const body = parse(await post({ action: 'list_channels', password: ADMIN }))
    assert.deepEqual(body.channels.map((channel) => channel.id), ['901', '900'])
    assert.deepEqual(body.channels[0].name, 'desi-media')
  })

  it('refuses to sync before a channel is mapped', async () => {
    const result = await post({ action: 'sync', password: ADMIN })
    assert.equal(result.statusCode, 400)
    assert.match(parse(result).error, /Map at least one Discord channel/)
  })

  it('saves a mapping onto a real Premium section and rejects unknown targets', async () => {
    const created = await premium({
      httpMethod: 'POST', headers: {},
      body: JSON.stringify({ password: ADMIN, action: 'createChannel', name: 'Premium Videos', type: 'videos', status: 'on', order: 1 })
    })
    const channelId = JSON.parse(created.body).channels[0].id

    const saved = parse(await post({
      password: ADMIN, action: 'config',
      config: { autoSync: false, intervalMs: 45000, perChannel: 30, mode: 'store', mappings: [{ discordChannelId: '901', channelId, name: 'desi-media' }, { discordChannelId: '901', channelId: 'nope' }, { discordChannelId: '999', channelId, name: 'deleted-channel' }] }
    }))
    assert.equal(saved.config.mappings.length, 2, 'duplicate Discord channels collapse')
    assert.equal(saved.config.mappings[0].channelId, channelId)
    assert.equal(saved.config.autoSync, false)
    assert.equal(saved.config.mode, 'store')
    assert.equal(normalizeMappings([{ discordChannelId: '1', channelId: 'ghost' }], []).length, 1)
    assert.equal(normalizeMappings([{ discordChannelId: '1', channelId: 'ghost' }], [])[0].channelId, '')
    globalThis.__channelId = channelId
  })

  it('imports the real messages into the mapped section and stores the bytes (store mode)', async () => {
    const channelId = globalThis.__channelId
    const body = parse(await post({ action: 'sync', password: ADMIN, channelIds: ['901'] }))
    assert.equal(body.scanned, 3)
    assert.equal(body.imported, 3)
    assert.equal(body.failed, 0)
    assert.equal(body.mode, 'store')
    assert.deepEqual(body.channels, [{ id: '901', name: 'desi-media', targetChannelId: channelId, messages: 3, imported: 3, skipped: 0, failed: 0, recovered: 0, error: '' }])

    const files = (await readdir(join(workDir, 'media'))).sort()
    assert.deepEqual(files, ['dc-m1-a1', 'dc-m1-a1.json', 'dc-m1-a2', 'dc-m1-a2.json', 'dc-m2-a3', 'dc-m2-a3.json'])
    assert.deepEqual(await readFile(join(workDir, 'media', 'dc-m1-a1')), JPEG)
    assert.deepEqual(await readFile(join(workDir, 'media', 'dc-m1-a2')), MP4)

    const catalog = JSON.parse(await readFile(process.env.PREMIUM_LOCAL_FILE, 'utf8'))
    assert.equal(catalog.media.length, 3)
    for (const entry of catalog.media) {
      assert.equal(entry.channelId, channelId)
      assert.match(entry.url, /^\/api\/premium-file\?id=dc-/)
    }
    const photo = catalog.media.find((entry) => entry.sourceAttachmentId === 'a1')
    assert.equal(photo.type, 'image')
    assert.equal(photo.width, 1440)
    assert.equal(photo.height, 2560)
    assert.equal(photo.title, 'Weekend set 🔥')
    // sync bookkeeping is visible to the admin
    assert.equal(body.status.lastResult.imported, 3)
    assert.equal(body.status.mappings[0].lastSyncAt.length > 0, true)
    assert.equal(body.status.mappings[0].media, 3)
  })

  it('serves the stored bytes back through the media endpoint', async () => {
    const result = await premiumFile({ httpMethod: 'GET', headers: {}, queryStringParameters: { id: 'dc-m1-a1' } })
    assert.equal(result.statusCode, 200)
    assert.equal(result.headers['Content-Type'], 'image/jpeg')
    assert.deepEqual(Buffer.from(result.body, 'base64'), JPEG)
  })

  it('does not re-import what is already stored', async () => {
    const body = parse(await post({ action: 'sync', password: ADMIN, channelIds: ['901'], full: true }))
    assert.equal(body.imported, 0)
    assert.equal(body.skipped, 3)
  })

  it('reports what is stored, grouped by section', async () => {
    const body = parse(await post({ action: 'imported', password: ADMIN }))
    assert.equal(body.media.length, 3)
    assert.equal(body.media.every((item) => item.targetChannelName === 'Premium Videos'), true)
    assert.equal(body.status.totals.media, 3)
    assert.equal(body.status.totals.images, 2)
    assert.equal(body.status.totals.videos, 1)
  })

  it('refuses to sync a channel the admin never mapped', async () => {
    const result = await post({ action: 'sync', password: ADMIN, channelIds: ['123456'] })
    assert.equal(result.statusCode, 403)
    assert.match(parse(result).error, /not configured for sync/)
  })

  it('logs an error when a mapped channel cannot be read', async () => {
    const body = parse(await post({ action: 'sync', password: ADMIN, channelIds: ['999'], full: true }))
    assert.equal(body.status.errors.length > 0, true)
    assert.match(body.status.errors[0].message, /not found|failed/i)
  })

  it('rejects an unknown action', async () => {
    const result = await post({ action: 'nope', password: ADMIN })
    assert.equal(result.statusCode, 400)
  })
})

describe('/api/discord/upload channel selection', () => {
  it('posts to the channel chosen in the admin console', async () => {
    requests.length = 0
    const result = await discordUpload({
      httpMethod: 'POST', headers: {},
      body: JSON.stringify({ password: ADMIN, filename: 'shot.jpg', contentType: 'image/jpeg', data: JPEG.toString('base64'), channelId: '901' })
    })
    assert.equal(result.statusCode, 200)
    assert.ok(requests.some((request) => request.url === 'https://discord.com/api/v10/channels/901/messages' && request.method === 'POST'))
  })

  it('falls back to the configured default channel', async () => {
    requests.length = 0
    await discordUpload({
      httpMethod: 'POST', headers: {},
      body: JSON.stringify({ password: ADMIN, filename: 'shot.jpg', contentType: 'image/jpeg', data: JPEG.toString('base64') })
    })
    assert.ok(requests.some((request) => request.url === 'https://discord.com/api/v10/channels/900/messages'))
  })
})
