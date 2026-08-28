import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

// Point the real handlers at a throwaway store before importing them.
const workDir = await mkdtemp(join(tmpdir(), 'x-sutra-autosync-'))
process.env.PREMIUM_LOCAL_FILE = join(workDir, 'catalog.json')
process.env.PREMIUM_MEDIA_DIR = join(workDir, 'media')
process.env.DISCORD_BOT_TOKEN = 'test-bot-token'
process.env.DISCORD_GUILD_ID = '111'
process.env.DISCORD_CHANNEL_ID = '900'

const { handler: syncHandler } = await import('../../netlify/functions/discord-sync.mjs')
const { handler: feedHandler } = await import('../../netlify/functions/discord-feed.mjs')
const { handler: mediaHandler } = await import('../../netlify/functions/discord-media.mjs')
const { handler: cronHandler } = await import('../../netlify/functions/discord-cron.mjs')
const { dueChannels } = await import('../../netlify/functions/discord-feed.mjs')
const { attachmentExpiry, isAttachmentFresh, mediaUrl, newerSnowflake } = await import('../../netlify/functions/_server/discord.mjs')

const ADMIN = 'admin123'

/** A tiny live-ish Discord: channels + a per-channel message list we can post to. */
const state = {
  calls: [],
  channels: [
    { id: '900', name: 'premium', type: 0, topic: 'Everything premium' },
    { id: '901', name: 'videos', type: 0, topic: 'Clips only' },
    { id: '902', name: 'images', type: 0, topic: 'Photos only' },
    { id: '903', name: 'Voice', type: 2 }
  ],
  messages: { 900: [], 901: [], 902: [] },
  /** Signed links "expire" 10 minutes from the moment they are issued. */
  sign: (channelId, filename, ttlSeconds = 600) => {
    state.nonce += 1
    const ex = Math.floor(Date.now() / 1000) + ttlSeconds
    return `https://cdn.discordapp.com/attachments/${channelId}/${filename}?ex=${ex.toString(16)}&is=n${state.nonce}&hm=y`
  },
  /** Discord ids are globally unique and monotonic — so are these. */
  seq: 1000,
  nonce: 0,
  post(channelId, { content = '', attachments = [] }) {
    state.seq += 1
    const id = String(state.seq)
    state.messages[channelId].push({
      id, content, timestamp: new Date(1_800_000_000_000 + state.seq * 1000).toISOString(),
      author: { id: 'u1', username: 'owner', global_name: 'Owner' },
      attachments: attachments.map((attachment, index) => ({
        id: `${id}-a${index}`,
        filename: attachment.filename,
        content_type: attachment.contentType,
        size: attachment.size || 4321,
        width: attachment.width || 0,
        height: attachment.height || 0,
        url: state.sign(channelId, attachment.filename)
      }))
    })
    return id
  }
}

const jsonResponse = (status, body) => ({ ok: status < 400, status, json: async () => body, arrayBuffer: async () => new Uint8Array([1]) })

globalThis.fetch = async (url, options = {}) => {
  const target = String(url)
  state.calls.push(target)
  if (target.startsWith('https://discord.com/api/v10/guilds/111/channels')) return jsonResponse(200, state.channels)

  // Re-read a single message — how an expired signature gets refreshed.
  const single = target.match(/^https:\/\/discord\.com\/api\/v10\/channels\/(\d+)\/messages\/(\d+)$/)
  if (single) {
    const message = (state.messages[single[1]] || []).find((entry) => entry.id === single[2])
    if (!message) return jsonResponse(404, { message: 'Unknown Message' })
    return jsonResponse(200, { ...message, attachments: message.attachments.map((a) => ({ ...a, url: state.sign(single[1], a.filename) })) })
  }

  const history = target.match(/^https:\/\/discord\.com\/api\/v10\/channels\/(\d+)\/messages\?/)
  if (history) {
    if (!state.channels.some((channel) => channel.id === history[1])) return jsonResponse(404, { message: 'Unknown Channel' })
    const after = new URL(target).searchParams.get('after')
    let list = state.messages[history[1]] || []
    if (after) list = list.filter((message) => newerSnowflake(message.id, after) === message.id && message.id !== after)
    // Discord returns newest-first without a cursor, oldest-first with `after`.
    return jsonResponse(200, after ? list : [...list].reverse())
  }

  if (target.includes('cdn.discordapp.com')) return jsonResponse(200, {})
  return jsonResponse(404, { message: 'not found' })
}

const post = async (handler, body, headers = {}) => {
  const result = await handler({ httpMethod: 'POST', headers, body: JSON.stringify(body) })
  return { status: result.statusCode, body: JSON.parse(result.body) }
}
const catalog = async () => JSON.parse(await readFile(process.env.PREMIUM_LOCAL_FILE, 'utf8'))

/** Push every channel's last attempt into the past so a sync becomes due. */
const ageCursors = async (ms) => {
  const { writeCatalog } = await import('../../netlify/functions/_premium-store.mjs')
  const stored = await catalog()
  const past = new Date(Date.now() - ms).toISOString()
  for (const key of Object.keys(stored.discord.cursors)) {
    stored.discord.cursors[key].at = past
    stored.discord.cursors[key].lastAttemptAt = past
  }
  await writeCatalog(stored)
  return stored
}

after(async () => { await rm(workDir, { recursive: true, force: true }) })

describe('Discord → Premium auto-sync', () => {
  it('lets the admin map Discord channels onto Premium sections', async () => {
    const channels = await post(syncHandler, { password: ADMIN, action: 'create-nothing' }).catch(() => null)
    assert.equal(channels.status, 400)

    // Create the Premium sections the admin maps onto, through the real catalog API.
    const { handler: premium } = await import('../../netlify/functions/premium.mjs')
    const create = async (name, type) => {
      const result = await premium({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ password: ADMIN, action: 'createChannel', name, type, status: 'on', order: 1 }) })
      const body = JSON.parse(result.body)
      return body.channels.find((channel) => channel.name === name).id
    }
    const premiumId = await create('Premium', 'mixed')
    const videosId = await create('Premium Videos', 'videos')
    const imagesId = await create('Premium Images', 'images')

    const saved = await post(syncHandler, {
      password: ADMIN,
      action: 'config',
      config: {
        autoSync: true,
        intervalMs: 30000,
        perChannel: 20,
        mappings: [
          { discordChannelId: '900', channelId: premiumId, name: 'premium' },
          { discordChannelId: '901', channelId: videosId, name: 'videos', kinds: ['video'] },
          { discordChannelId: '902', channelId: imagesId, name: 'images', kinds: ['image'] },
          { discordChannelId: '903', channelId: 'does-not-exist' },
          // mapped but not a real channel — exercises the failure path
          { discordChannelId: '999', channelId: premiumId, name: 'ghost' }
        ]
      }
    })
    assert.equal(saved.status, 200)
    assert.equal(saved.body.config.mappings.length, 5)
    assert.equal(saved.body.config.mappings[0].channelId, premiumId)
    // A mapping that points at a channel that is not in the catalog is neutralised.
    assert.equal(saved.body.config.mappings[3].channelId, '')
    globalThis.__ids = { premiumId, videosId, imagesId }
  })

  it('imports media posted to Discord into the mapped section, without copying the bytes', async () => {
    const { premiumId } = globalThis.__ids
    state.post('900', {
      content: 'Weekend set 🔥',
      attachments: [
        { filename: 'photo.jpg', contentType: 'image/jpeg', width: 1440, height: 2560 },
        { filename: 'clip.mp4', contentType: 'video/mp4', width: 720, height: 1280 }
      ]
    })
    state.post('900', { content: 'text only, no media', attachments: [] })

    const result = await post(syncHandler, { password: ADMIN, action: 'sync' })
    assert.equal(result.status, 200)
    assert.equal(result.body.scanned, 2)
    assert.equal(result.body.imported, 2)
    assert.equal(result.body.mode, 'link')

    const stored = await catalog()
    const items = stored.media.filter((item) => item.source === 'discord')
    assert.equal(items.length, 2)
    for (const item of items) {
      assert.equal(item.channelId, premiumId)
      assert.match(item.url, /^\/api\/discord\/media\?id=dc-/)
      assert.ok(item.cdnUrl.startsWith('https://cdn.discordapp.com/'))
      assert.ok(item.cdnExpiresAt > Date.now())
    }
    // link mode: nothing was mirrored into the media store
    await assert.rejects(() => readdir(join(workDir, 'media')), /ENOENT/)
    // the video keeps its real extension in the URL so the player recognises it
    const video = items.find((item) => item.type === 'video')
    assert.match(video.url, /&f=clip\.mp4$/)
    assert.equal(video.thumbnail, '')
    const image = items.find((item) => item.type === 'image')
    assert.equal(image.thumbnail, image.url)
    assert.equal(image.width, 1440)
  })

  it('honours per-mapping kinds: #videos takes videos, #images takes images', async () => {
    const { videosId, imagesId } = globalThis.__ids
    state.post('901', { content: 'clip post', attachments: [{ filename: 'a.mp4', contentType: 'video/mp4' }, { filename: 'b.jpg', contentType: 'image/jpeg' }] })
    state.post('902', { content: 'photo post', attachments: [{ filename: 'c.png', contentType: 'image/png' }, { filename: 'd.mp4', contentType: 'video/mp4' }] })

    const result = await post(syncHandler, { password: ADMIN, action: 'sync', channelIds: ['901', '902'] })
    assert.equal(result.body.imported, 2)
    const stored = await catalog()
    assert.equal(stored.media.filter((item) => item.channelId === videosId).length, 1)
    assert.equal(stored.media.filter((item) => item.channelId === videosId)[0].type, 'video')
    assert.equal(stored.media.filter((item) => item.channelId === imagesId).length, 1)
    assert.equal(stored.media.filter((item) => item.channelId === imagesId)[0].type, 'image')
  })

  it('reads only newer messages on the next sync (cursor) and never duplicates', async () => {
    const before = state.calls.length
    const noop = await post(syncHandler, { password: ADMIN, action: 'sync' })
    assert.equal(noop.body.imported, 0)
    assert.ok(state.calls.slice(before).some((call) => call.includes('&after=')), 'expected an incremental request with a cursor')

    // Forward one more image to Discord — the next sync must pick only that up.
    state.post('900', { content: 'forwarded', attachments: [{ filename: 'fwd.webp', contentType: 'image/webp', width: 800, height: 600 }] })
    const next = await post(syncHandler, { password: ADMIN, action: 'sync' })
    assert.equal(next.body.imported, 1)
    assert.equal(next.body.skipped, 0)
    const stored = await catalog()
    assert.equal(stored.media.filter((item) => item.source === 'discord').length, 5)
    assert.equal(new Set(stored.media.map((item) => item.sourceAttachmentId)).size, 5)
  })

  it('keeps Discord order: newest message first', async () => {
    const result = await feedHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: { limit: 10 } })
    const body = JSON.parse(result.body)
    const dates = body.media.map((item) => Date.parse(item.createdAt))
    assert.deepEqual(dates, [...dates].sort((a, b) => b - a))
    assert.equal(body.media[0].title, 'forwarded')
  })

  it('auto-syncs on read when the interval has passed, and skips when it has not', async () => {
    const stored = await catalog()
    const interval = stored.discord.intervalMs
    // Nothing is due — even the never-resolvable 903 mapping recorded an attempt.
    assert.deepEqual(dueChannels(stored.discord), [], 'nothing is due right after a sync')

    // Age the last attempts past the interval, then post something new.
    await ageCursors(interval + 1000)
    state.post('900', { content: 'auto', attachments: [{ filename: 'auto.jpg', contentType: 'image/jpeg', width: 500, height: 500 }] })
    assert.deepEqual(dueChannels((await catalog()).discord).sort(), ['900', '901', '902', '903', '999'])

    const first = JSON.parse((await feedHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: { limit: 5 } })).body)
    assert.equal(first.synced.imported, 1)
    assert.equal(first.autoSync, true)

    // Immediately after, the same read must not hit Discord again.
    const callsAfterFirst = state.calls.length
    const second = JSON.parse((await feedHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: { limit: 5 } })).body)
    assert.equal(second.synced, null)
    assert.equal(state.calls.length, callsAfterFirst)
  })

  it('serves media straight from the Discord CDN and refreshes an expired signature', async () => {
    const stored = await catalog()
    const fresh = stored.media.find((item) => item.type === 'image' && item.cdnExpiresAt > Date.now())
    const redirect = await mediaHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: { id: fresh.id } })
    assert.equal(redirect.statusCode, 302)
    assert.equal(redirect.headers.location, fresh.cdnUrl)

    // Age the signature past expiry: the resolver must re-read the message.
    const callsBefore = state.calls.length
    const after = await catalog()
    const target = after.media.find((item) => item.id === fresh.id)
    target.cdnExpiresAt = Date.now() - 1000
    const { writeCatalog } = await import('../../netlify/functions/_premium-store.mjs')
    await writeCatalog(after)

    const refreshed = await mediaHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: { id: fresh.id } })
    assert.equal(refreshed.statusCode, 302)
    assert.notEqual(refreshed.headers.location, fresh.cdnUrl)
    assert.ok(state.calls.slice(callsBefore).some((call) => call.includes(`/messages/${target.sourceMessageId}`)), 'expected a message re-read')
    const persisted = (await catalog()).media.find((item) => item.id === fresh.id)
    assert.equal(persisted.cdnUrl, refreshed.headers.location)
    assert.ok(persisted.cdnExpiresAt > Date.now())
  })

  it('refuses to resolve media that is not in the catalog', async () => {
    const result = await mediaHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: { id: 'dc-nope-nope' } })
    assert.equal(result.statusCode, 404)
  })

  it('pages a large collection with an oldest-first cursor', async () => {
    const first = JSON.parse((await feedHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: { limit: 2 } })).body)
    assert.equal(first.media.length, 2)
    assert.equal(first.hasMore, true)
    const second = JSON.parse((await feedHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: { limit: 2, before: first.oldest } })).body)
    assert.equal(second.media.length, 2)
    assert.ok(!first.media.some((item) => second.media.some((other) => other.id === item.id)))
  })

  it('exposes sections with their mapping and last sync, but no bot or cursor details', async () => {
    const body = JSON.parse((await feedHandler({ httpMethod: 'GET', headers: {}, queryStringParameters: { limit: 1 } })).body)
    assert.equal(body.sections.length, 5)
    const premiumSection = body.sections.find((section) => section.discordChannelId === '900')
    assert.equal(premiumSection.name, 'Premium')
    assert.ok(premiumSection.lastSyncAt)
    assert.equal(body.configured, true)
    assert.equal(JSON.stringify(body).includes(process.env.DISCORD_BOT_TOKEN), false)
    assert.equal('cursors' in body, false)
    assert.equal('errors' in body, false)
  })

  it('runs the scheduled background sync', async () => {
    await ageCursors(3600_000)
    state.post('901', { content: 'cron clip', attachments: [{ filename: 'cron.mp4', contentType: 'video/mp4' }] })

    const result = await cronHandler({})
    assert.equal(result.statusCode, 200)
    const body = JSON.parse(result.body)
    assert.equal(body.ok, true)
    assert.equal(body.imported, 1)
    const final = await catalog()
    assert.equal(final.media.filter((item) => item.source === 'discord').length, 7)
  })

  it('records sync failures in the admin error log', async () => {
    // 999 is mapped but Discord answers 404 for a channel that does not exist.
    const status = await post(syncHandler, { password: ADMIN, action: 'sync', channelIds: ['999'] })
    assert.equal(status.status, 200)
    assert.equal(status.body.status.errors.length > 0, true)
    assert.equal(status.body.status.autoSync, true)
    assert.ok(status.body.status.lastSyncAt)
  })
})

describe('attachment URL helpers', () => {
  it('parses a signed expiry and treats unsigned links as permanent', () => {
    const signed = 'https://cdn.discordapp.com/attachments/1/2/a.jpg?ex=68f0a1b2&is=1&hm=x'
    assert.equal(attachmentExpiry(signed), 0x68f0a1b2 * 1000)
    assert.equal(attachmentExpiry('https://cdn.discordapp.com/attachments/1/2/a.jpg'), 0)
    assert.equal(isAttachmentFresh({ cdnExpiresAt: 0 }), true)
    assert.equal(isAttachmentFresh({ cdnExpiresAt: Date.now() + 600_000 }), true)
    assert.equal(isAttachmentFresh({ cdnExpiresAt: Date.now() + 1000 }), false)
  })

  it('keeps the filename in the resolver URL so the player knows the type', () => {
    assert.equal(mediaUrl({ id: 'dc-1-2', filename: 'clip.mp4' }), '/api/discord/media?id=dc-1-2&f=clip.mp4')
    assert.equal(mediaUrl({ id: 'dc-1-2' }), '/api/discord/media?id=dc-1-2')
    assert.match(mediaUrl({ id: 'dc-1-2', filename: 'my clip.MP4' }), /\.MP4$/)
  })

  it('compares snowflakes by value, not by string', () => {
    assert.equal(newerSnowflake('999', '1000'), '1000')
    assert.equal(newerSnowflake('1000', '999'), '1000')
    assert.equal(newerSnowflake('', '42'), '42')
  })
})
