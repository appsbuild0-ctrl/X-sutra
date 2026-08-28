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
const { handler: premiumFile } = await import('../../netlify/functions/premium-file.mjs')
const { handler: discordUpload } = await import('../../netlify/functions/discord-upload.mjs')

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
  arrayBuffer: async () => new Uint8Array(body)
})

globalThis.fetch = async (url, options = {}) => {
  const target = String(url)
  requests.push({ url: target, method: options.method || 'GET' })
  if (target.startsWith('https://discord.com/api/v10/guilds/111/channels')) return jsonResponse(200, channelsFixture)
  if (target.includes('/attachments/')) {
    const bytes = target.endsWith('.mp4') ? MP4 : JPEG
    return { ok: true, status: 200, json: async () => ({}), arrayBuffer: async () => new Uint8Array(bytes) }
  }
  // POST .../messages creates a message; GET .../messages reads history.
  if ((options.method || 'GET') === 'POST' && target.includes('/messages')) {
    return jsonResponse(200, { id: 'sent', attachments: [{ url: 'https://cdn.discordapp.com/attachments/sent' }] })
  }
  if (/^https:\/\/discord\.com\/api\/v10\/channels\/\d+\/messages/.test(target)) return jsonResponse(200, messageFixture)
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
    assert.deepEqual(body.totals, { media: 0, images: 0, videos: 0, channels: 0 })
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

  it('imports the real messages and stores images + videos with their channel', async () => {
    const body = parse(await post({ action: 'sync', password: ADMIN, channelIds: ['901'], perChannel: 25, kinds: ['image', 'video'] }))
    assert.equal(body.ok, true)
    assert.equal(body.scanned, 3)
    assert.equal(body.imported, 3)
    assert.equal(body.failed, 0)
    assert.deepEqual(body.channels, [{ id: '901', name: 'desi-media', messages: 3, imported: 3, skipped: 0, failed: 0, error: '' }])

    // bytes are on disk in the premium media store
    const files = (await readdir(join(workDir, 'media'))).sort()
    assert.deepEqual(files, ['dc-m1-a1', 'dc-m1-a1.json', 'dc-m1-a2', 'dc-m1-a2.json', 'dc-m2-a3', 'dc-m2-a3.json'])
    assert.deepEqual(await readFile(join(workDir, 'media', 'dc-m1-a1')), JPEG)
    assert.deepEqual(await readFile(join(workDir, 'media', 'dc-m1-a2')), MP4)
    assert.equal(JSON.parse(await readFile(join(workDir, 'media', 'dc-m1-a1.json'), 'utf8')).filename, 'photo.jpg')

    // and the catalog ties every media row to the imported channel
    const catalog = JSON.parse(await readFile(process.env.PREMIUM_LOCAL_FILE, 'utf8'))
    assert.equal(catalog.channels.length, 1)
    assert.equal(catalog.channels[0].id, 'discord-901')
    assert.equal(catalog.channels[0].name, 'desi-media')
    assert.equal(catalog.channels[0].source, 'discord')
    assert.equal(catalog.media.length, 3)
    for (const entry of catalog.media) {
      assert.equal(entry.channelId, 'discord-901')
      assert.equal(entry.source, 'discord')
      assert.equal(entry.sourceChannelId, '901')
      assert.match(entry.url, /^\/api\/premium-file\?id=dc-/)
    }
    const photo = catalog.media.find((entry) => entry.sourceAttachmentId === 'a1')
    assert.equal(photo.type, 'image')
    assert.equal(photo.width, 1440)
    assert.equal(photo.height, 2560)
    assert.equal(photo.title, 'Weekend set 🔥')
    assert.equal(catalog.media.find((entry) => entry.sourceAttachmentId === 'a2').type, 'video')
  })

  it('serves the imported bytes back through the media endpoint', async () => {
    const result = await premiumFile({ httpMethod: 'GET', headers: {}, queryStringParameters: { id: 'dc-m1-a1' } })
    assert.equal(result.statusCode, 200)
    assert.equal(result.headers['Content-Type'], 'image/jpeg')
    assert.deepEqual(Buffer.from(result.body, 'base64'), JPEG)
  })

  it('does not re-import what is already stored', async () => {
    const body = parse(await post({ action: 'sync', password: ADMIN, channelIds: ['901'], perChannel: 25 }))
    assert.equal(body.imported, 0)
    assert.equal(body.skipped, 3)
  })

  it('reports what is stored, grouped by channel', async () => {
    const body = parse(await post({ action: 'imported', password: ADMIN }))
    assert.equal(body.media.length, 3)
    const summary = parse(await handler({ httpMethod: 'GET', headers: {} }))
    assert.deepEqual(summary.totals, { media: 3, images: 2, videos: 1, channels: 1 })
    assert.equal(body.media.every((item) => item.channelName === 'desi-media'), true)
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
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({ password: ADMIN, filename: 'shot.jpg', contentType: 'image/jpeg', data: JPEG.toString('base64'), channelId: '901' })
    })
    assert.equal(result.statusCode, 200)
    assert.ok(requests.some((request) => request.url === 'https://discord.com/api/v10/channels/901/messages' && request.method === 'POST'))
  })

  it('falls back to the configured default channel', async () => {
    requests.length = 0
    await discordUpload({
      httpMethod: 'POST',
      headers: {},
      body: JSON.stringify({ password: ADMIN, filename: 'shot.jpg', contentType: 'image/jpeg', data: JPEG.toString('base64') })
    })
    assert.ok(requests.some((request) => request.url === 'https://discord.com/api/v10/channels/900/messages'))
  })
})
