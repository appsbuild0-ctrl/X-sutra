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
  const re = /href="https?:\/\/hotpic\.vip\/u\/([^"#?]+)"/gi
  let match
  while ((match = re.exec(html))) {
    const username = decodeURIComponent(match[1])
    if (!username || users.has(username)) continue
    users.set(username, {
      username,
      displayName: username,
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
  const simple = /href="https?:\/\/hotpic\.vip\/album\/([^"#?]+)"[^>]*title="([^"]*)"[\s\S]{0,500}?src="(https:\/\/cdn[^"]+)"/gi
  let match
  while ((match = simple.exec(html))) {
    if (seen.has(match[1])) continue
    seen.add(match[1])
    const chunk = match[0]
    const owner = html.slice(match.index, match.index + 900).match(/hotpic\.vip\/u\/([^"'/#?]+)/i)?.[1] || ''
    albums.push({
      id: match[1],
      title: decode(match[2]),
      cover: match[3],
      url: `${ORIGIN}/album/${match[1]}`,
      owner: decodeURIComponent(owner),
      hasVideo: /m-play|play_circle|\.mp4/i.test(chunk)
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

function fullFromThumb(thumb) {
  return thumb.replace('/thumb/', '/').replace(/\.webp(?:\?.*)?$/i, '.jpeg')
}

function parseAlbum(html, id) {
  const title = html.match(/<h1[^>]*>([^<]+)<\/h1>/i)?.[1]?.trim() || `Album ${id}`
  const owner = html.match(/hotpic\.vip\/u\/([^"'/]+)/i)?.[1] || 'hotpic'
  const media = []
  const image = /href="https?:\/\/hotpic\.vip\/i\/([^"#?]+)"[^>]*title="([^"]*)"[\s\S]{0,200}?src="(https:\/\/cdn[^"]+)"/gi
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
  const videoOnly = /href="https?:\/\/hotpic\.vip\/i\/([^"#?]+)"[^>]*title="([^"]+\.(?:mp4|mov|avi|webm))"/gi
  while ((match = videoOnly.exec(html))) {
    if (media.some((item) => item.id === `hp-${match[1]}`)) continue
    media.push({
      id: `hp-${match[1]}`,
      title: decode(match[2]),
      description: title,
      creator: owner,
      thumbnail: '',
      thumbnailUrls: [],
      videoUrl: `${ORIGIN}/i/${match[1]}`,
      sourceUrl: `${ORIGIN}/i/${match[1]}`,
      duration: 0,
      likes: 0,
      views: 0,
      width: 0,
      height: 0,
      createdAt: Date.now(),
      hasAudio: true,
      tags: [],
      niches: []
    })
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
    return json(400, { error: 'Unknown Hotpic path' })
  } catch (error) {
    return json(502, { error: error instanceof Error ? error.message : 'Hotpic unavailable' })
  }
}
