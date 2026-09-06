import { adminPassword, json } from './_premium-store.mjs'
import { scanPage } from './_premium-scan.mjs'

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') return json(405, { error: 'POST only.' })
    const body = JSON.parse(event.body ?? '{}')
    if (body.password !== adminPassword()) return json(403, { error: 'Admin password required.' })
    const urls = [...new Set(String(body.urls || '').split(/\s+/).map((url) => url.trim()).filter(Boolean))].slice(0, 8)
    if (!urls.length) return json(400, { error: 'Paste at least one webpage URL.' })
    const pages = []
    for (const url of urls) pages.push(await scanPage(url))
    const images = pages.reduce((sum, page) => sum + page.images.length, 0)
    const videos = pages.reduce((sum, page) => sum + page.videos.length, 0)
    return json(200, { pages, totals: { images, videos, media: images + videos } })
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : 'Scan failed.' })
  }
}
