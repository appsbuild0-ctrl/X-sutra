// Premium posts: shared list admin publishes (web or Telegram bot).
// GET  /api/premium
// POST /api/premium  { password, title, videoUrl, thumbnail? }

import { addPost, adminPassword, json, readPosts } from './_premium-store.mjs'

export const handler = async (event) => {
  try {
    if (event.httpMethod === 'GET') {
      return json(200, { posts: await readPosts() })
    }

    if (event.httpMethod === 'POST') {
      const body = JSON.parse(event.body ?? '{}')
      if (body.password !== adminPassword()) return json(403, { error: 'Admin password required.' })
      const { post, posts } = await addPost({
        title: body.title,
        videoUrl: body.videoUrl,
        thumbnail: body.thumbnail,
        source: 'web'
      })
      // Fire-and-forget notify via telegram function if token is set.
      const token = process.env.TELEGRAM_BOT_TOKEN
      if (token) {
        try {
          const origin = event.headers['x-forwarded-host']
            ? `${event.headers['x-forwarded-proto'] || 'https'}://${event.headers['x-forwarded-host']}`
            : ''
          if (origin) {
            await fetch(`${origin}/.netlify/functions/telegram?notify=1`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-xsutra-notify': adminPassword() },
              body: JSON.stringify({ post })
            })
          }
        } catch {
          /* notify is best-effort */
        }
      }
      return json(200, { posts })
    }

    return json(405, { error: 'GET and POST only.' })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Premium posts unavailable.'
    return json(message.includes('valid video') ? 400 : 500, { error: message })
  }
}
