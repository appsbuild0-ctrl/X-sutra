// Premium posts: a shared list the admin can add to (title + direct video
// URL) that every member sees in the Premium tab. Posts live in Netlify
// Blobs on the site itself — no external storage, no accounts.
//
// GET  /api/premium              -> { posts: [...] }
// POST /api/premium (JSON body)  -> { posts: [...] }   (admin password)

import { getStore } from '@netlify/blobs'

const ADMIN_PASSWORD = 'admin123'

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  }
}

async function readPosts() {
  const store = getStore('premium-posts')
  const raw = await store.get('posts')
  try {
    const parsed = JSON.parse(raw ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function writePosts(posts) {
  const store = getStore('premium-posts')
  await store.set('posts', JSON.stringify(posts.slice(0, 60)))
}

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      return json(200, { posts: await readPosts() })
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body ?? '{}')
      if (body.password !== ADMIN_PASSWORD) return json(403, { error: 'Admin password required.' })
      const videoUrl = String(body.videoUrl ?? '').trim()
      const title = String(body.title ?? '').trim().slice(0, 80)
      const thumbnail = String(body.thumbnail ?? '').trim()
      if (!/^https?:\/\/[^\s]{10,400}$/i.test(videoUrl)) {
        return json(400, { error: 'Paste a valid video link (https://...).' })
      }
      const posts = await readPosts()
      posts.unshift({
        id: `premium-${Date.now()}`,
        title: title || 'Premium clip',
        videoUrl,
        thumbnail: /^https?:\/\//i.test(thumbnail) ? thumbnail : '',
        createdAt: new Date().toISOString()
      })
      await writePosts(posts)
      return json(200, { posts })
    }

    return json(405, { error: 'GET and POST only.' })
  } catch (error) {
    return json(500, { error: error instanceof Error ? error.message : 'Premium posts unavailable.' })
  }
}
