const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp)(\?|#|$)/i
const VIDEO_EXT = /\.(mp4|webm|ogv|mov|m4v)(\?|#|$)/i
const BLOCKED_HOSTS = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[::1\])/i

export function assertPublicHttpUrl(raw) {
  let url
  try {
    url = new URL(String(raw || '').trim())
  } catch {
    throw new Error('Invalid URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Only http(s) URLs are allowed.')
  if (BLOCKED_HOSTS.test(url.hostname) || url.hostname === 'metadata.google.internal') {
    throw new Error('Unable to import this page automatically.')
  }
  return url
}

function abs(base, href) {
  try {
    return new URL(href, base).href
  } catch {
    return ''
  }
}

function classify(url) {
  if (VIDEO_EXT.test(url) || /\/video\//i.test(url)) return 'video'
  if (IMAGE_EXT.test(url) || /\/image\//i.test(url)) return 'image'
  return ''
}

function filename(url) {
  try {
    const path = new URL(url).pathname.split('/').filter(Boolean).pop() || 'media'
    return decodeURIComponent(path).slice(0, 80)
  } catch {
    return 'media'
  }
}

export function extractMedia(html, pageUrl) {
  const found = new Map()
  const add = (href, typeHint) => {
    const url = abs(pageUrl, href)
    if (!url || url.startsWith('data:') || url.startsWith('blob:')) return
    const type = typeHint || classify(url)
    if (!type) return
    if (!found.has(url)) found.set(url, { url, type, filename: filename(url), sourcePage: pageUrl, thumbnail: type === 'image' ? url : '' })
  }

  for (const match of html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["']/gi)) add(match[1], 'image')
  for (const match of html.matchAll(/<img\b[^>]*\bsrcset=["']([^"']+)["']/gi)) {
    match[1].split(',').forEach((part) => add(part.trim().split(/\s+/)[0], 'image'))
  }
  for (const match of html.matchAll(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/gi)) add(match[1], 'image')
  for (const match of html.matchAll(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/gi)) add(match[1], 'image')
  for (const match of html.matchAll(/<video\b[^>]*\bsrc=["']([^"']+)["']/gi)) add(match[1], 'video')
  for (const match of html.matchAll(/<source\b[^>]*\bsrc=["']([^"']+)["']/gi)) add(match[1], classify(match[1]) || 'video')
  for (const match of html.matchAll(/<meta[^>]+property=["']og:video(?::url|:secure_url)?["'][^>]+content=["']([^"']+)["']/gi)) add(match[1], 'video')
  for (const match of html.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    if (classify(match[0])) add(match[0])
  }
  return [...found.values()]
}

export async function scanPage(rawUrl) {
  const url = assertPublicHttpUrl(rawUrl)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)
  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'User-Agent': 'X-sutra-PremiumImport/1.0'
      }
    })
    if (response.status === 401 || response.status === 403 || response.status === 407) {
      return { url: url.href, error: 'Unable to import this page automatically.', images: [], videos: [] }
    }
    if (!response.ok) {
      return { url: url.href, error: `Unable to import this page automatically. (${response.status})`, images: [], videos: [] }
    }
    const contentType = response.headers.get('content-type') || ''
    if (VIDEO_EXT.test(url.href) || contentType.startsWith('video/')) {
      const item = { url: url.href, type: 'video', filename: filename(url.href), sourcePage: url.href, thumbnail: '' }
      return { url: url.href, images: [], videos: [item], error: null }
    }
    if (IMAGE_EXT.test(url.href) || contentType.startsWith('image/')) {
      const item = { url: url.href, type: 'image', filename: filename(url.href), sourcePage: url.href, thumbnail: url.href }
      return { url: url.href, images: [item], videos: [], error: null }
    }
    const html = (await response.text()).slice(0, 1_800_000)
    const items = extractMedia(html, url.href)
    return {
      url: url.href,
      images: items.filter((item) => item.type === 'image').slice(0, 400),
      videos: items.filter((item) => item.type === 'video').slice(0, 200),
      error: null
    }
  } catch {
    return { url: url.href, error: 'Unable to import this page automatically.', images: [], videos: [] }
  } finally {
    clearTimeout(timer)
  }
}
