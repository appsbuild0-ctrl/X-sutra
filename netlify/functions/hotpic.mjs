const ORIGIN = 'https://hotpic.vip'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'public, max-age=90' },
    body: JSON.stringify(body)
  }
}

function decode(value) {
  return String(value || '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"')
}

async function load(path) {
  const url = path.startsWith('http') ? path : `${ORIGIN}${path}`
  const host = new URL(url).hostname
  if (!/(^|\.)hotpic\.(vip|cc|one)$/i.test(host)) throw new Error('Unsupported host')
  const response = await fetch(url, {
    headers: { Accept: 'text/html', 'User-Agent': UA, Referer: `${ORIGIN}/` },
    redirect: 'follow'
  })
  if (response.status === 401 || response.status === 403) throw new Error('Unable to open this Hotpic page automatically.')
  if (!response.ok) throw new Error(`Hotpic request failed (${response.status})`)
  return response.text()
}

function parseUsers(html) {
  const users = new Map()
  const re = /(?:href|src)=["'](?:https?:\/\/(?:www\.)?hotpic\.(?:vip|cc|one))?\/u\/([^"'#?]+)/gi
  let match
  while ((match = re.exec(html))) {
    const username = decodeURIComponent(match[1])
    if (!username || users.has(username)) continue
    users.set(username, {
      username,
      displayName: username.replace(/\./g, ' '),
      avatar: `${ORIGIN}/images/user/${encodeURIComponent(username)}.jpg`,
      profileUrl: `${ORIGIN}/u/${encodeURIComponent(username)}`,
      followers: 0,
      gifs: 0,
      views: 0,
      verified: false
    })
  }
  return [...users.values()]
}

function parseFeed(html) {
  const albums = []
  const seen = new Set()
  const re = /\/album\/([A-Za-z0-9_-]{4,})/gi
  let match
  while ((match = re.exec(html))) {
    if (seen.has(match[1])) continue
    seen.add(match[1])
    const window = html.slice(Math.max(0, match.index - 240), match.index + 1400)
    const title = decode(window.match(/title=["']([^"']+)["']/i)?.[1] || `Album ${match[1]}`)
    const cover = window.match(/src=["'](https?:\/\/cdn[^"']+)["']/i)?.[1]
      || window.match(/src=["'](https?:\/\/[^"']+\.(?:webp|jpe?g|png)[^"']*)["']/i)?.[1]
      || ''
    const owner = decodeURIComponent(window.match(/\/u\/([^"'/#?]+)/i)?.[1] || '')
    albums.push({
      id: match[1],
      title,
      cover,
      url: `${ORIGIN}/album/${match[1]}`,
      owner,
      hasVideo: /m-play|play_circle|\.mp4|video/i.test(window)
    })
  }
  return albums
}

function parseProfile(html, username) {
  const name = html.match(/<h[12][^>]*>\s*([^<]{2,80})\s*<\/h[12]>/i)?.[1]?.trim()
    || html.match(/@([A-Za-z0-9._-]{2,40})/)?.[1]
    || username
  const albums = Number(html.match(/(\d+)\s*Albums/i)?.[1] || 0)
  const joined = html.match(/Joined\s+([A-Za-z]+ \d{1,2}, \d{4})/i)?.[1] || ''
  return {
    username,
    displayName: decode(name),
    avatar: `${ORIGIN}/images/user/${encodeURIComponent(username)}.jpg`,
    profileUrl: `${ORIGIN}/u/${encodeURIComponent(username)}`,
    albums,
    joined,
    items: parseFeed(html)
  }
}

function fullFromThumb(thumb, isVideo = false) {
  const full = thumb.replace('/thumb/', '/')
  if (isVideo) return full.replace(/\.(?:webp|jpe?g|png)(?:\?.*)?$/i, '.mp4')
  return full.replace(/\.webp(?:\?.*)?$/i, '.jpeg')
}

function parseAlbum(html, id) {
  const title = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() || `Album ${id}`
  const owner = html.match(/hotpic\.vip\/u\/([^"'/]+)/i)?.[1] || html.match(/\/u\/([^"'/]+)/i)?.[1] || 'hotpic'
  const media = []
  const image = /\/i\/([A-Za-z0-9_-]+)[^>]{0,220}title=["']([^"']*)["'][\s\S]{0,280}?src=["'](https?:\/\/[^"']+)["']/gi
  let match
  while ((match = image.exec(html))) {
    const itemId = match[1]
    const name = decode(match[2])
    const thumb = match[3]
    const isVideo = /\.(mp4|mov|avi|webm)$/i.test(name)
    media.push({
      id: `hp-${itemId}`,
      title: name,
      description: title,
      creator: owner,
      thumbnail: thumb,
      thumbnailUrls: [thumb],
      previewUrl: isVideo ? undefined : fullFromThumb(thumb),
      videoUrl: isVideo ? `${ORIGIN}/i/${itemId}` : undefined,
      sourceUrl: `${ORIGIN}/i/${itemId}`,
      duration: 0,
      likes: 0,
      views: 0,
      width: 0,
      height: 0,
      createdAt: Date.now(),
      hasAudio: isVideo,
      tags: [],
      niches: []
    })
  }
  if (!media.length) {
    const loose = /\/i\/([A-Za-z0-9_-]+)/gi
    while ((match = loose.exec(html))) {
      if (media.some((item) => item.id === `hp-${match[1]}`)) continue
      const window = html.slice(match.index, match.index + 500)
      const thumb = window.match(/src=["'](https?:\/\/[^"']+)["']/i)?.[1] || ''
      media.push({
        id: `hp-${match[1]}`,
        title: match[1],
        description: title,
        creator: owner,
        thumbnail: thumb,
        thumbnailUrls: thumb ? [thumb] : [],
        previewUrl: thumb ? fullFromThumb(thumb) : undefined,
        sourceUrl: `${ORIGIN}/i/${match[1]}`,
        duration: 0,
        likes: 0,
        views: 0,
        width: 0,
        height: 0,
        createdAt: Date.now(),
        hasAudio: false,
        tags: [],
        niches: []
      })
    }
  }
  return { id, title, owner, items: media }
}

export const handler = async (event) => {
  try {
    const params = event.queryStringParameters || {}
    const kind = params.path || 'desi'
    if (kind === 'desi' || kind === 'models' || kind === 'feed') {
      const tag = String(params.tag || 'Desi').replace(/[^A-Za-z0-9-]/g, '') || 'Desi'
      const page = Math.max(1, Number(params.page) || 1)
      const html = await load(page > 1 ? `/t/${tag}?page=${page}` : `/t/${tag}`)
      return json(200, { users: parseUsers(html).slice(0, 24), albums: parseFeed(html) })
    }
    if (kind === 'user') {
      const username = String(params.u || '').trim()
      if (!username) return json(400, { error: 'Missing user' })
      const html = await load(`/u/${encodeURIComponent(username)}`)
      return json(200, parseProfile(html, username))
    }
    if (kind === 'album') {
      const id = String(params.id || '').trim()
      if (!id) return json(400, { error: 'Missing album' })
      const html = await load(`/album/${encodeURIComponent(id)}`)
      return json(200, parseAlbum(html, id))
    }
    if (kind === 'item') {
      const id = String(params.id || '').trim()
      if (!id) return json(400, { error: 'Missing item' })
      const html = await load(`/i/${encodeURIComponent(id)}`)
      const parsed = parseAlbum(html, id)
      return json(200, parsed.items[0] || { id: `hp-${id}`, title: id, items: [] })
    }
    return json(400, { error: 'Unknown Hotpic path' })
  } catch (error) {
    return json(502, { error: error instanceof Error ? error.message : 'Hotpic unavailable' })
  }
}
