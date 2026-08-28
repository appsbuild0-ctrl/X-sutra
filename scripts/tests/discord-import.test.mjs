import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  attachmentKind,
  importChannels,
  mergeImportedIntoCatalog,
  pickChannelRows,
  pickMessageRows,
  storageKey
} from '../../netlify/functions/_server/discord.mjs'

const rawGuildChannels = [
  { id: '900', name: 'general', type: 0, topic: 'Chat' },
  { id: '901', name: 'media', type: 0, topic: '' },
  { id: '902', name: 'announcements', type: 5, topic: 'News' },
  { id: '903', name: 'Voice', type: 2 },
  { id: '904', name: 'Stage', type: 13 },
  { id: '900', name: 'general-duplicate', type: 0 }
]

const messages = (channelId) => ([
  {
    id: `m${channelId}a`,
    content: 'Desi clip 🎬',
    timestamp: '2026-08-20T10:00:00.000Z',
    author: { id: 'u1', username: 'owner', global_name: 'Owner' },
    attachments: [
      { id: `a${channelId}1`, filename: 'photo.jpg', content_type: 'image/jpeg', size: 1234, width: 1080, height: 1920, url: `https://cdn.discordapp.com/attachments/${channelId}/photo.jpg`, proxy_url: `https://media.discordapp.net/attachments/${channelId}/photo.jpg` },
      { id: `a${channelId}2`, filename: 'clip.mp4', content_type: 'video/mp4', size: 999999, width: 720, height: 1280, url: `https://cdn.discordapp.com/attachments/${channelId}/clip.mp4` }
    ]
  },
  {
    // No content_type at all — the filename must still classify it as an image.
    id: `m${channelId}b`,
    content: '',
    timestamp: '2026-08-21T10:00:00.000Z',
    author: { id: 'u2', username: 'member' },
    attachments: [
      { id: `a${channelId}3`, filename: 'scan.png', size: 555, url: `https://cdn.discordapp.com/attachments/${channelId}/scan.png` },
      { id: `a${channelId}4`, filename: 'notes.pdf', size: 10, url: `https://cdn.discordapp.com/attachments/${channelId}/notes.pdf` }
    ]
  }
])

/** In-memory stand-ins for the premium blob store + catalog. */
function fakeStore() {
  const bytes = new Map()
  return {
    bytes,
    async store(id, data, contentType, filename) { bytes.set(id, { data: Buffer.from(data), contentType, filename }) },
    readStore: async () => ({ settings: {}, channels: [], albums: [], media: [], heroes: [], announcements: [] }),
    async write(catalog) { this.catalog = catalog; return catalog }
  }
}

describe('Discord channel discovery', () => {
  it('keeps only guild text/announcement channels and dedupes them', () => {
    const rows = pickChannelRows(rawGuildChannels)
    assert.deepEqual(rows.map((row) => row.id), ['902', '900', '901'])
    assert.deepEqual(rows.find((row) => row.id === '902').type, 'announcement')
    assert.deepEqual(rows.find((row) => row.id === '900').name, 'general')
  })

  it('tolerates garbage input', () => {
    assert.deepEqual(pickChannelRows(null), [])
    assert.deepEqual(pickChannelRows([{ id: '', type: 0 }, { name: 'x' }]), [])
  })
})

describe('Discord attachment classification', () => {
  it('uses content_type when present', () => {
    assert.equal(attachmentKind({ content_type: 'image/png' }), 'image')
    assert.equal(attachmentKind({ content_type: 'video/webm' }), 'video')
    assert.equal(attachmentKind({ content_type: 'audio/mpeg' }), 'audio')
    assert.equal(attachmentKind({ content_type: 'application/pdf' }), 'file')
  })

  it('falls back to the filename when content_type is missing', () => {
    assert.equal(attachmentKind({ filename: 'photo.JPG' }), 'image')
    assert.equal(attachmentKind({ filename: 'clip.MP4' }), 'video')
    assert.equal(attachmentKind({ filename: 'notes.pdf' }), 'file')
  })
})

describe('Discord message → media rows', () => {
  it('produces one row per attachment, carrying channel + caption + real size', () => {
    const rows = pickMessageRows(messages('900'), '900')
    assert.equal(rows.length, 4)
    const first = rows[0]
    assert.equal(first.channelId, '900')
    assert.equal(first.messageId, 'm900a')
    assert.equal(first.attachmentId, 'a9001')
    assert.equal(first.kind, 'image')
    assert.equal(first.title, 'Desi clip 🎬')
    assert.equal(first.width, 1080)
    assert.equal(first.height, 1920)
    assert.equal(first.authorName, 'Owner')
    assert.equal(first.createdAt, '2026-08-20T10:00:00.000Z')
    assert.equal(rows[2].kind, 'image')
    assert.equal(rows[3].kind, 'file')
  })

  it('builds a stable storage key per message + attachment', () => {
    assert.equal(storageKey({ messageId: 'm900a', attachmentId: 'a9001' }), 'dc-m900a-a9001')
  })
})

describe('Catalog merge', () => {
  it('creates one channel per Discord channel and attaches every media row to it', () => {
    const catalog = { settings: {}, channels: [], albums: [], media: [], heroes: [], announcements: [] }
    const rows = pickMessageRows(messages('901'), '901').filter((row) => row.kind === 'image' || row.kind === 'video')
    const merged = mergeImportedIntoCatalog(catalog, { channel: { id: '901', name: 'media', topic: '' }, rows })

    assert.equal(merged.catalog.channels.length, 1)
    assert.equal(merged.channelId, 'discord-901')
    assert.equal(merged.catalog.channels[0].source, 'discord')
    assert.equal(merged.catalog.channels[0].sourceId, '901')
    assert.equal(merged.added.length, 3)
    for (const entry of merged.added) {
      assert.equal(entry.channelId, 'discord-901')
      assert.equal(entry.source, 'discord')
      assert.equal(entry.sourceChannelId, '901')
      assert.ok(entry.url.startsWith('/api/premium-file?id=dc-'))
    }
    const image = merged.added.find((entry) => entry.type === 'image')
    assert.equal(image.width, 1080)
    assert.equal(image.height, 1920)
    assert.equal(image.thumbnail, image.url)
  })

  it('does not duplicate an attachment that is already in the catalog', () => {
    const catalog = { settings: {}, channels: [], albums: [], media: [], heroes: [], announcements: [] }
    const channel = { id: '901', name: 'media', topic: '' }
    const rows = pickMessageRows(messages('901'), '901').filter((row) => row.kind !== 'file')
    const first = mergeImportedIntoCatalog(catalog, { channel, rows })
    const second = mergeImportedIntoCatalog(first.catalog, { channel, rows })
    assert.equal(second.added.length, 0)
    assert.equal(second.skipped, 3)
    assert.equal(second.catalog.media.length, 3)
    assert.equal(second.catalog.channels.length, 1)
  })
})

describe('importChannels', () => {
  const base = () => {
    const store = fakeStore()
    const saved = []
    return {
      store,
      saved,
      options: {
        channelIds: ['900', '901'],
        perChannel: 25,
        kinds: ['image', 'video'],
        discover: async () => pickChannelRows(rawGuildChannels),
        fetchMessages: async (id) => messages(id),
        loadBytes: async (row) => Buffer.from(`bytes-of-${row.attachmentId}`),
        store: store.store,
        readStore: store.readStore,
        writeStore: (catalog) => store.write(catalog),
        saveRows: async (channel, entries) => { saved.push({ channel: channel.id, entries }); return 'saved' }
      }
    }
  }

  it('imports real messages and stores every image/video with its channel', async () => {
    const { store, saved, options } = base()
    const summary = await importChannels(options)

    assert.equal(summary.scanned, 4)
    assert.equal(summary.imported, 6)
    assert.equal(summary.failed, 0)
    assert.equal(summary.partial, false)
    assert.equal(summary.database, 'saved')

    // bytes landed in the file store under a stable key
    assert.deepEqual([...store.bytes.keys()].sort(), [
      'dc-m900a-a9001', 'dc-m900a-a9002', 'dc-m900b-a9003',
      'dc-m901a-a9011', 'dc-m901a-a9012', 'dc-m901b-a9013'
    ])
    assert.equal(store.bytes.get('dc-m900a-a9001').data.toString(), 'bytes-of-a9001')
    assert.equal(store.bytes.get('dc-m900a-a9001').contentType, 'image/jpeg')
    assert.equal(store.bytes.get('dc-m900a-a9001').filename, 'photo.jpg')
    assert.equal(store.bytes.get('dc-m900a-a9002').contentType, 'video/mp4')

    // catalog: two Discord channels, every media row pointing at its own channel
    const catalog = store.catalog
    assert.deepEqual(catalog.channels.map((channel) => channel.id).sort(), ['discord-900', 'discord-901'])
    assert.equal(catalog.media.length, 6)
    for (const entry of catalog.media) {
      assert.equal(entry.channelId, `discord-${entry.sourceChannelId}`)
      assert.ok(entry.title.length > 0)
    }
    assert.equal(catalog.media.filter((entry) => entry.sourceChannelId === '900').length, 3)
    assert.equal(catalog.media.filter((entry) => entry.sourceChannelId === '901').length, 3)

    // database rows carry the channel too
    assert.equal(saved.length, 2)
    assert.equal(saved[0].channel, '900')
    assert.equal(saved[0].entries.length, 3)
  })

  it('respects the selected kinds', async () => {
    const { store, options } = base()
    const summary = await importChannels({ ...options, kinds: ['image'] })
    assert.equal(summary.imported, 4)
    assert.deepEqual(store.catalog.media.map((entry) => entry.type), ['image', 'image', 'image', 'image'])
  })

  it('skips attachments that are already stored on a second run', async () => {
    const { options } = base()
    let catalog = await options.readStore()
    const writeStore = (next) => { catalog = next; return next }
    const first = await importChannels({ ...options, writeStore })
    const second = await importChannels({ ...options, readStore: async () => catalog, writeStore })
    assert.equal(first.imported, 6)
    assert.equal(second.imported, 0)
    assert.equal(second.skipped, 6)
    assert.equal(catalog.media.length, 6)
  })

  it('survives a failing download and reports it per channel', async () => {
    const { options } = base()
    const summary = await importChannels({
      ...options,
      loadBytes: async (row) => {
        if (row.kind === 'video') throw Object.assign(new Error('Discord attachment download failed (403).'), { code: 'DOWNLOAD_FAILED' })
        return Buffer.from('ok')
      }
    })
    assert.equal(summary.imported, 4)
    assert.equal(summary.failed, 2)
    for (const channel of summary.channels) assert.equal(channel.failed, 1)
  })

  it('stops on the time budget and hands back the channels it did not reach', async () => {
    const { options } = base()
    const summary = await importChannels({ ...options, budgetMs: 0 })
    assert.equal(summary.partial, true)
    assert.deepEqual(summary.nextChannelIds, ['900', '901'])
    assert.equal(summary.imported, 0)
  })

  it('refuses to run without a channel selection', async () => {
    const { options } = base()
    await assert.rejects(() => importChannels({ ...options, channelIds: [] }), /at least one Discord channel/)
  })
})
