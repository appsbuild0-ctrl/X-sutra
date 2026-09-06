import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { assignFiles, isUsableChannel, resolveUploadTargets } from '../../src/lib/uploadPlan.ts'

const channel = (id, name, status = 'on') => ({ id, name, description: '', cover: '', type: 'mixed', status, order: 1, createdAt: '' })
const album = (id, name, channelId = '', published = true) => ({ id, name, description: '', cover: '', tags: [], channelId, published, createdAt: '', updatedAt: '' })

const catalog = {
  settings: {},
  channels: [channel('ch-1', 'First'), channel('ch-2', 'Desi Clips'), channel('ch-off', 'Hidden', 'off')],
  albums: [album('alb-1', 'Uploads', 'ch-1'), album('alb-2', 'Desi Album', 'ch-2'), album('alb-hidden', 'Old', 'ch-2', false)],
  media: [],
  heroes: [],
  announcements: []
}

describe('upload target resolution', () => {
  it('sends the batch to the channel the admin picked, not the first one', () => {
    const targets = resolveUploadTargets(catalog, { channelId: 'ch-2', albumId: '', kind: 'image' })
    assert.equal(targets.channelId, 'ch-2')
    assert.equal(targets.channelName, 'Desi Clips')
    assert.equal(targets.needsChannel, false)
    // the matching published album of that channel, never another channel's
    assert.equal(targets.albumId, 'alb-2')
  })

  it('falls back to the first usable channel when nothing is picked', () => {
    const targets = resolveUploadTargets(catalog, { channelId: '', albumId: '', kind: 'image' })
    assert.equal(targets.channelId, 'ch-1')
    assert.equal(targets.albumId, 'alb-1')
  })

  it('never targets a channel that is switched off', () => {
    const targets = resolveUploadTargets(catalog, { channelId: 'ch-off', albumId: '', kind: 'image' })
    assert.equal(targets.channelId, 'ch-1')
    assert.equal(isUsableChannel(catalog.channels[2]), false)
  })

  it('ignores an album that belongs to a different channel', () => {
    const targets = resolveUploadTargets(catalog, { channelId: 'ch-1', albumId: 'alb-2', kind: 'image' })
    assert.equal(targets.channelId, 'ch-1')
    assert.equal(targets.albumId, 'alb-1')
  })

  it('accepts "none" as an album choice', () => {
    const withoutAlbums = { ...catalog, albums: [] }
    const targets = resolveUploadTargets(withoutAlbums, { channelId: 'ch-2', albumId: '', kind: 'image' })
    assert.equal(targets.channelId, 'ch-2')
    assert.equal(targets.albumId, '')
  })

  it('flags a catalog with no channel so the caller creates one', () => {
    const targets = resolveUploadTargets({ ...catalog, channels: [] }, { channelId: '', albumId: '', kind: 'image' })
    assert.equal(targets.needsChannel, true)
    assert.equal(targets.channelId, '')
  })

  it('keeps hero banners detached from channels', () => {
    const targets = resolveUploadTargets(catalog, { channelId: 'ch-2', albumId: 'alb-2', kind: 'hero' })
    assert.equal(targets.detached, true)
    assert.equal(targets.channelId, '')
  })
})

describe('assigning several selected files to one channel', () => {
  const files = [
    { file: { name: 'a.jpg', size: 1 } },
    { file: { name: 'b.jpg', size: 2 } },
    { file: { name: 'c.mp4', size: 3 } },
    { file: { name: 'd.jpg', size: 4 } }
  ]

  it('gives every file in the selection the same selected channel', () => {
    const targets = resolveUploadTargets(catalog, { channelId: 'ch-2', albumId: 'alb-2', kind: 'image' })
    const planned = assignFiles(files, targets)
    assert.equal(planned.length, 4)
    for (const row of planned) {
      assert.equal(row.channelId, 'ch-2')
      assert.equal(row.albumId, 'alb-2')
      assert.equal(row.channelName, 'Desi Clips')
    }
    assert.deepEqual(planned.map((row) => row.item.file.name), ['a.jpg', 'b.jpg', 'c.mp4', 'd.jpg'])
  })

  it('keeps the order of the selection', () => {
    const targets = resolveUploadTargets(catalog, { channelId: 'ch-1', albumId: '', kind: 'video' })
    const planned = assignFiles(files, targets)
    assert.deepEqual(planned.map((row) => row.item.file.size), [1, 2, 3, 4])
  })

  it('clears the channel for hero uploads', () => {
    const targets = resolveUploadTargets(catalog, { channelId: 'ch-2', albumId: '', kind: 'hero' })
    assert.deepEqual(assignFiles(files, targets).map((row) => row.channelId), ['', '', '', ''])
  })

  it('tolerates an empty queue', () => {
    assert.deepEqual(assignFiles([], resolveUploadTargets(catalog, { channelId: 'ch-1', albumId: '', kind: 'image' })), [])
  })
})
