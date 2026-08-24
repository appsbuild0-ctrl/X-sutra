import {
  adminPassword,
  announce,
  json,
  mediaToItem,
  nid,
  publicCatalog,
  readCatalog,
  writeCatalog
} from './_premium-store.mjs'

function requireAdmin(body) {
  if (body.password !== adminPassword()) {
    const error = new Error('Admin password required.')
    error.statusCode = 403
    throw error
  }
}

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      const catalog = await readCatalog()
      return json(200, { ...publicCatalog(catalog), itemPreview: publicCatalog(catalog).media.slice(0, 3).map(mediaToItem) })
    }

    if (event.httpMethod !== 'POST') return json(405, { error: 'GET and POST only.' })
    const body = JSON.parse(event.body ?? '{}')
    requireAdmin(body)
    const catalog = await readCatalog()
    const action = String(body.action || '')

    if (action === 'updateSettings') {
      catalog.settings = { ...catalog.settings, ...(body.settings || {}) }
      return json(200, publicCatalog(await writeCatalog(catalog)))
    }

    if (action === 'createChannel') {
      if (!catalog.settings.channelCreation) return json(403, { error: 'Channel creation is turned off.' })
      const channel = {
        id: nid('ch'),
        name: String(body.name || '').trim().slice(0, 48) || 'Untitled channel',
        description: String(body.description || '').trim().slice(0, 240),
        cover: String(body.cover || '').trim(),
        type: ['images', 'videos', 'mixed'].includes(body.type) ? body.type : 'mixed',
        status: body.status === 'off' ? 'off' : 'on',
        order: Number(body.order) || catalog.channels.length + 1,
        createdAt: new Date().toISOString()
      }
      catalog.channels.push(channel)
      announce(catalog, 'New Channel', channel.name, 'channel')
      return json(200, publicCatalog(await writeCatalog(catalog)))
    }

    if (action === 'updateChannel') {
      catalog.channels = catalog.channels.map((channel) => channel.id === body.id ? {
        ...channel,
        name: body.name != null ? String(body.name).slice(0, 48) : channel.name,
        description: body.description != null ? String(body.description).slice(0, 240) : channel.description,
        cover: body.cover != null ? String(body.cover) : channel.cover,
        type: ['images', 'videos', 'mixed'].includes(body.type) ? body.type : channel.type,
        status: body.status === 'off' || body.status === 'on' ? body.status : channel.status,
        order: body.order != null ? Number(body.order) : channel.order
      } : channel)
      return json(200, publicCatalog(await writeCatalog(catalog)))
    }

    if (action === 'deleteChannel') {
      catalog.channels = catalog.channels.filter((channel) => channel.id !== body.id)
      return json(200, publicCatalog(await writeCatalog(catalog)))
    }

    if (action === 'createAlbum') {
      if (!catalog.settings.albumCreation) return json(403, { error: 'Album creation is turned off.' })
      const album = {
        id: nid('alb'),
        name: String(body.name || '').trim().slice(0, 80) || 'Untitled album',
        description: String(body.description || '').trim().slice(0, 800),
        cover: String(body.cover || '').trim(),
        tags: String(body.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 20),
        channelId: String(body.channelId || ''),
        published: body.published !== false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
      catalog.albums.unshift(album)
      announce(catalog, 'New Album', album.name, 'album')
      return json(200, publicCatalog(await writeCatalog(catalog)))
    }

    if (action === 'updateAlbum') {
      catalog.albums = catalog.albums.map((album) => album.id === body.id ? {
        ...album,
        name: body.name != null ? String(body.name).slice(0, 80) : album.name,
        description: body.description != null ? String(body.description).slice(0, 800) : album.description,
        cover: body.cover != null ? String(body.cover) : album.cover,
        tags: body.tags != null ? String(body.tags).split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 20) : album.tags,
        channelId: body.channelId != null ? String(body.channelId) : album.channelId,
        published: body.published != null ? body.published !== false : album.published,
        updatedAt: new Date().toISOString()
      } : album)
      return json(200, publicCatalog(await writeCatalog(catalog)))
    }

    if (action === 'deleteAlbum') {
      catalog.albums = catalog.albums.filter((album) => album.id !== body.id)
      return json(200, publicCatalog(await writeCatalog(catalog)))
    }

    if (action === 'importMedia') {
      if (!catalog.settings.premiumUpload) return json(403, { error: 'Premium upload is turned off.' })
      const items = Array.isArray(body.items) ? body.items : []
      const allowDupes = Boolean(body.importDuplicates)
      const existing = new Set(catalog.media.map((item) => item.url))
      let added = 0
      let skipped = 0
      const imported = []
      for (const raw of items.slice(0, 40)) {
        const url = String(raw.url || '').trim()
        const type = raw.type === 'image' ? 'image' : 'video'
        if (!/^https?:\/\/[^\s]{8,800}$/i.test(url) && !url.startsWith('/api/premium-file?id=')) continue
        if (type === 'image' && !catalog.settings.imageUpload) continue
        if (type === 'video' && !catalog.settings.videoUpload) continue
        if (!allowDupes && (existing.has(url) || (raw.hash && catalog.media.some((item) => item.hash === raw.hash)))) {
          skipped += 1
          continue
        }
        const entry = {
          id: nid('pm'),
          type,
          url,
          thumbnail: String(raw.thumbnail || (type === 'image' ? url : '')),
          title: String(raw.title || raw.filename || (type === 'video' ? 'Premium video' : 'Premium image')).slice(0, 120),
          tags: String(body.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean).slice(0, 20),
          channelId: String(body.channelId || ''),
          albumId: String(body.albumId || ''),
          sourcePage: String(raw.sourcePage || ''),
          createdAt: new Date().toISOString()
        }
        if (raw.role === 'hero') {
          catalog.heroes.unshift({
            id: entry.id,
            url: entry.url,
            thumbnail: entry.thumbnail || entry.url,
            title: entry.title,
            createdAt: entry.createdAt,
            published: true
          })
        }
        catalog.media.unshift(entry)
        existing.add(url)
        imported.push(entry)
        added += 1
      }
      if (added) {
        const videos = imported.filter((item) => item.type === 'video').length
        const images = imported.filter((item) => item.type === 'image').length
        if (videos) announce(catalog, 'New Video', `${videos} video${videos === 1 ? '' : 's'} imported`, 'video')
        if (images) announce(catalog, 'New Photos', `${images} image${images === 1 ? '' : 's'} imported`, 'photos')
      }
      await writeCatalog(catalog)
      return json(200, { added, skipped, catalog: publicCatalog(catalog) })
    }

    if (action === 'updateAdminHub') {
      catalog.adminHub = { ...(catalog.adminHub || {}), ...(body.hub || {}) }
      return json(200, publicCatalog(await writeCatalog(catalog)))
    }

    if (action === 'deleteMedia') {
      catalog.media = catalog.media.filter((item) => item.id !== body.id)
      return json(200, publicCatalog(await writeCatalog(catalog)))
    }

    if (action === 'addPost') {
      if (!catalog.settings.videoUpload || !catalog.settings.premiumUpload) return json(403, { error: 'Video upload is turned off.' })
      const url = String(body.videoUrl || '').trim()
      if (!/^https?:\/\/[^\s]{10,800}$/i.test(url)) return json(400, { error: 'Paste a valid video link (https://...).' })
      catalog.media.unshift({
        id: nid('pm'),
        type: 'video',
        url,
        thumbnail: String(body.thumbnail || ''),
        title: String(body.title || 'Premium clip').slice(0, 80),
        tags: [],
        channelId: String(body.channelId || ''),
        albumId: String(body.albumId || ''),
        sourcePage: '',
        createdAt: new Date().toISOString()
      })
      announce(catalog, 'New Video', body.title || 'Premium clip', 'video')
      return json(200, publicCatalog(await writeCatalog(catalog)))
    }

    return json(400, { error: 'Unknown action.' })
  } catch (error) {
    const status = error.statusCode || 500
    return json(status, { error: error instanceof Error ? error.message : 'Premium unavailable.' })
  }
}
