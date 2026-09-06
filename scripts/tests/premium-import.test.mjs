import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, describe, it } from 'node:test'

// The premium store reads its file location from the environment at import time.
const workDir = await mkdtemp(join(tmpdir(), 'x-sutra-premium-'))
process.env.PREMIUM_LOCAL_FILE = join(workDir, 'catalog.json')
process.env.PREMIUM_MEDIA_DIR = join(workDir, 'media')

const { handler } = await import('../../netlify/functions/premium.mjs')

const ADMIN = 'admin123'
let selectedChannel = ''
let otherChannel = ''

const post = async (body) => {
  const result = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ password: ADMIN, ...body }) })
  return { status: result.statusCode, body: JSON.parse(result.body) }
}

after(async () => { await rm(workDir, { recursive: true, force: true }) })

describe('premium channel + media assignment', () => {
  it('creates the channel the admin picked in the upload form', async () => {
    const { status, body } = await post({ action: 'createChannel', name: 'Desi Clips', type: 'mixed', status: 'on', order: 1 })
    assert.equal(status, 200)
    assert.equal(body.channels.length, 1)
    assert.equal(body.channels[0].name, 'Desi Clips')
    selectedChannel = body.channels[0].id
    const second = await post({ action: 'createChannel', name: 'Second', type: 'mixed', status: 'on', order: 2 })
    otherChannel = second.body.channels.find((channel) => channel.name === 'Second').id
  })

  it('assigns every file of a multi-file upload to the selected channel', async () => {
    const { status, body } = await post({
      action: 'importMedia',
      channelId: selectedChannel,
      albumId: '',
      items: [
        { url: '/api/premium-file?id=up-1', type: 'image', filename: 'one.jpg', title: 'one.jpg', size: 11, hash: 'h1', width: 1080, height: 1920 },
        { url: '/api/premium-file?id=up-2', type: 'image', filename: 'two.jpg', title: 'two.jpg', size: 22, hash: 'h2', width: 640, height: 480 },
        { url: '/api/premium-file?id=up-3', type: 'video', filename: 'three.mp4', title: 'three.mp4', size: 33, hash: 'h3', width: 720, height: 1280 }
      ]
    })
    assert.equal(status, 200)
    assert.equal(body.added, 3)
    assert.equal(body.skipped, 0)
    assert.equal(body.catalog.media.length, 3)
    for (const entry of body.catalog.media) {
      assert.equal(entry.channelId, selectedChannel)
      assert.equal(entry.albumId, '')
    }
  })

  it('keeps the real pixel size and filename so images are not cropped on display', async () => {
    const catalog = JSON.parse(await readFile(process.env.PREMIUM_LOCAL_FILE, 'utf8'))
    const byName = new Map(catalog.media.map((entry) => [entry.filename, entry]))
    assert.equal(byName.get('one.jpg').width, 1080)
    assert.equal(byName.get('one.jpg').height, 1920)
    assert.equal(byName.get('one.jpg').hash, 'h1')
    assert.equal(byName.get('one.jpg').size, 11)
    assert.equal(byName.get('one.jpg').source, 'upload')
    assert.equal(byName.get('three.mp4').type, 'video')
    assert.equal(byName.get('three.mp4').thumbnail, '')
    assert.equal(byName.get('two.jpg').thumbnail, '/api/premium-file?id=up-2')
  })

  it('does not scatter the batch when another channel exists', async () => {
    const { body } = await post({
      action: 'importMedia',
      channelId: otherChannel,
      items: [
        { url: '/api/premium-file?id=up-4', type: 'image', filename: 'four.jpg', width: 400, height: 400 },
        { url: '/api/premium-file?id=up-5', type: 'image', filename: 'five.jpg', width: 500, height: 900 }
      ]
    })
    assert.equal(body.added, 2)
    assert.deepEqual(body.catalog.media.filter((entry) => entry.channelId === otherChannel).map((entry) => entry.filename).sort(), ['five.jpg', 'four.jpg'])
    assert.equal(body.catalog.media.filter((entry) => entry.channelId === selectedChannel).length, 3)
  })

  it('exposes the imported media through the public feed shape', async () => {
    const result = await handler({ httpMethod: 'GET', headers: {} })
    const body = JSON.parse(result.body)
    assert.equal(body.media.length, 5)
    assert.equal(body.channels.length, 2)
  })

  it('skips a duplicate hash on the next upload of the same files', async () => {
    const { body } = await post({
      action: 'importMedia',
      channelId: selectedChannel,
      items: [
        { url: '/api/premium-file?id=up-9', type: 'image', filename: 'one.jpg', hash: 'h1', width: 1080, height: 1920 },
        { url: '/api/premium-file?id=up-10', type: 'image', filename: 'six.jpg', hash: 'h6', width: 100, height: 100 }
      ]
    })
    assert.equal(body.added, 1)
    assert.equal(body.skipped, 1)
  })

  it('rejects a media row that is not a usable URL', async () => {
    const { body } = await post({ action: 'importMedia', channelId: selectedChannel, items: [{ url: 'not-a-url', type: 'image' }] })
    assert.equal(body.added, 0)
  })

  it('requires the admin password', async () => {
    const result = await handler({ httpMethod: 'POST', headers: {}, body: JSON.stringify({ action: 'importMedia', password: 'wrong', items: [] }) })
    assert.equal(result.statusCode, 403)
  })
})
