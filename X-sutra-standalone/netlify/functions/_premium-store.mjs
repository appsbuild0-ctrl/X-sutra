import { getStore } from '@netlify/blobs'

const ADMIN_PASSWORD = process.env.PREMIUM_ADMIN_PASSWORD || 'admin123'

export function adminPassword() {
  return ADMIN_PASSWORD
}

export function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body)
  }
}

export async function readPosts() {
  const store = getStore('premium-posts')
  const raw = await store.get('posts')
  try {
    const parsed = JSON.parse(raw ?? '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export async function writePosts(posts) {
  const store = getStore('premium-posts')
  await store.set('posts', JSON.stringify(posts.slice(0, 60)))
}

export async function addPost({ title, videoUrl, thumbnail = '', source = 'admin' }) {
  const url = String(videoUrl ?? '').trim()
  if (!/^https?:\/\/[^\s]{10,800}$/i.test(url)) {
    throw new Error('Paste a valid video link (https://...).')
  }
  const posts = await readPosts()
  const post = {
    id: `premium-${Date.now()}`,
    title: String(title ?? '').trim().slice(0, 80) || 'Premium clip',
    videoUrl: url,
    thumbnail: /^https?:\/\//i.test(String(thumbnail ?? '')) ? String(thumbnail).trim() : '',
    createdAt: new Date().toISOString(),
    source
  }
  posts.unshift(post)
  await writePosts(posts)
  return { post, posts }
}
